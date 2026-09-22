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
            
            if (!supabase) return undefined;

            const fileName = `${sessionName}_token.json`;
            const { data, error } = await supabase.storage
                .from(SUPABASE_BUCKET)
                .download(fileName);

            if (error) {
                console.log(`ℹ️ [TokenStore] No hay sesión guardada para ${sessionName}: ${error.message}`);
                return undefined;
            }

            const content = await data.text();
            const tokenData = JSON.parse(content);
            
            if (!isValidSessionToken(tokenData)) {
                console.error(`❌ [TokenStore] Token recuperado no es válido para ${sessionName}`);
                return undefined;
            }

            console.log(`✅ [TokenStore] Sesión restaurada desde Supabase para ${sessionName}`);
            return tokenData;
        } catch (error) {
            console.error(`❌ [TokenStore] Error al obtener token de Supabase: ${error.message}`);
            return undefined;
        }
    },

    setToken: async (sessionName, tokenData) => {
        try {
            console.log(`💾 [TokenStore] setToken llamado para: ${sessionName}`);
            
            if (!supabase) return false;

            if (!isValidSessionToken(tokenData)) {
                console.error(`❌ [TokenStore] Intentando guardar token inválido para ${sessionName}`);
                return false;
            }

            const fileName = `${sessionName}_token.json`;
            const content = JSON.stringify(tokenData);
            const fileBuffer = Buffer.from(content);

            const { error } = await supabase.storage
                .from(SUPABASE_BUCKET)
                .upload(fileName, fileBuffer, { upsert: true });

            if (error) {
                console.error(`❌ [TokenStore] Error al guardar token en Supabase: ${error.message}`);
                return false;
            }

            console.log(`✅ [TokenStore] Sesión guardada en Supabase para ${sessionName}`);
            return true;
        } catch (error) {
            console.error(`❌ [TokenStore] Error en setToken: ${error.message}`);
            return false;
        }
    },

    removeToken: async (sessionName) => {
        try {
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
            if (!supabase) return [];

            const { data: files, error } = await supabase.storage
                .from(SUPABASE_BUCKET)
                .list();

            if (error) return [];

            return files
                .filter(file => file.name.endsWith('_token.json'))
                .map(file => file.name.replace('_token.json', ''));
        } catch (error) {
            return [];
        }
    }
};

// Diccionario de comandos de WhatsApp
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

            await axios.post(N8N_WEBHOOK_URL, payload, {
                headers: { "Content-Type": "application/json" },
                timeout: 10000,
            });
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
    { connectionRetries: 5 }
);

client.addEventHandler(
    async (event) => {
        const messageText = event.message.message || "";
        await processMessage(messageText, 'telegram', {
            chatId: event.chatId,
            senderId: event.senderId,
        });
    },
    new NewMessage({ chats: [TARGET_CHAT_ID] })
);

// ============================================================
// Estado global de conexión
// ============================================================
const state = {
    telegramConnected: false,
    wppConnected: false,
    wppQRCode: null,
    lastBotMessageId: null,
};

// ============================================================
// Servidor Express
// ============================================================
const app = express();

app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'TeleClient + WPPConnect (Node.js)',
        telegramConnected: state.telegramConnected,
        wppConnected: state.wppConnected,
    });
});

app.get('/telegram', (req, res) => {
    res.json({
        status: state.telegramConnected ? 'connected' : 'disconnected',
        service: 'Telegram (teleproto/gramjs)',
        connected: state.telegramConnected,
        targetChatId: TARGET_CHAT_ID,
    });
});

app.get('/wpp', (req, res) => {
    res.json({
        status: state.wppConnected ? 'connected' : 'disconnected',
        service: 'WPPConnect (WhatsApp Web) — Bot de Comandos',
        connected: state.wppConnected,
        sessionName: WPP_SESSION_NAME,
        hasQRCode: !!state.wppQRCode,
    });
});

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

app.get('/wpp/qr-page', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Escanea el QR de WhatsApp</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: Arial, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
        .container { text-align: center; padding: 20px; background: white; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; }
        #qr-image { max-width: 300px; margin: 20px 0; }
        .status { margin-top: 20px; padding: 10px; border-radius: 5px; background: #e7f3ff; }
        .instructions { margin-top: 20px; font-size: 14px; color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📱 Vincular WhatsApp</h1>
        <div id="qr-container"><p>Cargando código QR...</p></div>
        <div class="status" id="status">Estado: Esperando QR...</div>
        <div class="instructions">
            <p>1. Abre WhatsApp en tu teléfono</p>
            <p>2. Ve a Menú → Dispositivos vinculados → Vincular un dispositivo</p>
            <p>3. Escanea el código QR</p>
        </div>
    </div>
    <script>
        function checkQR() {
            fetch('/wpp/qr')
                .then(response => response.json())
                .then(data => {
                    if (data.qrCode) {
                        document.getElementById('qr-container').innerHTML = '<img id="qr-image" src="' + data.qrCode + '" alt="QR Code">';
                        document.getElementById('status').textContent = 'Estado: QR listo para escanear';
                    } else {
                        document.getElementById('status').textContent = 'Estado: Esperando QR...';
                    }
                })
                .catch(() => {
                    document.getElementById('status').textContent = 'Estado: Error al cargar QR';
                });
        }
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
        if (!message.body.startsWith('/')) return;

        const command = message.body.substring(1).split(' ')[0].toLowerCase();
        const response = wppCommands[command];

        if (response) {
            const sentMessage = await wpp.sendText(message.to || message.id.remote, response);
            if (sentMessage && sentMessage.id) {
                state.lastBotMessageId = sentMessage.id;
            }
        }
    } catch (error) {
        console.error(`❌ [WPPConnect] Error al procesar comando: ${error.message}`);
    }
}

// ============================================================
// Función: Descargar archivos de sesión desde Supabase
// ============================================================
async function downloadWPPSessionFiles() {
    try {
        if (!supabase) {
            console.warn('⚠️ Supabase no configurado, no se restaurará la sesión');
            return false;
        }

        const tokenDir = path.join(__dirname, 'tokens', WPP_SESSION_NAME);
        if (!fs.existsSync(tokenDir)) {
            fs.mkdirSync(tokenDir, { recursive: true });
        }

        console.log('🔍 [WPPConnect] Descargando archivos de sesión desde Supabase...');

        const { data: files, error } = await supabase.storage
            .from(SUPABASE_BUCKET)
            .list(WPP_SESSION_NAME);

        if (error || !files || files.length === 0) {
            console.log('ℹ️ [WPPConnect] No hay archivos de sesión guardados en Supabase');
            return false;
        }

        let downloadedCount = 0;
        for (const file of files) {
            if (file.name === '') continue;

            const fileName = `${WPP_SESSION_NAME}/${file.name}`;
            const { data: fileData, error: downloadError } = await supabase.storage
                .from(SUPABASE_BUCKET)
                .download(fileName);

            if (downloadError) continue;

            const filePath = path.join(tokenDir, file.name);
            const buffer = Buffer.from(await fileData.arrayBuffer());
            fs.writeFileSync(filePath, buffer);
            downloadedCount++;
        }

        console.log(`✅ [WPPConnect] Sesión restaurada desde Supabase (${downloadedCount} archivos)`);
        return downloadedCount > 0;
    } catch (error) {
        console.error(`❌ [WPPConnect] Error al descargar sesión: ${error.message}`);
        return false;
    }
}

// ============================================================
// Función: Subir archivos de sesión a Supabase
// ============================================================
async function uploadWPPSessionFiles() {
    try {
        if (!supabase) return;

        const tokenDir = path.join(__dirname, 'tokens', WPP_SESSION_NAME);
        if (!fs.existsSync(tokenDir)) return;

        const files = fs.readdirSync(tokenDir);
        if (files.length === 0) return;

        let uploadedCount = 0;
        for (const file of files) {
            const filePath = path.join(tokenDir, file);

            try {
                if (!fs.statSync(filePath).isFile()) continue;

                const fileBuffer = fs.readFileSync(filePath);
                const fileName = `${WPP_SESSION_NAME}/${file}`;

                const { error } = await supabase.storage
                    .from(SUPABASE_BUCKET)
                    .upload(fileName, fileBuffer, { upsert: true });

                if (!error) uploadedCount++;
            } catch {
                continue;
            }
        }

        console.log(`✅ [WPPConnect] Sesión guardada en Supabase (${uploadedCount} archivos)`);
    } catch (error) {
        console.error(`❌ [WPPConnect] Error al subir sesión: ${error.message}`);
    }
}

// ============================================================
// Función: Inicializar WPPConnect
// ============================================================
async function initWPPConnect() {
    try {
        console.log('🔍 [WPPConnect] Iniciando servicio...');
        console.log('🔍 [WPPConnect] Supabase cliente configurado:', !!supabase);

        const wpp = require('@wppconnect-team/wppconnect');

        const options = {
            session: WPP_SESSION_NAME,
            autoClose: 0, // Evita que se cierre automáticamente si tarda en conectar
            headless: true,
            logQR: false,
            logV1: false,
            logV2: false,
            logV3: false,
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
            // WPPConnect usará este tokenStore internamente para guardar/leer en Supabase
            tokenStore: supabaseTokenStore,
            catchQR: (base64QR) => {
                state.wppQRCode = base64QR;
            },
            statusFind: (statusSession) => {
                console.log(`📊 [WPPConnect] statusFind: ${statusSession}`);
                if (['isLogged', 'CONNECTED', 'qrReadSuccess'].includes(statusSession)) {
                    state.wppConnected = true;
                    state.wppQRCode = null;
                }
            },
        };

        const client = await wpp.create(options);

        // Guardar explícitamente el token en Supabase cuando el cliente esté totalmente listo
        try {
            const tokenData = await client.getSessionTokenBrowser();
            if (tokenData && isValidSessionToken(tokenData)) {
                await supabaseTokenStore.setToken(WPP_SESSION_NAME, tokenData);
            }
        } catch (e) {
            console.error(`⚠️ No se pudo extraer el token inicial: ${e.message}`);
        }

        // Escuchar mensajes entrantes
        client.onMessage(async (message) => {
            try {
                if (message.fromMe && state.lastBotMessageId === message.id.id) return;

                if (WPP_GROUP_ID) {
                    if (message.fromMe && message.to === WPP_GROUP_ID) {
                        await handleWPPCommand(client, message);
                    }
                    return;
                }

                if (WPP_USER_NUMBER) {
                    let userNumber = message.from.replace('@c.us', '').replace('@s.whatsapp.net', '').replace('@g.us', '');
                    if (userNumber !== WPP_USER_NUMBER) return;
                }

                await handleWPPCommand(client, message);
            } catch (error) {
                console.error(`❌ [WPPConnect] Error en handler de mensaje: ${error.message}`);
            }
        });

        client.onAnyMessage(async (message) => {
            try {
                if (WPP_GROUP_ID && message.to !== WPP_GROUP_ID) return;

                if (WPP_GROUP_ID) {
                    if (message.fromMe && message.to === WPP_GROUP_ID) {
                        await handleWPPCommand(client, message);
                    }
                    return;
                }

                if (WPP_USER_NUMBER) {
                    let userNumber = message.from.replace('@c.us', '').replace('@s.whatsapp.net', '').replace('@g.us', '');
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

        // Actualizar estado y respaldar token si cambia de estado
        client.onStateChange(async (status) => {
            console.log(`[WPPConnect] Cambio de estado: ${status}`);
            if (['CONNECTED', 'isLogged'].includes(status)) {
                state.wppConnected = true;
                state.wppQRCode = null;

                try {
                    const tokenData = await client.getSessionTokenBrowser();
                    if (tokenData && isValidSessionToken(tokenData)) {
                        await supabaseTokenStore.setToken(WPP_SESSION_NAME, tokenData);
                    }
                } catch (e) {
                    console.error(`❌ Error guardando token: ${e.message}`);
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

    setTimeout(async () => {
        await initWPPConnect();
    }, 5000);
});