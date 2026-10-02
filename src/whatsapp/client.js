const {
    makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers,
} = require('@whiskeysockets/baileys');
const { createClient } = require('@supabase/supabase-js');
const QRCode = require('qrcode');
const { useSupabaseAuthState } = require('../../supabase-auth-state');
const { cacheLogger, socketLogger } = require('../utils/logger');
const { createSafeCache } = require('../utils/cache');
const { maskJid } = require('../utils/privacy');
const { COMMANDS, parseCommand } = require('./commands');
const { processMessage } = require('./processor');
const { pendingCaptchas, registerPendingCaptcha } = require('./captcha');
const { pendingSelections, registerPendingSelection, clearPendingSelections } = require('./tiktok-selections');
const {
    WPP_SESSION_PATH,
    WPP_SESSION_ID,
    WPP_ALLOWED_CHATS,
    WPP_CAPTCHA_TIMEOUT,
    WPP_TIKTOK_TIMEOUT,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
} = require('../config');

let supabase = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        db: { schema: 'public' },
        global: { headers: { 'x-my-custom-header': 'my-app-name' } },
        realtime: { transport: require('ws') }
    });
}

// ============================================================
// Estado local del cliente WhatsApp
// ============================================================
let wppClient = null;
let wppConnected = false;
let wppQRCode = null;
let shuttingDown = false;

// ============================================================
// Inicializar WhatsApp
// ============================================================
async function initWhatsApp() {
    try {
        console.log('[WhatsApp] Iniciando cliente Baileys...');

        let authState, saveCreds;

        if (supabase) {
            console.log('[WhatsApp] Usando Supabase para persistencia de sesion');
            const supabaseAuth = await useSupabaseAuthState(
                SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WPP_SESSION_ID
            );
            authState = supabaseAuth.state;
            saveCreds = supabaseAuth.saveCreds;
        } else {
            console.log('[WhatsApp] Usando sistema de archivos local para persistencia');
            const fileAuth = await useMultiFileAuthState(WPP_SESSION_PATH);
            authState = fileAuth.state;
            saveCreds = fileAuth.saveCreds;
        }

        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`[WhatsApp] Baileys version: ${version.join('.')} (latest: ${isLatest})`);

        const wpp = makeWASocket({
            version,
            auth: {
                creds: authState.creds,
                keys: makeCacheableSignalKeyStore(authState.keys, cacheLogger),
            },
            browser: Browsers.ubuntu('Chrome'),
            printQRInTerminal: false,
            emitOwnEvents: true,
            //shouldSyncHistoryMessage: () => true,
            syncFullHistory: false,
            connectTimeoutMs: 60_000,
            logger: socketLogger,
            msgRetryCounterCache: createSafeCache(),
        });

        wpp.ev.on('creds.update', saveCreds);

        wpp.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (connection === 'connecting') {
                console.log('[WhatsApp] Conectando...');
            } else if (connection === 'open') {
                wppConnected = true;
                wppQRCode = null;
                console.log('[WhatsApp] Conectado exitosamente');
            } else if (connection === 'close') {
                wppConnected = false;
                console.log('[WhatsApp] Desconectado');

                if (shuttingDown) {
                    console.log('[WhatsApp] Shutdown en progreso, no se reintenta.');
                    return;
                }

                const statusCode = lastDisconnect?.error?.output?.statusCode;
                if (statusCode !== 401) {
                    console.log('[WhatsApp] Reconectando en 5 segundos...');
                    setTimeout(initWhatsApp, 5000);
                } else {
                    console.log('[WhatsApp] Sesion cerrada (401). Visita /wpp/reconnect para limpiar y escanear QR nuevo.');
                }
            }

            if (qr) {
                try {
                    const qrImage = await QRCode.toDataURL(qr);
                    wppQRCode = qrImage;
                    console.log('[WhatsApp] QR generado (visible en /wpp/qr)');
                } catch (e) {
                    console.log('[WhatsApp] QR generado');
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

                    // Log temporal para obtener JIDs
                    console.log(`[DEBUG] Mensaje recibido de: ${remoteJid} (fromMe: ${fromMe})`);

                    // Filtrar: solo chats directos (no grupos)
                    const isGroupChat = remoteJid.endsWith('@g.us');
                    if (isGroupChat) continue;

                    // Filtrar: solo chats autorizados
                    const isAllowed = WPP_ALLOWED_CHATS.includes(remoteJid);
                    if (!isAllowed) continue;

                    // Extraer texto temprano para detección de CAPTCHA
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
                        // Validar que el remitente esta autorizado
                        if (!WPP_ALLOWED_CHATS.includes(senderJid)) {
                            console.log(`WARNING [WhatsApp] Respuesta de CAPTCHA de cuenta no autorizada: ${maskJid(senderJid)}`);
                            continue;
                        }

                        const captchaEntry = pendingCaptchas.get(stanzaId);
                        clearTimeout(captchaEntry.timeout);
                        pendingCaptchas.delete(stanzaId);
                        captchaEntry.resolve({ response: text, senderJid });
                        console.log(`[WhatsApp] Respuesta de CAPTCHA recibida (${stanzaId})`);
                        continue;
                    }

                    // Detectar respuestas a selecciones de videos TikTok
                    const pendingForChat = Array.from(pendingSelections.entries())
                        .find(([_, entry]) => entry.remoteJid === remoteJid);

                    if (pendingForChat && text && !fromMe) {
                        const [messageId, selectionEntry] = pendingForChat;

                        // Validar que el remitente esta autorizado (usar remoteJid para chats directos)
                        if (!WPP_ALLOWED_CHATS.includes(remoteJid)) {
                            console.log(`WARNING [WhatsApp] Respuesta de selección TikTok de cuenta no autorizada: ${maskJid(remoteJid)}`);
                            continue;
                        }

                        const selectedIndex = parseInt(text.trim(), 10);

                        if (isNaN(selectedIndex) || selectedIndex < 1 || selectedIndex > selectionEntry.videos.length) {
                            await wpp.sendMessage(remoteJid, { text: `❌ Número inválido. Por favor selecciona un número entre 1 y ${selectionEntry.videos.length}` });
                            continue;
                        }

                        clearTimeout(selectionEntry.timeout);
                        pendingSelections.delete(messageId);

                        const selectedItem = selectionEntry.videos[selectedIndex - 1];

                        // Manejar selección de formato (video individual)
                        if (selectionEntry.type === 'format') {
                            const musicalData = selectionEntry.options;
                            try {
                                console.log(`[WhatsApp] Enviando video formato ${selectedItem.format}`);
                                console.log(`[WhatsApp] Download URL: ${selectedItem.url?.substring(0, 100)}...`);

                                const caption = musicalData.description || `Formato: ${selectedItem.label}`;

                                await wpp.sendMessage(remoteJid, {
                                    video: { url: selectedItem.url },
                                    caption,
                                });
                                console.log(`[WhatsApp] Video formato enviado (${selectedItem.format})`);
                            } catch (err) {
                                console.error(`ERROR [WhatsApp] Error enviando video formato: ${err.message}`);
                                console.error(`ERROR [WhatsApp] Stack: ${err.stack}`);
                                await wpp.sendMessage(remoteJid, { text: '❌ Error al enviar el video. Intenta nuevamente.' });
                            }
                            continue;
                        }

                        // Manejar selección de video de perfil (flujo original)
                        const selectedVideo = selectedItem;
                        const profile = selectionEntry.profile;
                        try {
                            console.log(`[WhatsApp] Enviando video TikTok ${selectedIndex}`);
                            console.log(`[WhatsApp] Download URL: ${selectedVideo.downloadUrl?.substring(0, 100)}...`);
                            console.log(`[WhatsApp] Thumbnail: ${selectedVideo.thumbnail?.substring(0, 100) || 'null'}...`);

                            await wpp.sendMessage(remoteJid, {
                                video: { url: selectedVideo.downloadUrl },
                                caption: profile ? `Video ${selectedIndex} de ${profile.username}` : `Video ${selectedIndex} seleccionado`,
                            });
                            console.log(`[WhatsApp] Video TikTok enviado (${selectedIndex})`);
                        } catch (err) {
                            console.error(`ERROR [WhatsApp] Error enviando video TikTok: ${err.message}`);
                            console.error(`ERROR [WhatsApp] Stack: ${err.stack}`);
                            await wpp.sendMessage(remoteJid, { text: '❌ Error al enviar el video. Intenta nuevamente.' });
                        }
                        continue;
                    }

                    // Procesar comandos
                    const cmd = parseCommand(text);
                    if (cmd) {
                        console.log(`[WhatsApp] Comando recibido: /${cmd.name}`);

                        const entry = COMMANDS[cmd.name];
                        if (!entry) {
                            console.log(`[WhatsApp] Comando desconocido: /${cmd.name}`);
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
                                await wpp.sendMessage(remoteJid, { text: reply });
                                console.log(`[WhatsApp] Respuesta enviada: /${cmd.name}`);
                            }
                        } catch (err) {
                            console.error(`ERROR [WhatsApp] Error en /${cmd.name}: ${err.message}`);
                        }

                        continue;
                    }

                    // Procesar mensajes para n8n (solo si NO es comando)
                    await processMessage(text, 'whatsapp', {
                        chatId: remoteJid,
                        senderId: senderJid,
                        msgId,
                        fromMe,
                    });
                }
            } catch (error) {
                console.error(`ERROR [WhatsApp] Error en handler: ${error.message}`);
            }
        });

        wppClient = wpp;

    } catch (error) {
        console.error(`ERROR [WhatsApp] Error al iniciar Baileys: ${error.message}`);
        wppConnected = false;

        if (shuttingDown) return;
        console.log('[WhatsApp] Reintentando en 10 segundos...');
        setTimeout(initWhatsApp, 10000);
    }
}

// ============================================================
// Funciones de estado
// ============================================================
function getWppClient() {
    return wppClient;
}

function isWppConnected() {
    return wppConnected;
}

function getWppQRCode() {
    return wppQRCode;
}

function setWppQRCode(qr) {
    wppQRCode = qr;
}

function setShuttingDown(value) {
    shuttingDown = value;
}

async function handleShutdown() {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log('[WhatsApp] Cerrando cliente...');

    try {
        clearPendingSelections();
        console.log('[WhatsApp] Selecciones TikTok pendientes limpiadas');
    } catch (error) {
        console.error(`ERROR [WhatsApp] Error limpiando selecciones: ${error.message}`);
    }

    try {
        if (wppClient) {
            console.log('[WhatsApp] Cerrando cliente WhatsApp (SIN logout)...');
            try {
                wppClient.ev.removeAllListeners('creds.update');
                wppClient.ev.removeAllListeners('connection.update');
                wppClient.ev.removeAllListeners('messages.upsert');
            } catch (_) { /* noop */ }

            try {
                if (typeof wppClient.end === 'function') {
                    wppClient.end(undefined);
                } else {
                    wppClient.ws?.close();
                }
            } catch (_) { /* noop */ }
        }
    } catch (error) {
        console.error(`ERROR [WhatsApp] Error en shutdown: ${error.message}`);
    }
}

module.exports = {
    initWhatsApp,
    getWppClient,
    isWppConnected,
    getWppQRCode,
    setWppQRCode,
    setShuttingDown,
    handleShutdown,
    pendingCaptchas,
    registerPendingCaptcha,
    pendingSelections,
    registerPendingSelection,
    WPP_ALLOWED_CHATS,
    WPP_CAPTCHA_TIMEOUT,
    WPP_TIKTOK_TIMEOUT,
    supabase,
    WPP_SESSION_PATH,
    WPP_SESSION_ID,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
};
