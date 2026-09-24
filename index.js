require('dotenv').config();

const express = require('express');
const axios = require('axios');
const WebSocket = require('ws');
const QRCode = require('qrcode');
const {
    makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers,
} = require('@whiskeysockets/baileys');
const { createClient } = require('@supabase/supabase-js');
const { TelegramClient } = require('teleproto');
const { StringSession } = require('teleproto/sessions');
const { NewMessage } = require('teleproto/events');
const { useSupabaseAuthState } = require('./supabase-auth-state');

// ============================================================
// Utilidades de privacidad
// ============================================================
function maskJid(jid) {
    if (!jid) return 'unknown';
    const s = String(jid);
    const at = s.indexOf('@');
    const local = at === -1 ? s : s.slice(0, at);
    const domain = at === -1 ? '' : s.slice(at);

    if (local.length <= 8) return `***${domain}`;
    return `${local.slice(0, 3)}***${local.slice(-3)}${domain}`;
}

// ============================================================
// Anti-loop: tracking de IDs enviados por el bot
// ============================================================
const sentMessageIds = new Set();
const SENT_IDS_MAX = 500;

function trackSentMessage(id) {
    if (!id) return;
    sentMessageIds.add(id);
    if (sentMessageIds.size > SENT_IDS_MAX) {
        const first = sentMessageIds.values().next().value;
        sentMessageIds.delete(first);
    }
}

// ============================================================
// Caches
// ============================================================
function createSafeCache() {
    const store = new Map();
    return {
        get: (key) => store.get(key),
        set: (key, value) => { store.set(key, value); return true; },
        del: (key) => {
            if (key == null) return 0;
            return store.delete(key) ? 1 : 0;
        },
        flushAll: () => { store.clear(); },
    };
}

// ============================================================
// Loggers
// ============================================================
const cacheLogger = {
    level: 'silent',
    fatal: () => { }, error: () => { }, warn: () => { }, info: () => { }, debug: () => { }, trace: () => { },
    child: () => cacheLogger,
};

const socketLogger = {
    level: 'warn',
    fatal: (...args) => console.error('[baileys][fatal]', ...args),
    error: (...args) => {
        const joined = args.map((a) => (typeof a === 'string' ? a : '')).join(' ');

        // 1) Timeout benigno al pedir props iniciales
        if (joined.includes("unexpected error in 'init queries'")) return;

        // 2) Reintentos de descifrado de mensajes ya procesados (fromMe / reconnects).
        //    Benigno: el mensaje ya se procesó la primera vez. No se pierde nada.
        //    Comenta esta línea si algún día quieres verlos de nuevo.
        if (joined.includes('MessageCounterError') && joined.includes('Key used already')) return;

        console.error('[baileys][error]', ...args);
    },
    warn: (...args) => console.warn('[baileys][warn ]', ...args),
    info: () => { }, debug: () => { }, trace: () => { },
    child: () => socketLogger,
};

// ============================================================
// Configuración — Telegram
// ============================================================
const API_ID = parseInt(process.env.API_ID, 10);
const API_HASH = process.env.API_HASH;
const SESSION_STR = process.env.TELEGRAM_SESSION;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const PORT = process.env.PORT || 7860;

// ============================================================
// Palabras clave a detectar (desde .env, separadas por comas)
// ============================================================
const wordsToReact = (process.env.WORDS_TO_REACT || '')
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean); // elimina strings vacíos

if (wordsToReact.length === 0) {
    console.warn('⚠️ WORDS_TO_REACT no configurado o vacío. No se detectará ninguna palabra clave.');
}

const TARGET_CHAT_ID = process.env.TG_TARGET_GROUP;

// ============================================================
// Configuración — Baileys (WhatsApp)
// ============================================================
const WPP_SESSION_PATH = process.env.WPP_SESSION_PATH || './wpp-session';
const WPP_SESSION_ID = process.env.WPP_SESSION_ID || 'default';
const TARGET_WPP_GROUP = process.env.WS_TARGET_GROUP || '';

// ============================================================
// Configuración — Supabase
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
// Validación de entorno
// ============================================================
const requiredVars = ["API_ID", "API_HASH", "TELEGRAM_SESSION", "N8N_WEBHOOK_URL"];
const missingVars = requiredVars.filter((v) => !process.env[v]);
if (missingVars.length > 0) {
    console.error(`❌ Faltan las siguientes variables de entorno: ${missingVars.join(', ')}`);
    process.exit(1);
}

const supabaseVars = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missingSupabaseVars = supabaseVars.filter((v) => !process.env[v]);
if (missingSupabaseVars.length > 0 && missingSupabaseVars.length < supabaseVars.length) {
    console.warn(`⚠️ Variables de Supabase incompletas: ${missingSupabaseVars.join(', ')}`);
} else if (missingSupabaseVars.length === 0) {
    console.log('✅ Variables de Supabase configuradas correctamente');
} else {
    console.log('ℹ️ Supabase no configurado (opcional)');
}

console.log("✅ Todas las variables de entorno están configuradas");
console.log(TARGET_WPP_GROUP
    ? `🎯 [WhatsApp] Filtrando solo mensajes del grupo: ${maskJid(TARGET_WPP_GROUP)}`
    : `⚠️ [WhatsApp] WS_TARGET_GROUP no configurado. Se procesarán TODOS tus chats.`);

// ============================================================
// Comandos WhatsApp
// ============================================================
const COMMANDS = {
    now: {
        description: 'Muestra la hora del servidor',
        handler: async () => {
            const now = new Date();
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const local = now.toLocaleString('es-PE', { hour12: false });
            return [
                `🕐 Hora del servidor:`,
                `  • Local:  ${local}`,
                `  • ISO:    ${now.toISOString()}`,
                `  • TZ:     ${tz}`,
                `  • Epoch:  ${now.getTime()}`,
            ].join('\n');
        },
    },
    ping: {
        description: 'Verifica que el bot está vivo',
        handler: async () => `🏓 Pong (${Date.now()})`,
    },
    echo: {
        description: 'Repite el texto que envíes: /echo hola mundo',
        handler: async ({ args }) => args.length ? args.join(' ') : '(vacío)',
    },
    help: {
        description: 'Lista los comandos disponibles',
        handler: async () => {
            const lines = ['📋 Comandos disponibles:'];
            for (const [name, cmd] of Object.entries(COMMANDS)) {
                lines.push(`  /${name} — ${cmd.description}`);
            }
            return lines.join('\n');
        },
    },
};

function parseCommand(text) {
    const trimmed = text.trim();
    if (!trimmed.startsWith('/')) return null;
    const parts = trimmed.slice(1).split(/\s+/);
    if (!parts[0]) return null;
    return { name: parts[0].toLowerCase(), args: parts.slice(1) };
}

// ============================================================
// WhatsApp → n8n (payload original, sin cambios)
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

            console.log(`📤 [${source}] Mensaje enviado a n8n (keywords: ${matchedWords.join(', ')})`);
        }
    } catch (error) {
        console.error(`❌ [${source}] Error procesando mensaje: ${error.message}`);
    }
}

// ============================================================
// Telegram → n8n (payload específico)
// ============================================================
// Formato enviado al webhook:
//   {
//     "detected_word": "bug",
//     "message": "hola bug",
//     "sender": "Edu"
//   }
// En n8n:
//   {{ $json.detected_word }} / {{ $json.message }} - [{{ $json.sender }}]
async function processTelegramMessage(messageText, senderName) {
    try {
        const lowerText = messageText.toLowerCase();
        const matchedWords = wordsToReact.filter((word) => lowerText.includes(word));

        if (matchedWords.length === 0) return;

        const payload = {
            detected_word: matchedWords[0],   // primera coincidencia
            message: messageText,
            sender: senderName || 'unknown',
        };

        await axios.post(N8N_WEBHOOK_URL, payload, {
            headers: { "Content-Type": "application/json" },
            timeout: 10000,
        });

        console.log(`📤 [telegram] Enviado a n8n (word: ${payload.detected_word})`);
    } catch (error) {
        console.error(`❌ [telegram] Error procesando mensaje: ${error.message}`);
    }
}

// ============================================================
// Telegram client
// ============================================================
const sessionString = SESSION_STR || '';
const client = new TelegramClient(
    new StringSession(sessionString),
    API_ID,
    API_HASH,
    { connectionRetries: 5 }
);

// Resuelve un nombre legible para el remitente del mensaje.
// Prioriza username → nombre completo → ID (como string).
async function resolveTelegramSender(event) {
    try {
        const sender = await event.message.getSender();
        if (!sender) return String(event.senderId || 'unknown');

        if (sender.username) return sender.username;

        const fullName = [sender.firstName, sender.lastName]
            .filter(Boolean)
            .join(' ')
            .trim();
        if (fullName) return fullName;

        return String(sender.id || event.senderId || 'unknown');
    } catch (e) {
        return String(event.senderId || 'unknown');
    }
}

client.addEventHandler(
    async (event) => {
        try {
            const messageText = event.message.message || "";
            if (!messageText) return;

            const senderName = await resolveTelegramSender(event);
            await processTelegramMessage(messageText, senderName);
        } catch (err) {
            console.error(`❌ [telegram] Error en handler: ${err.message}`);
        }
    },
    new NewMessage({ chats: [TARGET_CHAT_ID] })
);

// ============================================================
// Estado global
// ============================================================
const state = {
    telegramConnected: false,
    wppConnected: false,
    wppClient: null,
    wppQRCode: null,
    shuttingDown: false,
};

// ============================================================
// Tracking de CAPTCHAs pendientes (request-response bloqueante)
// Almacena: messageId => { resolve, reject, timeout }
// ============================================================
const pendingCaptchas = new Map();
const WPP_CAPTCHA_TIMEOUT = parseInt(process.env.WPP_CAPTCHA_TIMEOUT, 10) || 30000; // 30s por defecto

function registerPendingCaptcha(messageId) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            if (pendingCaptchas.has(messageId)) {
                pendingCaptchas.delete(messageId);
                reject(new Error('Timeout: el usuario no respondió al CAPTCHA en ' + WPP_CAPTCHA_TIMEOUT + 'ms'));
            }
        }, WPP_CAPTCHA_TIMEOUT);
        pendingCaptchas.set(messageId, { resolve, reject, timeout });
    });
}

// ============================================================
// Inicializar WhatsApp
// ============================================================
async function initWhatsApp() {
    try {
        console.log('🔍 [WhatsApp] Iniciando cliente Baileys...');

        let authState, saveCreds;

        if (supabase) {
            console.log('📦 [WhatsApp] Usando Supabase para persistencia de sesión');
            const supabaseAuth = await useSupabaseAuthState(
                SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WPP_SESSION_ID
            );
            authState = supabaseAuth.state;
            saveCreds = supabaseAuth.saveCreds;
        } else {
            console.log('📁 [WhatsApp] Usando sistema de archivos local para persistencia');
            const fileAuth = await useMultiFileAuthState(WPP_SESSION_PATH);
            authState = fileAuth.state;
            saveCreds = fileAuth.saveCreds;
        }

        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`📡 [WhatsApp] Baileys version: ${version.join('.')} (latest: ${isLatest})`);

        const wpp = makeWASocket({
            version,
            auth: {
                creds: authState.creds,
                keys: makeCacheableSignalKeyStore(authState.keys, cacheLogger),
            },
            browser: Browsers.ubuntu('Chrome'),
            printQRInTerminal: false,
            emitOwnEvents: true,
            shouldSyncHistoryMessage: () => false,
            syncFullHistory: false,
            connectTimeoutMs: 60_000,
            logger: socketLogger,
            msgRetryCounterCache: createSafeCache(),
        });

        wpp.ev.on('creds.update', saveCreds);

        wpp.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (connection === 'connecting') {
                console.log('📱 [WhatsApp] Conectando...');
            } else if (connection === 'open') {
                state.wppConnected = true;
                state.wppQRCode = null;
                console.log('✅ [WhatsApp] Conectado exitosamente');
            } else if (connection === 'close') {
                state.wppConnected = false;
                console.log('⚠️ [WhatsApp] Desconectado');

                if (state.shuttingDown) {
                    console.log('🛑 [WhatsApp] Shutdown en progreso, no se reintenta.');
                    return;
                }

                const statusCode = lastDisconnect?.error?.output?.statusCode;
                if (statusCode !== 401) {
                    console.log('🔄 [WhatsApp] Reconectando en 5 segundos...');
                    setTimeout(initWhatsApp, 5000);
                } else {
                    console.log('⚠️ [WhatsApp] Sesión cerrada (401). Visita /wpp/reconnect para limpiar y escanear QR nuevo.');
                }
            }

            if (qr) {
                try {
                    const qrImage = await QRCode.toDataURL(qr);
                    state.wppQRCode = qrImage;
                    console.log('📷 [WhatsApp] QR generado (visible en http://localhost:' + PORT + '/wpp/qr)');
                } catch (e) {
                    console.log('📷 [WhatsApp] QR generado');
                }
            }
        });

        wpp.ev.on('messages.upsert', async ({ messages }) => {
            try {
                for (const msg of messages) {
                    if (!msg.message) continue;

                    const remoteJid = msg.key.remoteJid;
                    const fromMe = msg.key.fromMe;
                    const msgId = msg.key.id;

                    if (TARGET_WPP_GROUP && remoteJid !== TARGET_WPP_GROUP) continue;

                    // Extraer texto temprano para detección de CAPTCHA (antes de filtrar fromMe)
                    const text =
                        msg.message.conversation ||
                        msg.message.extendedTextMessage?.text ||
                        msg.message.imageMessage?.caption ||
                        msg.message.videoMessage?.caption ||
                        '';

                    const senderJid = msg.key.participant || wpp.user?.id;

                    // Detectar respuestas a mensajes de CAPTCHA
                    const contextInfo = msg.message.extendedTextMessage?.contextInfo;
                    const stanzaId = contextInfo?.stanzaId;
                    if (stanzaId && pendingCaptchas.has(stanzaId) && text) {
                        const captchaEntry = pendingCaptchas.get(stanzaId);
                        clearTimeout(captchaEntry.timeout);
                        pendingCaptchas.delete(stanzaId);
                        captchaEntry.resolve({ response: text, senderJid });
                        console.log(`📤 [WhatsApp] Respuesta de CAPTCHA recibida (${stanzaId})`);
                        continue;
                    }

                    if (!fromMe) continue;

                    if (sentMessageIds.has(msgId)) {
                        sentMessageIds.delete(msgId);
                        continue;
                    }

                    if (!text) continue;

                    const cmd = parseCommand(text);
                    if (cmd) {
                        console.log(`⌨️  [WhatsApp] Comando recibido: /${cmd.name}`);

                        const entry = COMMANDS[cmd.name];
                        if (!entry) {
                            console.log(`❓ [WhatsApp] Comando desconocido: /${cmd.name}`);
                            continue;
                        }

                        try {
                            const reply = await entry.handler({
                                sock: wpp,
                                remoteJid,
                                senderJid,
                                args: cmd.args,
                                msg,
                            });

                            if (reply) {
                                const sent = await wpp.sendMessage(remoteJid, { text: reply });
                                trackSentMessage(sent?.key?.id);
                                console.log(`🤖 [WhatsApp] Respuesta enviada: /${cmd.name}`);
                            }
                        } catch (err) {
                            console.error(`❌ [WhatsApp] Error en /${cmd.name}: ${err.message}`);
                        }

                        continue;
                    }

                    await processMessage(text, 'whatsapp', {
                        chatId: remoteJid,
                        senderId: senderJid,
                        msgId,
                        fromMe: true,
                    });
                }
            } catch (error) {
                console.error(`❌ [WhatsApp] Error en handler: ${error.message}`);
            }
        });

        state.wppClient = wpp;

    } catch (error) {
        console.error(`❌ [WhatsApp] Error al iniciar Baileys: ${error.message}`);
        state.wppConnected = false;

        if (state.shuttingDown) return;
        console.log('🔄 [WhatsApp] Reintentando en 10 segundos...');
        setTimeout(initWhatsApp, 10000);
    }
}

// ============================================================
// Shutdown
// ============================================================
async function handleShutdown() {
    if (state.shuttingDown) return;
    state.shuttingDown = true;

    console.log('🛑 [Shutdown] Cerrando clientes...');

    try {
        if (state.wppClient) {
            console.log('📱 [Shutdown] Cerrando cliente WhatsApp (SIN logout)...');
            try {
                state.wppClient.ev.removeAllListeners('creds.update');
                state.wppClient.ev.removeAllListeners('connection.update');
                state.wppClient.ev.removeAllListeners('messages.upsert');
            } catch (_) { /* noop */ }

            try {
                if (typeof state.wppClient.end === 'function') {
                    state.wppClient.end(undefined);
                } else {
                    state.wppClient.ws?.close();
                }
            } catch (_) { /* noop */ }
        }
    } catch (error) {
        console.error(`❌ [Shutdown] Error: ${error.message}`);
    } finally {
        setTimeout(() => process.exit(0), 500);
    }
}

process.on('SIGTERM', handleShutdown);
process.on('SIGINT', handleShutdown);

// ============================================================
// Express
// ============================================================
const app = express();
app.use(express.json());

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
        targetChatId: maskJid(String(TARGET_CHAT_ID)),
    });
});

app.get('/wpp', (req, res) => {
    res.json({
        status: state.wppConnected ? 'connected' : 'disconnected',
        service: 'WhatsApp (Baileys)',
        connected: state.wppConnected,
        needsQR: !state.wppConnected && !state.wppQRCode,
        myId: maskJid(state.wppClient?.user?.id) || null,
        targetGroup: TARGET_WPP_GROUP ? maskJid(TARGET_WPP_GROUP) : null,
        sessionPath: WPP_SESSION_PATH,
    });
});

app.get('/wpp/commands', (req, res) => {
    res.json({
        commands: Object.entries(COMMANDS).map(([name, c]) => ({
            name: `/${name}`,
            description: c.description,
        })),
        trackedSentIds: sentMessageIds.size,
    });
});

app.get('/wpp/qr', (req, res) => {
    const qr = state.wppQRCode;
    if (!qr) {
        return res.send(`
<!DOCTYPE html>
<html><head><title>WhatsApp - QR</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5}
.container{text-align:center;padding:20px;background:#fff;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}
.status{margin-top:20px;padding:10px;border-radius:5px;background:#e7f3ff}</style></head>
<body><div class="container">
<h1>📱 Vincular WhatsApp</h1>
<div id="qr-container"><p>Cargando QR...</p></div>
<div class="status" id="status">Estado: ${state.wppConnected ? 'Conectado ✅' : 'Esperando QR...'}</div>
</div>
<script>
function checkQR(){fetch('/wpp/qr-data').then(r=>r.json()).then(d=>{
if(d.connected){document.getElementById('qr-container').innerHTML='<p style="font-size:48px">✅</p>';document.getElementById('status').textContent='Estado: Conectado';}
else if(d.qrCode){document.getElementById('qr-container').innerHTML='<img src="'+d.qrCode+'" style="max-width:300px" alt="QR">';document.getElementById('status').textContent='Estado: QR listo';}
else{document.getElementById('status').textContent='Estado: Esperando QR...';}
}).catch(()=>{document.getElementById('status').textContent='Estado: Error';});}
setInterval(checkQR,2000);checkQR();
</script></body></html>`);
    }
    res.send(`
<!DOCTYPE html>
<html><head><title>WhatsApp - QR</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5}
.container{text-align:center;padding:20px;background:#fff;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}
.status{margin-top:20px;padding:10px;border-radius:5px;background:#e7f3ff}</style></head>
<body><div class="container">
<h1>📱 Vincular WhatsApp</h1>
<div id="qr-container"><img src="${qr}" style="max-width:300px" alt="QR"></div>
<div class="status" id="status">Estado: QR listo para escanear</div>
</div>
<script>
function checkQR(){fetch('/wpp/qr-data').then(r=>r.json()).then(d=>{
if(d.connected){document.getElementById('qr-container').innerHTML='<p style="font-size:48px">✅</p>';document.getElementById('status').textContent='Estado: Conectado';}
else if(d.qrCode&&d.qrCode!=='${qr}'){document.querySelector('#qr-container img').src=d.qrCode;}
}).catch(()=>{});}
setInterval(checkQR,2000);
</script></body></html>`);
});

app.get('/wpp/qr-data', (req, res) => {
    res.json({
        qrCode: state.wppQRCode || null,
        connected: state.wppConnected,
        needsQR: !state.wppConnected && !state.wppQRCode,
        myId: maskJid(state.wppClient?.user?.id) || null,
        hasSession: state.wppConnected || !!state.wppQRCode,
    });
});

// ============================================================
// WhatsApp — Resolver CAPTCHA (request-response bloqueante)
// ============================================================

app.get('/wpp/resolve-captcha', async (req, res) => {
    const { imageUrl, imageBase64, caption, callback } = req.query;

    let sentMsgId;
    let captchaPromise;

    const sendJson = (data, statusCode = 200) => {
        if (callback) {
            res.type('application/javascript');
            return res.status(200).send(`${callback}(${JSON.stringify(data)});`);
        }
        return res.status(statusCode).json(data);
    };

    try {
        if (!state.wppConnected || !state.wppClient) {
            return sendJson({ success: false, error: 'WhatsApp no conectado' }, 503);
        }

        if (!TARGET_WPP_GROUP) {
            return sendJson({ success: false, error: 'WS_TARGET_GROUP no configurado' }, 400);
        }

        let imageBuffer;

        if (imageBase64) {
            console.log(`📥 [WhatsApp] Procesando CAPTCHA recibido en Base64...`);
            // Limpiar el encabezado data:image/png;base64,... si viene incluido
            const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
            imageBuffer = Buffer.from(cleanBase64, 'base64');
        } else if (imageUrl) {
            console.log(`📥 [WhatsApp] Descargando imagen CAPTCHA desde URL: ${imageUrl}`);
            const response = await axios.get(imageUrl, {
                responseType: 'arraybuffer',
                timeout: 15000,
            });
            imageBuffer = Buffer.from(response.data);
        } else {
            return sendJson({ success: false, error: 'Se requiere imageUrl o imageBase64' }, 400);
        }

        const sendResult = await state.wppClient.sendMessage(
            TARGET_WPP_GROUP,
            { image: imageBuffer, caption: caption || '🔐 CAPTCHA — responde este mensaje:' }
        );

        sentMsgId = sendResult?.key?.id;

        if (!sentMsgId) {
            return sendJson({ success: false, error: 'No se pudo obtener el ID del mensaje enviado' }, 500);
        }

        captchaPromise = registerPendingCaptcha(sentMsgId);
        console.log(`📤 [WhatsApp] CAPTCHA enviado al grupo (${sentMsgId}). Esperando respuesta...`);

        const result = await captchaPromise;

        sendJson({
            success: true,
            messageId: sentMsgId,
            response: result.response,
            senderJid: result.senderJid,
            targetGroup: maskJid(TARGET_WPP_GROUP),
        });

        console.log(`✅ [WhatsApp] CAPTCHA resuelto (${sentMsgId})`);
    } catch (error) {
        console.error(`❌ [WhatsApp] Error en resolve-captcha: ${error.message}`);

        if (!res.headersSent) {
            const statusCode = error.message.startsWith('Timeout') ? 408 : 500;
            sendJson({
                success: false,
                error: error.message,
                messageId: sentMsgId || null,
            }, statusCode);
        }
    }
});

app.get('/wpp/reconnect', async (req, res) => {
    try {
        if (state.wppClient) {
            try {
                state.wppClient.ev.removeAllListeners('creds.update');
                state.wppClient.ev.removeAllListeners('connection.update');
                state.wppClient.ev.removeAllListeners('messages.upsert');
                if (typeof state.wppClient.end === 'function') state.wppClient.end(undefined);
                else state.wppClient.ws?.close();
            } catch (_) { }
            state.wppClient = null;
        }

        if (supabase) {
            const { SupabaseAuthState } = require('./supabase-auth-state');
            const authState = new SupabaseAuthState(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WPP_SESSION_ID);
            await authState.clearState();
        } else {
            const fs = require('fs');
            if (fs.existsSync(WPP_SESSION_PATH)) fs.rmSync(WPP_SESSION_PATH, { recursive: true, force: true });
        }

        state.wppConnected = false;
        state.wppQRCode = null;
        sentMessageIds.clear();
        pendingCaptchas.forEach((v) => clearTimeout(v.timeout));
        pendingCaptchas.clear();

        initWhatsApp();
        res.json({ success: true, message: 'Sesión limpiada. Generando nuevo QR...', storage: supabase ? 'supabase' : 'local' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/wpp/clear-session', async (req, res) => {
    try {
        if (state.wppClient) {
            try {
                state.wppClient.ev.removeAllListeners('creds.update');
                state.wppClient.ev.removeAllListeners('connection.update');
                state.wppClient.ev.removeAllListeners('messages.upsert');
                if (typeof state.wppClient.end === 'function') state.wppClient.end(undefined);
                else state.wppClient.ws?.close();
            } catch (_) { }
            state.wppClient = null;
        }

        if (supabase) {
            const { SupabaseAuthState } = require('./supabase-auth-state');
            const authState = new SupabaseAuthState(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WPP_SESSION_ID);
            await authState.clearState();
        } else {
            const fs = require('fs');
            if (fs.existsSync(WPP_SESSION_PATH)) fs.rmSync(WPP_SESSION_PATH, { recursive: true, force: true });
        }

        state.wppConnected = false;
        state.wppQRCode = null;
        sentMessageIds.clear();
        pendingCaptchas.forEach((v) => clearTimeout(v.timeout));
        pendingCaptchas.clear();

        res.json({ success: true, message: 'Sesión eliminada.', storage: supabase ? 'supabase' : 'local' });
        console.log('🗑️ [WhatsApp] Sesión eliminada manualmente');
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/wpp/resync-state', async (req, res) => {
    try {
        if (!supabase) return res.status(400).json({ success: false, error: 'Supabase no configurado' });

        const { data, error: readErr } = await supabase
            .from('whatsapp_sessions').select('session_data').eq('id', WPP_SESSION_ID).maybeSingle();
        if (readErr) throw readErr;

        const session = data?.session_data || {};
        const keys = session.keys || {};
        let removed = 0;
        for (const k of Object.keys(keys)) {
            if (k.startsWith('app-state-sync-')) { delete keys[k]; removed++; }
        }

        const { error: writeErr } = await supabase
            .from('whatsapp_sessions')
            .update({ session_data: { ...session, keys }, updated_at: new Date().toISOString() })
            .eq('id', WPP_SESSION_ID);
        if (writeErr) throw writeErr;

        res.json({ success: true, removedKeys: removed });
        console.log(`♻️ [WhatsApp] App-state reset — ${removed} keys eliminadas`);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// Inicio
// ============================================================
app.listen(PORT, async () => {
    console.log(`🚀 Servidor Express iniciado en puerto ${PORT}`);

    try {
        if (SESSION_STR && SESSION_STR.length > 10) {
            await client.start();
            console.log("✅ Telegram client started and authorized");
            try {
                const entity = await client.getEntity(TARGET_CHAT_ID);
                const censorTitle = (str) => {
                    if (!str || str.length <= 2) return '*'.repeat(str?.length || 0);
                    return str[0] + '*'.repeat(str.length - 2) + str[str.length - 1];
                };

                console.log(`✅ Escuchando en: ${censorTitle(entity.title)}`);
            } catch (error) {
                console.error(`❌ Error al acceder al grupo de Telegram: ${error.message}`);
            }
            state.telegramConnected = true;
            console.log("📡 Cliente de Telegram conectado y monitoreando...");
        } else {
            console.log("⚠️ [Telegram] No hay sesión válida configurada en TELEGRAM_SESSION");
        }
    } catch (error) {
        console.error(`❌ Error al iniciar el cliente de Telegram: ${error.message}`);
    }

    initWhatsApp();
});