const { TelegramClient } = require('teleproto');
const { StringSession } = require('teleproto/sessions');
const { NewMessage } = require('teleproto/events');
const { processTelegramMessage } = require('./processor');
const { API_ID, API_HASH, SESSION_STR, TARGET_CHAT_ID } = require('../config');

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
            console.error(`ERROR [telegram] Error en handler: ${err.message}`);
        }
    },
    new NewMessage({ chats: [TARGET_CHAT_ID] })
);

module.exports = { client, resolveTelegramSender };
