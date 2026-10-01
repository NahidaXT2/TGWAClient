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
        if (joined.includes('MessageCounterError') && joined.includes('Key used already')) return;

        console.error('[baileys][error]', ...args);
    },
    warn: (...args) => console.warn('[baileys][warn ]', ...args),
    info: () => { }, debug: () => { }, trace: () => { },
    child: () => socketLogger,
};

module.exports = { cacheLogger, socketLogger };
