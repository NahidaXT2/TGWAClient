require('dotenv').config();

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
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

        console.log(`[WPPConnect] Comando recibido: /${command}`);

        // Buscar el comando en el diccionario
        const response = wppCommands[command];

        if (response) {
            await wpp.sendText(message.id.remote, response);
            console.log(`[WPPConnect] Respuesta enviada: ${response.substring(0, 50)}`);
        } else {
            console.log(`[WPPConnect] Comando no encontrado: /${command}`);
        }
    } catch (error) {
        console.error(`❌ [WPPConnect] Error al procesar comando: ${error.message}`);
    }
}

// ============================================================
// Función: Enviar información de sesión a n8n
// ============================================================
async function sendSessionToN8N(session) {
    try {
        const webhookUrl = process.env.N8N_WEBHOOK_URL;
        if (!webhookUrl) {
            console.warn('⚠️ N8N_WEBHOOK_URL no configurado, no se enviará la sesión');
            return;
        }

        // Intentar leer archivos de sesión de WPPConnect
        const tokenDir = path.join(__dirname, 'tokens', WPP_SESSION_NAME);
        let sessionFiles = {};

        try {
            if (fs.existsSync(tokenDir)) {
                const files = fs.readdirSync(tokenDir);
                for (const file of files) {
                    const filePath = path.join(tokenDir, file);
                    try {
                        const content = fs.readFileSync(filePath, 'utf8');
                        sessionFiles[file] = content;
                    } catch (err) {
                        console.warn(`⚠️ No se pudo leer el archivo ${file}: ${err.message}`);
                    }
                }
            }
        } catch (err) {
            console.warn(`⚠️ No se pudo acceder a la carpeta de tokens: ${err.message}`);
        }

        const sessionData = {
            type: 'wpp_session',
            sessionName: WPP_SESSION_NAME,
            timestamp: new Date().toISOString(),
            status: 'connected',
            tokenDirectory: tokenDir,
            sessionFiles: sessionFiles,
            note: 'Guarda el contenido de sessionFiles en tus secrets para persistir la sesión'
        };

        console.log('📤 Enviando información de sesión a n8n...');

        const response = await axios.post(webhookUrl, sessionData, {
            headers: { "Content-Type": "application/json" },
            timeout: 10000,
        });

        console.log(`✅ Información de sesión enviada a n8n: ${response.status}`);
    } catch (error) {
        console.error(`❌ Error al enviar sesión a n8n: ${error.message}`);
    }
}

// ============================================================
// Función: Inicializar WPPConnect
// ============================================================
async function initWPPConnect() {
    try {
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

                    // Enviar información de sesión al webhook de n8n
                    sendSessionToN8N(session);
                }
            },
        };

        // wppconnect usa create function para inicializar
        const client = await wpp.create(options);

        // Escuchar eventos de mensajes entrantes
        client.onMessage(async (message) => {
            try {
                await handleWPPCommand(client, message);
            } catch (error) {
                console.error(`❌ [WPPConnect] Error en handler de mensaje: ${error.message}`);
            }
        });

        // Escuchar eventos de estado de la sesión
        client.onStateChange((status) => {
            console.log(`[WPPConnect] Cambio de estado: ${status}`);

            if (status === 'CONNECTED' || status === 'isLogged') {
                state.wppConnected = true;
                state.wppQRCode = null;

                // Enviar información de sesión al webhook de n8n
                sendSessionToN8N(client);
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
