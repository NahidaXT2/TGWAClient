require('dotenv').config();

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');
const { TelegramClient } = require('teleproto');
const { StringSession } = require('teleproto/sessions');
const { NewMessage } = require('teleproto/events');

// ============================================================
// Configuración — TeleClient (Telegram)
// ============================================================
const API_ID = parseInt(process.env.API_ID, 10);
const API_HASH = process.env.API_HASH;
const SESSION_STR = process.env.TELEGRAM_SESSION;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const PORT = process.env.PORT || 7860;

// Palabras clave para filtrar mensajes (Telegram)
const wordsToReact = ["bug", "aprovechen", "quemen", "quemar", "rebeca", "5 soles", "gratis"];

// Grupo objetivo de Telegram (ID con prefijo -100 para canales)
const TARGET_CHAT_ID = -1001713742924;

// ============================================================
// Configuración — WPPConnect (WhatsApp) — Sistema de Comandos
// ============================================================
const WPP_SESSION_NAME = process.env.WPP_SESSION_NAME || 'default';
const WPP_USER_NUMBER = process.env.WPP_USER_NUMBER; // Número del usuario autorizado (opcional)
const WPP_GROUP_ID = process.env.WPP_GROUP_ID; // ID del grupo donde responder (opcional)

// ============================================================
// Configuración — Supabase Storage
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'wpp-sessions';

let supabase = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        db: {
            schema: 'public'
        },
        global: {
            headers: {
                'x-my-custom-header': 'my-app-name'
            }
        },
        realtime: {
            transport: WebSocket
        }
    });
}

// ============================================================
// Función de validación de token (siguiendo el patrón de WPPConnect)
// ============================================================
function isValidSessionToken(token) {
    const requiredAttributes = ['WABrowserId', 'WASecretBundle', 'WAToken1', 'WAToken2'];
    
    if (!token) {
        console.warn('⚠️ [TokenStore] Token es null o undefined');
        return false;
    }

    const isValid = requiredAttributes.every(
        attr => typeof token[attr] === 'string' && token[attr].length > 0
    );

    if (!isValid) {
        console.warn('⚠️ [TokenStore] Token no tiene todos los campos requeridos o están vacíos');
        console.warn('⚠️ [TokenStore] Campos requeridos:', requiredAttributes);
        console.warn('⚠️ [TokenStore] Token recibido:', JSON.stringify(token, null, 2));
    }

    return isValid;
}

// ============================================================
// TokenStore personalizado para Supabase
// ============================================================

const supabaseTokenStore = {
    getToken: async (sessionName) => {
        try {
            console.log(`🔍 [TokenStore] getToken llamado para: ${sessionName}`);
            console.log(`🔍 [TokenStore] Timestamp: ${new Date().toISOString()}`);
            
            if (!supabase) {
                console.warn('⚠️ [TokenStore] Supabase no configurado');
                return undefined;
            }

            const fileName = `${sessionName}_token.json`;
            console.log(`🔍 [TokenStore] Buscando archivo: ${fileName} en bucket: ${SUPABASE_BUCKET}`);
            
            const { data, error } = await supabase.storage
                .from(SUPABASE_BUCKET)
                .download(fileName);

            if (error) {
                console.log(`ℹ️ [TokenStore] No hay sesión guardada para ${sessionName}: ${error.message}`);
                console.log(`ℹ️ [TokenStore] Error code: ${error?.statusCode || 'unknown'}`);
                return undefined;
            }

            console.log(`📥 [TokenStore] Archivo encontrado, parsing contenido...`);
            const content = await data.text();
            console.log(`📥 [TokenStore] Tamaño del contenido: ${content.length} bytes`);
            const tokenData = JSON.parse(content);
            
            // Validar el token antes de retornarlo
            if (!isValidSessionToken(tokenData)) {
                console.error(`❌ [TokenStore] Token recuperado no es válido para ${sessionName}`);
                return undefined;
            }

            console.log(`✅ [TokenStore] Sesión restaurada desde Supabase para ${sessionName}`);
            console.log(`✅ [TokenStore] Campos del token:`, Object.keys(tokenData).join(', '));
            console.log(`✅ [TokenStore] Contenido del token recuperado:`, JSON.stringify(tokenData, null, 2));
            return tokenData;
        } catch (error) {
            console.error(`❌ [TokenStore] Error al obtener token de Supabase: ${error.message}`);
            console.error(`❌ [TokenStore] Stack trace:`, error.stack);
            return undefined;
        }
    },

    setToken: async (sessionName, tokenData) => {
        try {
            console.log(`💾 [TokenStore] setToken llamado para: ${sessionName}`);
            console.log(`� [TokenStore] Timestamp: ${new Date().toISOString()}`);
            console.log(`�📊 [TokenStore] Tamaño del token: ${JSON.stringify(tokenData).length} bytes`);
            
            if (!supabase) {
                console.warn('⚠️ [TokenStore] Supabase no configurado');
                return false;
            }

            // Validar el token antes de guardarlo
            if (!isValidSessionToken(tokenData)) {
                console.error(`❌ [TokenStore] Intentando guardar token inválido para ${sessionName}`);
                return false;
            }

            const fileName = `${sessionName}_token.json`;
            const content = JSON.stringify(tokenData);
            const fileBuffer = Buffer.from(content);

            console.log(`📤 [TokenStore] Subiendo archivo: ${fileName} a bucket: ${SUPABASE_BUCKET}`);
            console.log(`📤 [TokenStore] Campos a guardar:`, Object.keys(tokenData).join(', '));
            console.log(`📤 [TokenStore] Tamaño del buffer: ${fileBuffer.length} bytes`);

            const { data, error } = await supabase.storage
                .from(SUPABASE_BUCKET)
                .upload(fileName, fileBuffer, {
                    upsert: true
                });

            if (error) {
                console.error(`❌ [TokenStore] Error al guardar token en Supabase: ${error.message}`);
                console.error(`❌ [TokenStore] Error code: ${error?.statusCode || 'unknown'}`);
                console.error(`❌ [TokenStore] Detalles del error:`, error);
                return false;
            }

            console.log(`✅ [TokenStore] Sesión guardada en Supabase para ${sessionName}`);
            console.log(`✅ [TokenStore] Archivo guardado: ${data.path}`);
            console.log(`✅ [TokenStore] Upload ID: ${data?.id || 'N/A'}`);
            return true;
        } catch (error) {
            console.error(`❌ [TokenStore] Error en setToken: ${error.message}`);
            console.error(`❌ [TokenStore] Stack trace:`, error.stack);
            return false;
        }
    },

    removeToken: async (sessionName) => {
        try {
            console.log(`🗑️ [TokenStore] removeToken llamado para: ${sessionName}`);
            
            if (!supabase) return false;

            const fileName = `${sessionName}_token.json`;
            const { error } = await supabase.storage
                .from(SUPABASE_BUCKET)
                .remove([fileName]);

            if (error) {
                console.error(`❌ [TokenStore] Error al eliminar token de Supabase: ${error.message}`);
                return false;
            }

            console.log(`✅ [TokenStore] Sesión eliminada de Supabase para ${sessionName}`);
            return true;
        } catch (error) {
            console.error(`❌ [TokenStore] Error en removeToken: ${error.message}`);
            return false;
        }
    },

    listTokens: async () => {
        try {
            console.log(`📋 [TokenStore] listTokens llamado`);
            
            if (!supabase) return [];

            const { data: files, error } = await supabase.storage
                .from(SUPABASE_BUCKET)
                .list();

            if (error) {
                console.error(`❌ [TokenStore] Error al listar tokens: ${error.message}`);
                return [];
            }

            const tokenFiles = files
                .filter(file => file.name.endsWith('_token.json'))
                .map(file => file.name.replace('_token.json', ''));

            console.log(`📋 [TokenStore] Tokens encontrados: ${tokenFiles.join(', ')}`);
            return tokenFiles;
        } catch (error) {
            console.error(`❌ [TokenStore] Error en listTokens: ${error.message}`);
            return [];
        }
    }
};

// Diccionario de comandos de WhatsApp
// Escribe el comando después de "/" y la respuesta que deseas enviar
const wppCommands = {
    'hola': '🤖 Hola!',
    'comandos': '🤖 Comandos disponibles:\n/hola - Saludo\n/comandos - Lista de comandos',
};

// ============================================================
// Validación de variables de entorno
// ============================================================
const requiredVars = ["API_ID", "API_HASH", "TELEGRAM_SESSION", "N8N_WEBHOOK_URL"];
const missingVars = requiredVars.filter((varName) => !process.env[varName]);

if (missingVars.length > 0) {
    console.error(`❌ Faltan las siguientes variables de entorno: ${missingVars.join(', ')}`);
    console.error("Por favor, configura tu archivo .env con los valores necesarios.");
    process.exit(1);
}

console.log("✅ Todas las variables de entorno están configuradas");

// ============================================================
// Función reutilizable: filtro de mensajes + envío a n8n
// ============================================================
async function processMessage(messageText, source, extraData = {}) {
    try {
        const lowerText = messageText.toLowerCase();
        const matchedWords = wordsToReact.filter((word) => lowerText.includes(word));

        if (matchedWords.length > 0) {
            const payload = {
                message: messageText,
                source,
                matchedKeywords: matchedWords,
                date: new Date().toISOString(),
                ...extraData,
            };

            try {
                const response = await axios.post(N8N_WEBHOOK_URL, payload, {
                    headers: { "Content-Type": "application/json" },
                    timeout: 10000,
                });
            } catch (webhookError) {
                console.error(`❌ [${source}] Error al enviar al webhook de n8n: ${webhookError.message}`);
            }
        }
    } catch (error) {
        console.error(`❌ [${source}] Error procesando mensaje: ${error.message}`);
    }
}

// ============================================================
// Inicialización del cliente de Telegram (teleproto = gramjs fork)
// ============================================================
const client = new TelegramClient(
    new StringSession(SESSION_STR),
    API_ID,
    API_HASH,
    {
        connectionRetries: 5,
    }
);

// ============================================================
// Handlers de eventos de Telegram
// ============================================================

// Handler principal: mensajes del grupo objetivo de Telegram
client.addEventHandler(
    async (event) => {
        const messageText = event.message.message || "";
        await processMessage(messageText, 'telegram', {
            chatId: event.chatId,
            senderId: event.senderId,
        });
    },
    new NewMessage({
        chats: [TARGET_CHAT_ID],
    })
);

// ============================================================
// Estado global de conexión
// ============================================================
const state = {
    telegramConnected: false,
    wppConnected: false,
    wppQRCode: null,
    lastBotMessageId: null, // Para evitar bucles infinitos
};

// ============================================================
// Servidor Express
// ============================================================
const app = express();

// Status general
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'TeleClient + WPPConnect (Node.js)',
        telegramConnected: state.telegramConnected,
        wppConnected: state.wppConnected,
    });
});

// Status de Telegram
app.get('/telegram', (req, res) => {
    res.json({
        status: state.telegramConnected ? 'connected' : 'disconnected',
        service: 'Telegram (teleproto/gramjs)',
        connected: state.telegramConnected,
        targetChatId: TARGET_CHAT_ID,
    });
});

// Status de WPPConnect
app.get('/wpp', (req, res) => {
    res.json({
        status: state.wppConnected ? 'connected' : 'disconnected',
        service: 'WPPConnect (WhatsApp Web) — Bot de Comandos',
        connected: state.wppConnected,
        sessionName: WPP_SESSION_NAME,
        hasQRCode: !!state.wppQRCode,
    });
});

// QR Code endpoint
app.get('/wpp/qr', (req, res) => {
    if (!state.wppQRCode) {
        return res.status(404).json({
            error: 'QR code not available',
            status: state.wppConnected ? 'connected' : 'disconnected',
            message: 'Espera a que WPPConnect genere el código QR'
        });
    }
    res.json({ qrCode: state.wppQRCode });
});

// QR Code page
app.get('/wpp/qr-page', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Escanea el QR de WhatsApp</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            font-family: Arial, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            background: #f5f5f5;
        }
        .container {
            text-align: center;
            padding: 20px;
            background: white;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 { color: #333; }
        #qr-image {
            max-width: 300px;
            margin: 20px 0;
        }
        .status {
            margin-top: 20px;
            padding: 10px;
            border-radius: 5px;
            background: #e7f3ff;
        }
        .instructions {
            margin-top: 20px;
            font-size: 14px;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>📱 Vincular WhatsApp</h1>
        <div id="qr-container">
            <p>Cargando código QR...</p>
        </div>
        <div class="status" id="status">
            Estado: Esperando QR...
        </div>
        <div class="instructions">
            <p>1. Abre WhatsApp en tu teléfono</p>
            <p>2. Ve a Menú → Aparatos vinculados → Vincular un aparato</p>
            <p>3. Escanea el código QR</p>
        </div>
    </div>
    <script>
        function checkQR() {
            fetch('/wpp/qr')
                .then(response => response.json())
                .then(data => {
                    if (data.qrCode) {
                        document.getElementById('qr-container').innerHTML =
                            '<img id="qr-image" src="' + data.qrCode + '" alt="QR Code">';
                        document.getElementById('status').textContent = 'Estado: QR listo para escanear';
                    } else {
                        document.getElementById('status').textContent = 'Estado: Esperando QR...';
                    }
                })
                .catch(err => {
                    document.getElementById('status').textContent = 'Estado: Error al cargar QR';
                });
        }

        // Check for QR every 2 seconds
        setInterval(checkQR, 2000);
        checkQR();
    </script>
</body>
</html>
    `);
});

// ============================================================
// Función: Procesar comandos de WhatsApp
// ============================================================
async function handleWPPCommand(wpp, message) {
    try {
        if (!message.body || message.type !== 'chat') return;

        // Solo procesar mensajes que empiecen con "/"
        if (!message.body.startsWith('/')) return;

        // Extraer el nombre del comando (sin la barra inicial)
        const command = message.body.substring(1).split(' ')[0].toLowerCase();

        // Buscar el comando en el diccionario
        const response = wppCommands[command];

        if (response) {
            try {
                const sentMessage = await wpp.sendText(message.to || message.id.remote, response);

                // Guardar el ID del mensaje enviado para evitar responder a nosotros mismos
                if (sentMessage && sentMessage.id) {
                    state.lastBotMessageId = sentMessage.id;
                }
            } catch (sendError) {
                console.error(`❌ [WPPConnect] Error al enviar mensaje: ${sendError.message}`);
            }
        }
    } catch (error) {
        console.error(`❌ [WPPConnect] Error al procesar comando: ${error.message}`);
    }
}



// ============================================================
// NOTA: Las funciones de subida/descarga manual de archivos han sido removidas
// El TokenStore de Supabase maneja automáticamente la persistencia de sesiones
// ============================================================

// ============================================================
// Función: Inicializar WPPConnect
// ============================================================
async function initWPPConnect() {
    try {
        console.log('🔍 [WPPConnect] Iniciando con token store de Supabase...');
        console.log('🔍 [WPPConnect] TokenStore configurado:', !!supabaseTokenStore);
        console.log('🔍 [WPPConnect] Supabase cliente configurado:', !!supabase);
        
        // Intentar recuperar el token guardado manualmente
        console.log('🔍 [WPPConnect] Intentando recuperar token guardado de Supabase...');
        const savedToken = await supabaseTokenStore.getToken(WPP_SESSION_NAME);
        
        if (savedToken) {
            console.log('✅ [WPPConnect] Token recuperado exitosamente, se usará para restaurar sesión');
        } else {
            console.log('ℹ️ [WPPConnect] No hay token guardado, se requerirá escanear QR');
        }
        
        const wpp = require('@wppconnect-team/wppconnect');

        const options = {
            session: WPP_SESSION_NAME,
            headless: true,
            logQR: false, // Deshabilitar QR ASCII en consola
            logV1: false,
            logV2: false,
            logV3: false,
            // Usar el token recuperado si existe
            sessionToken: savedToken || undefined,
            puppeteerOptions: {
                executablePath: '/usr/bin/chromium-browser',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu',
                    '--disable-extensions',
                    '--disable-default-apps',
                    '--disable-translate',
                    '--disable-sync',
                    '--metrics-recording-only',
                    '--disable-software-rasterizer',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                ],
            },
            // Usar el token store personalizado de Supabase
            tokenStore: supabaseTokenStore,
            catchQR: (base64QR, asciiQR) => {
                state.wppQRCode = base64QR;
            },
            statusFind: async (statusSession, session) => {
                console.log(`📊 [WPPConnect] statusFind: ${statusSession}`);
                if (statusSession === 'isLogged' || statusSession === 'CONNECTED' || statusSession === 'qrReadSuccess') {
                    state.wppConnected = true;
                    state.wppQRCode = null;
                    console.log('✅ [WPPConnect] Sesión conectada, guardando token explícitamente en Supabase...');
                    
                    // Guardar explícitamente el token después de conectar exitosamente
                    try {
                        const tokenData = await session.getSessionTokenBrowser();
                        if (tokenData && isValidSessionToken(tokenData)) {
                            console.log(`💾 [WPPConnect] Guardando token del navegador para sesión ${WPP_SESSION_NAME}`);
                            const saved = await supabaseTokenStore.setToken(WPP_SESSION_NAME, tokenData);
                            if (saved) {
                                console.log(`✅ [WPPConnect] Token guardado exitosamente en Supabase`);
                            } else {
                                console.error(`❌ [WPPConnect] Error al guardar token en Supabase`);
                            }
                        } else {
                            console.warn(`⚠️ [WPPConnect] Token del navegador no válido o null`);
                        }
                    } catch (error) {
                        console.error(`❌ [WPPConnect] Error al obtener token del navegador: ${error.message}`);
                    }
                }
            },
        };

        // wppconnect usa create function para inicializar
        const client = await wpp.create(options);

        // Escuchar eventos de mensajes entrantes
        client.onMessage(async (message) => {
            try {
                // Ignorar mensajes del propio bot para evitar bucles infinitos
                if (message.fromMe && state.lastBotMessageId === message.id.id) {
                    return;
                }

                // Si hay un grupo configurado, verificar que el mensaje sea para ese grupo
                if (WPP_GROUP_ID) {
                    // Verificar que el mensaje sea del usuario (fromMe: true) y sea para el grupo correcto
                    if (message.fromMe && message.to === WPP_GROUP_ID) {
                        await handleWPPCommand(client, message);
                        return;
                    }
                    return;
                }

                // Si hay un número de usuario configurado, filtrar por ese número
                if (WPP_USER_NUMBER) {
                    // Extraer el número de diferentes formatos
                    let userNumber = message.from;

                    // Eliminar sufijos de dominio de WhatsApp
                    userNumber = userNumber.replace('@c.us', '').replace('@s.whatsapp.net', '').replace('@g.us', '');

                    // Si es un mensaje de grupo, verificar si el remitente es el usuario autorizado
                    if (message.isGroupMsg || message.from.includes('@g.us')) {
                        // En grupos, verificar si el mensaje es del usuario autorizado
                        if (userNumber !== WPP_USER_NUMBER) {
                            return;
                        }
                    } else {
                        // En chat individual, verificar si es el usuario autorizado
                        if (userNumber !== WPP_USER_NUMBER) {
                            return;
                        }
                    }
                }

                await handleWPPCommand(client, message);
            } catch (error) {
                console.error(`❌ [WPPConnect] Error en handler de mensaje: ${error.message}`);
            }
        });

        // Escuchar también mensajes propios (para cuando te envías mensajes a ti mismo)
        client.onAck(async (ack) => {
            try {
                // Silencioso - no necesitamos logs de ACK
            } catch (error) {
                console.error(`❌ [WPPConnect] Error en handler de ACK: ${error.message}`);
            }
        });

        // Escuchar eventos de mensajes en general (incluyendo propios)
        client.onAnyMessage(async (message) => {
            try {
                // Solo mostrar mensajes del grupo seleccionado
                if (WPP_GROUP_ID && message.to !== WPP_GROUP_ID) {
                    return;
                }

                // Si hay un grupo configurado, solo procesar mensajes del usuario en ese grupo
                if (WPP_GROUP_ID) {
                    if (message.fromMe && message.to === WPP_GROUP_ID) {
                        await handleWPPCommand(client, message);
                    }
                    return;
                }

                // Solo procesar comandos si es del usuario autorizado
                if (WPP_USER_NUMBER) {
                    let userNumber = message.from;
                    userNumber = userNumber.replace('@c.us', '').replace('@s.whatsapp.net', '').replace('@g.us', '');

                    if (userNumber === WPP_USER_NUMBER) {
                        await handleWPPCommand(client, message);
                    }
                } else {
                    await handleWPPCommand(client, message);
                }
            } catch (error) {
                console.error(`❌ [WPPConnect] Error en handler de anyMessage: ${error.message}`);
            }
        });

        // Escuchar eventos de estado de la sesión
        client.onStateChange(async (status) => {
            console.log(`[WPPConnect] Cambio de estado: ${status}`);

            if (status === 'CONNECTED' || status === 'isLogged') {
                state.wppConnected = true;
                state.wppQRCode = null;
                console.log('✅ [WPPConnect] Sesión conectada (onStateChange), guardando token explícitamente en Supabase...');
                
                // Guardar explícitamente el token después de conectar exitosamente
                try {
                    const tokenData = await client.getSessionTokenBrowser();
                    if (tokenData && isValidSessionToken(tokenData)) {
                        console.log(`💾 [WPPConnect] Guardando token del navegador para sesión ${WPP_SESSION_NAME}`);
                        const saved = await supabaseTokenStore.setToken(WPP_SESSION_NAME, tokenData);
                        if (saved) {
                            console.log(`✅ [WPPConnect] Token guardado exitosamente en Supabase (onStateChange)`);
                        } else {
                            console.error(`❌ [WPPConnect] Error al guardar token en Supabase (onStateChange)`);
                        }
                    } else {
                        console.warn(`⚠️ [WPPConnect] Token del navegador no válido o null (onStateChange)`);
                    }
                } catch (error) {
                    console.error(`❌ [WPPConnect] Error al obtener token del navegador (onStateChange): ${error.message}`);
                }
            }
        });

    } catch (error) {
        console.error(`❌ Error al iniciar WPPConnect: ${error.message}`);
        state.wppConnected = false;
    }
}

// ============================================================
// Inicio del servidor y clientes
// ============================================================
app.listen(PORT, async () => {
    console.log(`🚀 Servidor Express iniciado en puerto ${PORT}`);

    // --- Iniciar cliente de Telegram ---
    try {
        await client.start();
        console.log("✅ Telegram client started and authorized");

        try {
            const entity = await client.getEntity(TARGET_CHAT_ID);
            console.log(`✅ Escuchando en: ${entity.title}`);
        } catch (error) {
            console.error(`❌ Error al acceder al grupo de Telegram: ${error.message}`);
        }

        state.telegramConnected = true;
        console.log("📡 Cliente de Telegram conectado y monitoreando...");
    } catch (error) {
        console.error(`❌ Error al iniciar el cliente de Telegram: ${error.message}`);
    }

    // --- Iniciar WPPConnect (con retardo para no saturar al arrancar) ---
    try {
        // Pequeño retardo para que Telegram se estabilice primero
        setTimeout(async () => {
            await initWPPConnect();
        }, 5000);
    } catch (error) {
        console.error(`❌ Error al iniciar WPPConnect: ${error.message}`);
    }

    console.log("✅ Ambos servicios en proceso de inicio...");
});
