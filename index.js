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
// Función: Subir archivos de sesión a Supabase
// ============================================================
async function uploadSessionToSupabase() {
    try {
        if (!supabase) {
            console.warn('⚠️ Supabase no configurado, no se guardará la sesión');
            return;
        }

        const tokenDir = path.join(__dirname, 'tokens', WPP_SESSION_NAME);

        if (!fs.existsSync(tokenDir)) {
            console.warn('⚠️ Carpeta de tokens no existe');
            return;
        }

        const files = fs.readdirSync(tokenDir);
        const fileCount = files.filter(file => {
            const filePath = path.join(tokenDir, file);
            return fs.statSync(filePath).isFile();
        }).length;

        console.log(`📤 Subiendo ${fileCount} archivos a Supabase...`);

        for (const file of files) {
            const filePath = path.join(tokenDir, file);

            try {
                // Omitir directorios, solo procesar archivos
                if (!fs.statSync(filePath).isFile()) {
                    continue;
                }

                const fileBuffer = fs.readFileSync(filePath);
                const fileName = `${WPP_SESSION_NAME}/${file}`;

                const { data, error } = await supabase.storage
                    .from(SUPABASE_BUCKET)
                    .upload(fileName, fileBuffer, {
                        upsert: true
                    });

                if (error) {
                    console.error(`❌ Error al subir ${file}:`, error.message);
                } else {
                    console.log(`✅ ${file} subido correctamente`);
                }
            } catch (fileError) {
                console.warn(`⚠️ Omitiendo ${file}: ${fileError.message}`);
                continue;
            }
        }

        console.log('✅ Sesión guardada en Supabase');
    } catch (error) {
        console.error(`❌ Error al subir sesión a Supabase: ${error.message}`);
    }
}

// ============================================================
// Función: Descargar archivos de sesión desde Supabase
// ============================================================
async function downloadSessionFromSupabase() {
    try {
        if (!supabase) {
            console.warn('⚠️ Supabase no configurado, no se restaurará la sesión');
            return false;
        }

        const tokenDir = path.join(__dirname, 'tokens', WPP_SESSION_NAME);

        // Crear carpeta si no existe
        if (!fs.existsSync(tokenDir)) {
            fs.mkdirSync(tokenDir, { recursive: true });
        }

        console.log('📥 Descargando sesión desde Supabase...');

        // Listar archivos de la sesión
        const { data: files, error } = await supabase.storage
            .from(SUPABASE_BUCKET)
            .list(WPP_SESSION_NAME);

        if (error) {
            console.error('❌ Error al listar archivos:', error.message);
            return false;
        }

        if (!files || files.length === 0) {
            console.log('ℹ️ No hay archivos de sesión en Supabase');
            return false;
        }

        // Descargar cada archivo
        for (const file of files) {
            if (file.name === '') continue; // Ignorar carpetas

            const fileName = `${WPP_SESSION_NAME}/${file.name}`;
            const { data: fileData, error: downloadError } = await supabase.storage
                .from(SUPABASE_BUCKET)
                .download(fileName);

            if (downloadError) {
                console.error(`❌ Error al descargar ${file.name}:`, downloadError.message);
                continue;
            }

            const filePath = path.join(tokenDir, file.name);
            const buffer = Buffer.from(await fileData.arrayBuffer());
            fs.writeFileSync(filePath, buffer);
            console.log(`✅ ${file.name} descargado`);
        }

        console.log('✅ Sesión restaurada desde Supabase');
        return true;
    } catch (error) {
        console.error(`❌ Error al descargar sesión de Supabase: ${error.message}`);
        return false;
    }
}

// ============================================================
// Función: Inicializar WPPConnect
// ============================================================
async function initWPPConnect() {
    try {
        // Intentar restaurar sesión desde Supabase antes de iniciar
        const sessionRestored = await downloadSessionFromSupabase();

        const wpp = require('@wppconnect-team/wppconnect');

        const options = {
            session: WPP_SESSION_NAME,
            headless: true,
            logV1: false,
            logV2: false,
            logV3: false,
            puppeteerOptions: {
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
            catchQR: (base64QR, asciiQR) => {
                state.wppQRCode = base64QR;
            },
            statusFind: (statusSession, session) => {
                if (statusSession === 'isLogged' || statusSession === 'CONNECTED') {
                    state.wppConnected = true;
                    state.wppQRCode = null;

                    // Subir sesión a Supabase cuando se conecte
                    uploadSessionToSupabase();
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
        client.onStateChange((status) => {
            console.log(`[WPPConnect] Cambio de estado: ${status}`);

            if (status === 'CONNECTED' || status === 'isLogged') {
                state.wppConnected = true;
                state.wppQRCode = null;

                // Subir sesión a Supabase cuando se conecte
                uploadSessionToSupabase();
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
