require('dotenv').config();

const express = require('express');
const axios = require('axios');
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
        console.log(`[${source}] Procesando mensaje: ${messageText.substring(0, 30)}...`);

        const lowerText = messageText.toLowerCase();
        const matchedWords = wordsToReact.filter((word) => lowerText.includes(word));

        if (matchedWords.length > 0) {
            console.log(`🔍 [${source}] Palabras clave encontradas: ${matchedWords.join(', ')}`);

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
                console.log(`✅ [${source}] Mensaje enviado a n8n: ${response.status}`);
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

// Handler de debug: todos los mensajes
client.addEventHandler(
    async (event) => {
        const chatId = event.chatId;
        console.log(`DEBUG [Telegram]: Mensaje recibido de chat ${chatId}`);
    },
    new NewMessage({})
);

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
    });
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
// Función: Inicializar WPPConnect
// ============================================================
async function initWPPConnect() {
    try {
        console.log("🚀 Iniciando WPPConnect...");

        const wpp = require('wppconnect');

        const options = {
            session: WPP_SESSION_NAME,
            headless: true,
            logV1: false,
            logV2: false,
            logV3: false,
        };

        // wppconnect usa create function para inicializar
        await wpp.create(options);

        // Escuchar eventos de mensajes entrantes
        wpp.onMessage(async (message) => {
            try {
                await handleWPPCommand(wpp, message);
            } catch (error) {
                console.error(`❌ [WPPConnect] Error en handler de mensaje: ${error.message}`);
            }
        });

        // Escuchar eventos de estado de la sesión
        wpp.onStateChange((state) => {
            console.log(`[WPPConnect] Cambio de estado: ${state}`);
        });

        console.log("✅ WPPConnect iniciado y conectado");
        state.wppConnected = true;

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
