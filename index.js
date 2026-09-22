require('dotenv').config();

const express = require('express');
const axios = require('axios');
const WebSocket = require('ws');
const qrcode = require('qrcode-terminal');
const { makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
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
// Configuración — Baileys (WhatsApp)
// ============================================================
const WPP_SESSION_PATH = process.env.WPP_SESSION_PATH || './wpp-session';

// ============================================================
// Configuración — Supabase Storage (opcional, para compatibilidad futura)
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        db: { schema: 'public' },
        global: { headers: { 'x-my-custom-header': 'my-app-name' } },
        realtime: { transport: WebSocket }
    });
}

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
    wppClient: null,
    lastBotMessageId: null,
};

// ============================================================
// Función: Inicializar WhatsApp con Baileys
// ============================================================
async function initWhatsApp() {
    try {
        console.log('🔍 [WhatsApp] Iniciando cliente Baileys...');

        const { state: authState, saveCreds } = await useMultiFileAuthState(WPP_SESSION_PATH);

        const wpp = makeWASocket({
            auth: authState,
        });

        // Guardar credenciales automáticamente
        wpp.ev.on('creds.update', saveCreds);

        // Conexión exitosa
        wpp.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (connection === 'connecting') {
                console.log('📱 [WhatsApp] Conectando...');
            } else if (connection === 'open') {
                state.wppConnected = true;
                console.log('✅ [WhatsApp] Conectado exitosamente');
                console.log(`📋 Mi ID: ${wpp.user?.id || 'desconocido'}`);
            } else if (connection === 'close') {
                state.wppConnected = false;
                console.log('⚠️ [WhatsApp] Desconectado');

                // Reintentar reconexión (excepto si fue logout intencional - código 401)
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                if (statusCode !== 401) {
                    console.log('🔄 [WhatsApp] Reconectando en 5 segundos...');
                    setTimeout(initWhatsApp, 5000);
                } else {
                    console.log('⚠️ [WhatsApp] Sesión cerrada (401). Escanea QR manualmente.');
                }
            }

            // Manejar QR cuando está disponible
            if (qr) {
                console.log('📷 [WhatsApp] QR disponible - escanéalo con tu teléfono:');
                qrcode.generate(qr, { small: true });
            }
        });

        // Loggear TODOS los mensajes de texto entrantes para debug
        wpp.ev.on('messages.upsert', async ({ messages }) => {
            try {
                for (const msg of messages) {
                    if (!msg.message) continue;

                    // Extraer texto del mensaje
                    const text = msg.message.conversation
                        || msg.message?.extendedTextMessage?.text
                        || '';

                    if (!text) continue;

                    const remoteJid = msg.key.remoteJid;
                    const fromMe = msg.key.fromMe;
                    const isGroup = remoteJid.endsWith('@g.us');
                    const senderNumber = msg.sender || 'desconocido';
                    const senderName = msg.pushName || 'desconocido';
                    const msgId = msg.key.id || 'desconocido';

                    // Determinar si es grupo o chat personal
                    const chatType = isGroup ? 'grupo' : 'chat personal';

                    // Determinar quién escribió el mensaje
                    let senderType;
                    if (fromMe) {
                        senderType = 'YO (usuario)';
                    } else {
                        // Verificar si es el bot (en grupos, el bot puede ser el sender)
                        if (isGroup && senderNumber === wpp.user?.id) {
                            senderType = 'BOT (yo en el grupo)';
                        } else {
                            senderType = 'OTRA PERSONA';
                        }
                    }

                    // ID del remitente limpio (sin sufijo de WhatsApp)
                    const cleanSender = senderNumber.replace('@c.us', '').replace('@s.whatsapp.net', '');

                    console.log(`\n${'='.repeat(50)}`);
                    console.log(`[WhatsApp] 📩 Mensaje recibido`);
                    console.log(`${'='.repeat(50)}`);
                    console.log(`  🆔 Mensaje ID:  ${msgId}`);
                    console.log(`  👤 Remitente:    ${senderName}`);
                    console.log(`  📱 Número:       ${cleanSender}`);
                    console.log(`  📁 Tipo chat:    ${chatType}`);
                    console.log(`  📛 ID del ${chatType}: ${remoteJid}`);
                    console.log(`  🤖 ¿Es mío?:    ${fromMe ? 'Sí (yo)' : 'No'}`);
                    console.log(`  🏷️  Origen:      ${senderType}`);
                    console.log(`  📝 Texto:        ${text}`);
                    console.log(`  ⏰ Timestamp:    ${new Date(msg.messageTimestamp * 1000).toISOString()}`);
                    console.log(`${'='.repeat(50)}\n`);
                }
            } catch (error) {
                console.error(`❌ [WhatsApp] Error en handler de mensaje: ${error.message}`);
            }
        });

        // Guardar referencia al cliente
        state.wppClient = wpp;

        console.log('📱 [WhatsApp] Cliente Baileys inicializado. Escaneando QR...');

    } catch (error) {
        console.error(`❌ [WhatsApp] Error al iniciar Baileys: ${error.message}`);
        state.wppConnected = false;

        // Reintentar en 10 segundos
        console.log('🔄 [WhatsApp] Reintentando en 10 segundos...');
        setTimeout(initWhatsApp, 10000);
    }
}

// ============================================================
// Handler para cierre graceful (SIGTERM)
// ============================================================
async function handleShutdown() {
    console.log('🛑 [Shutdown] Cerrando clientes...');

    try {
        if (state.wppClient) {
            console.log('📱 [Shutdown] Cerrando cliente WhatsApp...');
            await state.wppClient.logout().catch(() => {});
        }
    } catch (error) {
        console.error(`❌ [Shutdown] Error: ${error.message}`);
    } finally {
        process.exit(0);
    }
}

process.on('SIGTERM', handleShutdown);
process.on('SIGINT', handleShutdown);

// ============================================================
// Servidor Express
// ============================================================
const app = express();

app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'TeleClient + WhatsApp (Baileys)',
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
        service: 'WhatsApp (Baileys)',
        connected: state.wppConnected,
        myId: state.wppClient?.user?.id || null,
        sessionPath: WPP_SESSION_PATH,
    });
});

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

    // Iniciar WhatsApp inmediatamente (sin delay)
    initWhatsApp();
});
