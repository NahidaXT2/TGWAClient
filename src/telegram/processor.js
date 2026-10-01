const axios = require('axios');
const { N8N_WEBHOOK_URL, wordsToReact } = require('../config');

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

        console.log(`[telegram] Enviado a n8n (word: ${payload.detected_word})`);
    } catch (error) {
        console.error(`ERROR [telegram] Error procesando mensaje: ${error.message}`);
    }
}

module.exports = { processTelegramMessage };
