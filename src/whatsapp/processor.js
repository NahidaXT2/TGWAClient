const axios = require('axios');
const { N8N_WEBHOOK_URL, wordsToReact } = require('../config');

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

            console.log(`[${source}] Mensaje enviado a n8n (keywords: ${matchedWords.join(', ')})`);
        }
    } catch (error) {
        console.error(`ERROR [${source}] Error procesando mensaje: ${error.message}`);
    }
}

module.exports = { processMessage };
