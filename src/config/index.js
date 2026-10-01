require('dotenv').config();

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
    console.warn('WARNING: WORDS_TO_REACT no configurado o vacio. No se detectara ninguna palabra clave.');
}

const TARGET_CHAT_ID = process.env.TG_TARGET_GROUP;

// ============================================================
// Configuración — Baileys (WhatsApp)
// ============================================================
const WPP_SESSION_PATH = process.env.WPP_SESSION_PATH || './wpp-session';
const WPP_SESSION_ID = process.env.WPP_SESSION_ID || 'default';

// Chats autorizados para que el bot de WhatsApp responda
// Lista de JIDs separados por comas (ej: 1234567890@s.whatsapp.net,9876543210@s.whatsapp.net)
const WPP_ALLOWED_CHATS = (process.env.WPP_ALLOWED_CHATS || '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

// ============================================================
// Configuración — Supabase
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ============================================================
// Configuración — CAPTCHA
// ============================================================
const WPP_CAPTCHA_TIMEOUT = parseInt(process.env.WPP_CAPTCHA_TIMEOUT, 10) || 30000; // 30s por defecto

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

console.log("OK: Todas las variables de entorno estan configuradas");

if (WPP_ALLOWED_CHATS.length === 0) {
    console.warn('WARNING [WhatsApp] WPP_ALLOWED_CHATS no configurado. El bot no respondera a ningun mensaje.');
} else {
    console.log(`[WhatsApp] Chats autorizados configurados: ${WPP_ALLOWED_CHATS.length} cuenta(s)`);
}

module.exports = {
    // Telegram
    API_ID,
    API_HASH,
    SESSION_STR,
    N8N_WEBHOOK_URL,
    PORT,
    wordsToReact,
    TARGET_CHAT_ID,

    // WhatsApp
    WPP_SESSION_PATH,
    WPP_SESSION_ID,
    WPP_ALLOWED_CHATS,
    WPP_CAPTCHA_TIMEOUT,

    // Supabase
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
};
