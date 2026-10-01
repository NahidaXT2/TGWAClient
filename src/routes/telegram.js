const express = require('express');
const { TARGET_CHAT_ID } = require('../config');
const { maskJid } = require('../utils/privacy');

const router = express.Router();

router.get('/', (req, res) => {
    res.json({
        status: global.telegramConnected ? 'connected' : 'disconnected',
        service: 'Telegram (teleproto/gramjs)',
        connected: global.telegramConnected || false,
        targetChatId: maskJid(String(TARGET_CHAT_ID)),
    });
});

module.exports = router;
