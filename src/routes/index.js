const express = require('express');
const { PORT } = require('../config');
const {
    isWppConnected,
    getWppClient,
    getWppQRCode,
} = require('../whatsapp/client');
const { maskJid } = require('../utils/privacy');

const router = express.Router();

router.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'TeleClient + WhatsApp (Baileys)',
        telegramConnected: global.telegramConnected || false,
        wppConnected: isWppConnected(),
    });
});

module.exports = router;
