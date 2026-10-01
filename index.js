const express = require('express');
const { PORT, SESSION_STR, TARGET_CHAT_ID } = require('./src/config');
const { client } = require('./src/telegram/client');
const { initWhatsApp, handleShutdown: handleWppShutdown } = require('./src/whatsapp/client');
const { setTelegramConnected, setShuttingDown } = require('./src/state');
const indexRoutes = require('./src/routes/index');
const telegramRoutes = require('./src/routes/telegram');
const whatsappRoutes = require('./src/routes/whatsapp');

// ============================================================
// Express
// ============================================================
const app = express();
app.use(express.json());

app.use('/', indexRoutes);
app.use('/telegram', telegramRoutes);
app.use('/wpp', whatsappRoutes);

// ============================================================
// Shutdown
// ============================================================
async function handleShutdown() {
    if (require('./src/state').isShuttingDown()) return;
    setShuttingDown(true);

    console.log('[Shutdown] Cerrando clientes...');

    try {
        await handleWppShutdown();
    } catch (error) {
        console.error(`ERROR [Shutdown] Error: ${error.message}`);
    } finally {
        setTimeout(() => process.exit(0), 500);
    }
}

process.on('SIGTERM', handleShutdown);
process.on('SIGINT', handleShutdown);

// ============================================================
// Inicio
// ============================================================
app.listen(PORT, async () => {
    console.log(`Servidor Express iniciado en puerto ${PORT}`);

    try {
        if (SESSION_STR && SESSION_STR.length > 10) {
            await client.start();
            console.log("Telegram client started and authorized");
            try {
                const entity = await client.getEntity(TARGET_CHAT_ID);
                const censorTitle = (str) => {
                    if (!str || str.length <= 2) return '*'.repeat(str?.length || 0);
                    return str[0] + '*'.repeat(str.length - 2) + str[str.length - 1];
                };

                console.log(`Escuchando en: ${censorTitle(entity.title)}`);
            } catch (error) {
                console.error(`ERROR Error al acceder al grupo de Telegram: ${error.message}`);
            }
            setTelegramConnected(true);
            console.log("Cliente de Telegram conectado y monitoreando...");
        } else {
            console.log("WARNING [Telegram] No hay sesion valida configurada en TELEGRAM_SESSION");
        }
    } catch (error) {
        console.error(`ERROR Error al iniciar el cliente de Telegram: ${error.message}`);
    }

    initWhatsApp();
});
