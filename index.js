require('dotenv').config();

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const archiver = require('archiver');
const AdmZip = require('adm-zip');
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
// Funciones de gestión de userDataDir (Perfil de Chrome)
// ============================================================

// Matar procesos de Chrome zombies que puedan quedar de ejecuciones anteriores
async function killZombieChromeProcesses() {
    try {
        const { exec } = require('child_process');
        const util = require('util');
        const execAsync = util.promisify(exec);

        // En Linux/Docker, matar procesos de chromium/chrome
        try {
            await execAsync('pkill -9 chromium-browser || true');
            await execAsync('pkill -9 chrome || true');
            console.log('🧹 [Chrome] Procesos Chrome zombies eliminados');
        } catch (err) {
            // Es normal si no hay procesos ejecutándose
            console.log('ℹ️ [Chrome] No se encontraron procesos Chrome zombies');
        }
    } catch (error) {
        console.warn(`⚠️ [Chrome] Error al eliminar procesos zombies: ${error.message}`);
    }
}

// Eliminar archivos de bloqueo de Chrome para evitar errores de "browser already running"
function cleanupLockFiles(userDataDirPath) {
    try {
        const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
        let cleanedCount = 0;

        for (const lockFile of lockFiles) {
            const lockFilePath = path.join(userDataDirPath, lockFile);
            if (fs.existsSync(lockFilePath)) {
                try {
                    fs.unlinkSync(lockFilePath);
                    cleanedCount++;
                    console.log(`🧹 [Chrome] Eliminado archivo de bloqueo: ${lockFile}`);
                } catch (err) {
                    console.warn(`⚠️ [Chrome] No se pudo eliminar ${lockFile}: ${err.message}`);
                }
            }
        }

        // También buscar en subdirectorios (Default, etc.)
        const subdirs = ['Default', 'Profile 1'];
        for (const subdir of subdirs) {
            const subdirPath = path.join(userDataDirPath, subdir);
            if (fs.existsSync(subdirPath)) {
                for (const lockFile of lockFiles) {
                    const lockFilePath = path.join(subdirPath, lockFile);
                    if (fs.existsSync(lockFilePath)) {
                        try {
                            fs.unlinkSync(lockFilePath);
                            cleanedCount++;
                            console.log(`🧹 [Chrome] Eliminado archivo de bloqueo en ${subdir}: ${lockFile}`);
                        } catch (err) {
                            console.warn(`⚠️ [Chrome] No se pudo eliminar ${subdir}/${lockFile}: ${err.message}`);
                        }
                    }
                }
            }
        }

        if (cleanedCount > 0) {
            console.log(`✅ [Chrome] ${cleanedCount} archivos de bloqueo eliminados`);
        } else {
            console.log(`ℹ️ [Chrome] No se encontraron archivos de bloqueo para limpiar`);
        }
    } catch (error) {
        console.error(`❌ [Chrome] Error al limpiar archivos de bloqueo: ${error.message}`);
    }
}

// Limpiar directorios de caché de Chrome para reducir el tamaño del perfil
function cleanupCacheDirectories(userDataDirPath) {
    try {
        const cacheDirs = [
            'Default/Cache',
            'Default/Code Cache',
            'Default/GPUCache',
            'Default/Service Worker',
            'Default/IndexedDB'
        ];
        let cleanedSize = 0;

        for (const cacheDir of cacheDirs) {
            const cachePath = path.join(userDataDirPath, cacheDir);
            if (fs.existsSync(cachePath)) {
                const getDirSize = (dirPath) => {
                    let size = 0;
                    const files = fs.readdirSync(dirPath);
                    for (const file of files) {
                        const filePath = path.join(dirPath, file);
                        const stats = fs.statSync(filePath);
                        if (stats.isDirectory()) {
                            size += getDirSize(filePath);
                        } else {
                            size += stats.size;
                        }
                    }
                    return size;
                };

                const dirSize = getDirSize(cachePath);
                fs.rmSync(cachePath, { recursive: true, force: true });
                cleanedSize += dirSize;
                console.log(`🧹 [Chrome] Eliminado caché: ${cacheDir} (${(dirSize / 1024 / 1024).toFixed(2)} MB)`);
            }
        }

        if (cleanedSize > 0) {
            console.log(`✅ [Chrome] Total liberado: ${(cleanedSize / 1024 / 1024).toFixed(2)} MB`);
        }
    } catch (error) {
        console.error(`❌ [Chrome] Error al limpiar caché: ${error.message}`);
    }
}

// Descargar perfil de usuario comprimido desde Supabase Storage
async function downloadUserProfile(sessionName) {
    try {
        if (!supabase) {
            console.warn('⚠️ [Profile] Supabase no configurado, no se restaurará el perfil');
            return false;
        }

        const fileName = `${sessionName}.zip`;
        console.log(`🔍 [Profile] Buscando perfil: ${fileName}`);

        const { data, error } = await supabase.storage
            .from(SUPABASE_BUCKET)
            .download(fileName);

        if (error) {
            console.log(`ℹ️ [Profile] No hay perfil guardado para ${sessionName}: ${error.message}`);
            return false;
        }

        // Crear directorio userDataDir
        const userDataDir = path.join(__dirname, 'tokens', `wpp-profile-${sessionName}`);
        if (!fs.existsSync(userDataDir)) {
            fs.mkdirSync(userDataDir, { recursive: true });
        }

        // Limpiar archivos de bloqueo antes de extraer
        cleanupLockFiles(userDataDir);

        // Extraer el zip
        const arrayBuffer = await data.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const zip = new AdmZip(buffer);
        zip.extractAllTo(userDataDir, true);

        console.log(`✅ [Profile] Perfil restaurado desde Supabase para ${sessionName}`);
        return true;
    } catch (error) {
        console.error(`❌ [Profile] Error al descargar perfil: ${error.message}`);
        return false;
    }
}

// Comprimir y subir perfil de usuario a Supabase Storage
async function uploadUserProfile(sessionName, userDataDirPath) {
    try {
        if (!supabase) {
            console.warn('⚠️ [Profile] Supabase no configurado, no se guardará el perfil');
            return false;
        }

        if (!fs.existsSync(userDataDirPath)) {
            console.warn(`⚠️ [Profile] userDataDir no existe: ${userDataDirPath}`);
            return false;
        }

        console.log(`📦 [Profile] Comprimiendo perfil para ${sessionName}...`);

        // Limpiar caché antes de comprimir
        cleanupCacheDirectories(userDataDirPath);

        // Crear archivo zip en memoria
        const zipPath = path.join(__dirname, `${sessionName}-temp.zip`);
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        return new Promise((resolve, reject) => {
            output.on('close', async () => {
                try {
                    const stats = fs.statSync(zipPath);
                    console.log(`📦 [Profile] Tamaño del zip: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

                    const fileBuffer = fs.readFileSync(zipPath);
                    const fileName = `${sessionName}.zip`;

                    const { error } = await supabase.storage
                        .from(SUPABASE_BUCKET)
                        .upload(fileName, fileBuffer, { upsert: true });

                    // Eliminar archivo temporal
                    fs.unlinkSync(zipPath);

                    if (error) {
                        console.error(`❌ [Profile] Error al subir perfil: ${error.message}`);
                        resolve(false);
                    } else {
                        console.log(`✅ [Profile] Perfil guardado en Supabase para ${sessionName}`);
                        resolve(true);
                    }
                } catch (err) {
                    console.error(`❌ [Profile] Error en upload: ${err.message}`);
                    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
                    resolve(false);
                }
            });

            archive.on('error', (err) => {
                console.error(`❌ [Profile] Error en archiver: ${err.message}`);
                if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
                reject(err);
            });

            archive.pipe(output);
            archive.directory(userDataDirPath, false);
            archive.finalize();
        });
    } catch (error) {
        console.error(`❌ [Profile] Error general al subir perfil: ${error.message}`);
        return false;
    }
}

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
    wppClient: null,
    wppUserDataDir: null,
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
// Función: Inicializar WPPConnect
// ============================================================
async function initWPPConnect() {
    try {
        console.log('🔍 [WPPConnect] Iniciando servicio...');
        console.log('🔍 [WPPConnect] Supabase cliente configurado:', !!supabase);

        const wpp = require('@wppconnect-team/wppconnect');

        // Configurar userDataDir para persistencia de sesión Multi-Device
        const userDataDir = path.join(__dirname, 'tokens', `wpp-profile-${WPP_SESSION_NAME}`);

        // Matar procesos Chrome zombies antes de iniciar
        await killZombieChromeProcesses();

        // Si el userDataDir ya existe localmente, eliminarlo para asegurar un inicio limpio
        if (fs.existsSync(userDataDir)) {
            console.log('🧹 [WPPConnect] Eliminando userDataDir local existente para inicio limpio...');
            fs.rmSync(userDataDir, { recursive: true, force: true });
        }

        // Descargar perfil desde Supabase si existe
        const profileRestored = await downloadUserProfile(WPP_SESSION_NAME);
        if (profileRestored) {
            console.log('✅ [WPPConnect] Perfil de sesión restaurado');
        } else {
            console.log('ℹ️ [WPPConnect] Iniciando con perfil nuevo (se requerirá escanear QR)');
        }

        const options = {
            session: WPP_SESSION_NAME,
            autoClose: 0, // Evita que se cierre automáticamente si tarda en conectar
            headless: true,
            logQR: false,
            logV1: false,
            logV2: false,
            logV3: false,
            puppeteerOptions: {
                userDataDir: userDataDir,
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
            catchQR: (base64QR) => {
                state.wppQRCode = base64QR;
            },
            statusFind: (statusSession) => {
                console.log(`📊 [WPPConnect] statusFind: ${statusSession}`);
                if (['isLogged', 'CONNECTED', 'qrReadSuccess'].includes(statusSession)) {
                    state.wppConnected = true;
                    state.wppQRCode = null;

                    // Subir perfil a Supabase cuando la sesión se conecte exitosamente
                    uploadUserProfile(WPP_SESSION_NAME, userDataDir).catch(err => {
                        console.error(`❌ [WPPConnect] Error al subir perfil en statusFind: ${err.message}`);
                    });
                }
            },
        };

        const client = await wpp.create(options);

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

        // Actualizar estado y respaldar perfil si cambia de estado
        client.onStateChange(async (status) => {
            console.log(`[WPPConnect] Cambio de estado: ${status}`);
            if (['CONNECTED', 'isLogged'].includes(status)) {
                state.wppConnected = true;
                state.wppQRCode = null;

                // Subir perfil a Supabase cuando el estado cambie a conectado
                uploadUserProfile(WPP_SESSION_NAME, userDataDir).catch(err => {
                    console.error(`❌ [WPPConnect] Error al subir perfil en onStateChange: ${err.message}`);
                });
            }
        });

        // Guardar referencia al cliente y userDataDir para shutdown
        state.wppClient = client;
        state.wppUserDataDir = userDataDir;

    } catch (error) {
        console.error(`❌ Error al iniciar WPPConnect: ${error.message}`);
        state.wppConnected = false;
    }
}


// ============================================================
// Handler para cierre graceful (SIGTERM)
// ============================================================
async function handleShutdown() {
    console.log('🛑 [Shutdown] Recibida señal de terminación, iniciando cierre graceful...');

    try {
        // Subir perfil de WhatsApp a Supabase antes de cerrar
        if (state.wppUserDataDir && state.wppConnected) {
            console.log('💾 [Shutdown] Guardando perfil de WhatsApp...');
            await uploadUserProfile(WPP_SESSION_NAME, state.wppUserDataDir);
        }

        // Cerrar cliente de WPPConnect si existe
        if (state.wppClient) {
            console.log('📱 [Shutdown] Cerrando cliente de WhatsApp...');
            await state.wppClient.close();
        }

        console.log('✅ [Shutdown] Cierre graceful completado');
    } catch (error) {
        console.error(`❌ [Shutdown] Error durante cierre: ${error.message}`);
    } finally {
        process.exit(0);
    }
}

// Escuchar señales de terminación
process.on('SIGTERM', handleShutdown);
process.on('SIGINT', handleShutdown);

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