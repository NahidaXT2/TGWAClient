const express = require('express');
const axios = require('axios');
const { PORT } = require('../config');
const {
    isWppConnected,
    getWppClient,
    getWppQRCode,
    setWppQRCode,
    registerPendingCaptcha,
    WPP_ALLOWED_CHATS,
    WPP_CAPTCHA_TIMEOUT,
    supabase,
    WPP_SESSION_PATH,
    WPP_SESSION_ID,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
} = require('../whatsapp/client');
const { COMMANDS } = require('../whatsapp/commands');
const { clearPendingCaptchas } = require('../whatsapp/captcha');
const { maskJid } = require('../utils/privacy');

const router = express.Router();

router.get('/', (req, res) => {
    res.json({
        status: isWppConnected() ? 'connected' : 'disconnected',
        service: 'WhatsApp (Baileys)',
        connected: isWppConnected(),
        needsQR: !isWppConnected() && !getWppQRCode(),
        myId: maskJid(getWppClient()?.user?.id) || null,
        allowedChats: WPP_ALLOWED_CHATS.map(c => maskJid(c)),
        sessionPath: WPP_SESSION_PATH,
    });
});

router.get('/commands', (req, res) => {
    res.json({
        commands: Object.entries(COMMANDS).map(([name, c]) => ({
            name: `/${name}`,
            description: c.description,
        })),
    });
});

router.get('/qr', (req, res) => {
    const qr = getWppQRCode();
    if (!qr) {
        return res.send(`
<!DOCTYPE html>
<html><head><title>WhatsApp - QR</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5}
.container{text-align:center;padding:20px;background:#fff;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}
.status{margin-top:20px;padding:10px;border-radius:5px;background:#e7f3ff}</style></head>
<body><div class="container">
<h1>Vincular WhatsApp</h1>
<div id="qr-container"><p>Cargando QR...</p></div>
<div class="status" id="status">Estado: ${isWppConnected() ? 'Conectado OK' : 'Esperando QR...'}</div>
</div>
<script>
function checkQR(){fetch('/wpp/qr-data').then(r=>r.json()).then(d=>{
if(d.connected){document.getElementById('qr-container').innerHTML='<p style="font-size:48px">OK</p>';document.getElementById('status').textContent='Estado: Conectado';}
else if(d.qrCode){document.getElementById('qr-container').innerHTML='<img src="'+d.qrCode+'" style="max-width:300px" alt="QR">';document.getElementById('status').textContent='Estado: QR listo';}
else{document.getElementById('status').textContent='Estado: Esperando QR...';}
}).catch(()=>{document.getElementById('status').textContent='Estado: Error';});}
setInterval(checkQR,2000);checkQR();
</script></body></html>`);
    }
    res.send(`
<!DOCTYPE html>
<html><head><title>WhatsApp - QR</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5}
.container{text-align:center;padding:20px;background:#fff;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}
.status{margin-top:20px;padding:10px;border-radius:5px;background:#e7f3ff}</style></head>
<body><div class="container">
<h1>Vincular WhatsApp</h1>
<div id="qr-container"><img src="${qr}" style="max-width:300px" alt="QR"></div>
<div class="status" id="status">Estado: QR listo para escanear</div>
</div>
<script>
function checkQR(){fetch('/wpp/qr-data').then(r=>r.json()).then(d=>{
if(d.connected){document.getElementById('qr-container').innerHTML='<p style="font-size:48px">OK</p>';document.getElementById('status').textContent='Estado: Conectado';}
else if(d.qrCode&&d.qrCode!=='${qr}'){document.querySelector('#qr-container img').src=d.qrCode;}
}).catch(()=>{});}
setInterval(checkQR,2000);
</script></body></html>`);
});

router.get('/qr-data', (req, res) => {
    res.json({
        qrCode: getWppQRCode() || null,
        connected: isWppConnected(),
        needsQR: !isWppConnected() && !getWppQRCode(),
        myId: maskJid(getWppClient()?.user?.id) || null,
        hasSession: isWppConnected() || !!getWppQRCode(),
    });
});

// ============================================================
// WhatsApp — Resolver CAPTCHA (request-response bloqueante)
// ============================================================
router.get('/resolve-captcha', async (req, res) => {
    const { imageUrl, imageBase64, caption, callback } = req.query;

    let sentMsgId;
    let captchaPromise;

    const sendJson = (data, statusCode = 200) => {
        if (callback) {
            res.type('application/javascript');
            return res.status(200).send(`${callback}(${JSON.stringify(data)});`);
        }
        return res.status(statusCode).json(data);
    };

    try {
        if (!isWppConnected() || !getWppClient()) {
            return sendJson({ success: false, error: 'WhatsApp no conectado' }, 503);
        }

        if (WPP_ALLOWED_CHATS.length === 0) {
            return sendJson({ success: false, error: 'WPP_ALLOWED_CHATS no configurado' }, 400);
        }

        // Enviar a la primera cuenta autorizada
        const targetChat = WPP_ALLOWED_CHATS[0];

        let imageBuffer;

        if (imageBase64) {
            console.log(`[WhatsApp] Procesando CAPTCHA recibido en Base64...`);
            const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
            imageBuffer = Buffer.from(cleanBase64, 'base64');
        } else if (imageUrl) {
            console.log(`[WhatsApp] Descargando imagen CAPTCHA desde URL: ${imageUrl}`);
            const response = await axios.get(imageUrl, {
                responseType: 'arraybuffer',
                timeout: 15000,
            });
            imageBuffer = Buffer.from(response.data);
        } else {
            return sendJson({ success: false, error: 'Se requiere imageUrl o imageBase64' }, 400);
        }

        const sendResult = await getWppClient().sendMessage(
            targetChat,
            { image: imageBuffer, caption: caption || 'CAPTCHA - responde este mensaje:' }
        );

        sentMsgId = sendResult?.key?.id;

        if (!sentMsgId) {
            return sendJson({ success: false, error: 'No se pudo obtener el ID del mensaje enviado' }, 500);
        }

        captchaPromise = registerPendingCaptcha(sentMsgId, WPP_CAPTCHA_TIMEOUT);
        console.log(`[WhatsApp] CAPTCHA enviado a ${maskJid(targetChat)} (${sentMsgId}). Esperando respuesta...`);

        const result = await captchaPromise;

        sendJson({
            success: true,
            messageId: sentMsgId,
            response: result.response,
            senderJid: result.senderJid,
            targetChat: maskJid(targetChat),
        });

        console.log(`[WhatsApp] CAPTCHA resuelto (${sentMsgId})`);
    } catch (error) {
        console.error(`ERROR [WhatsApp] Error en resolve-captcha: ${error.message}`);

        if (!res.headersSent) {
            const statusCode = error.message.startsWith('Timeout') ? 408 : 500;
            sendJson({
                success: false,
                error: error.message,
                messageId: sentMsgId || null,
            }, statusCode);
        }
    }
});

router.get('/reconnect', async (req, res) => {
    try {
        const wppClient = getWppClient();
        if (wppClient) {
            try {
                wppClient.ev.removeAllListeners('creds.update');
                wppClient.ev.removeAllListeners('connection.update');
                wppClient.ev.removeAllListeners('messages.upsert');
                if (typeof wppClient.end === 'function') wppClient.end(undefined);
                else wppClient.ws?.close();
            } catch (_) { }
        }

        if (supabase) {
            const { SupabaseAuthState } = require('../../supabase-auth-state');
            const authState = new SupabaseAuthState(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WPP_SESSION_ID);
            await authState.clearState();
        } else {
            const fs = require('fs');
            if (fs.existsSync(WPP_SESSION_PATH)) fs.rmSync(WPP_SESSION_PATH, { recursive: true, force: true });
        }

        setWppQRCode(null);
        clearPendingCaptchas();

        const { initWhatsApp } = require('../whatsapp/client');
        initWhatsApp();
        res.json({ success: true, message: 'Sesión limpiada. Generando nuevo QR...', storage: supabase ? 'supabase' : 'local' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/clear-session', async (req, res) => {
    try {
        const wppClient = getWppClient();
        if (wppClient) {
            try {
                wppClient.ev.removeAllListeners('creds.update');
                wppClient.ev.removeAllListeners('connection.update');
                wppClient.ev.removeAllListeners('messages.upsert');
                if (typeof wppClient.end === 'function') wppClient.end(undefined);
                else wppClient.ws?.close();
            } catch (_) { }
        }

        if (supabase) {
            const { SupabaseAuthState } = require('../../supabase-auth-state');
            const authState = new SupabaseAuthState(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WPP_SESSION_ID);
            await authState.clearState();
        } else {
            const fs = require('fs');
            if (fs.existsSync(WPP_SESSION_PATH)) fs.rmSync(WPP_SESSION_PATH, { recursive: true, force: true });
        }

        setWppQRCode(null);
        clearPendingCaptchas();

        res.json({ success: true, message: 'Sesion eliminada.', storage: supabase ? 'supabase' : 'local' });
        console.log('[WhatsApp] Sesion eliminada manualmente');
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/resync-state', async (req, res) => {
    try {
        if (!supabase) return res.status(400).json({ success: false, error: 'Supabase no configurado' });

        const { data, error: readErr } = await supabase
            .from('whatsapp_sessions').select('session_data').eq('id', WPP_SESSION_ID).maybeSingle();
        if (readErr) throw readErr;

        const session = data?.session_data || {};
        const keys = session.keys || {};
        let removed = 0;
        for (const k of Object.keys(keys)) {
            if (k.startsWith('app-state-sync-')) { delete keys[k]; removed++; }
        }

        const { error: writeErr } = await supabase
            .from('whatsapp_sessions')
            .update({ session_data: { ...session, keys }, updated_at: new Date().toISOString() })
            .eq('id', WPP_SESSION_ID);
        if (writeErr) throw writeErr;

        res.json({ success: true, removedKeys: removed });
        console.log(`[WhatsApp] App-state reset - ${removed} keys eliminadas`);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
