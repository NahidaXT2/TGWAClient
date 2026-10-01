// ============================================================
// Tracking de CAPTCHAs pendientes (request-response bloqueante)
// Almacena: messageId => { resolve, reject, timeout }
// ============================================================
const pendingCaptchas = new Map();

function registerPendingCaptcha(messageId, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            if (pendingCaptchas.has(messageId)) {
                pendingCaptchas.delete(messageId);
                reject(new Error('Timeout: el usuario no respondió al CAPTCHA en ' + timeoutMs + 'ms'));
            }
        }, timeoutMs);
        pendingCaptchas.set(messageId, { resolve, reject, timeout });
    });
}

function clearPendingCaptchas() {
    pendingCaptchas.forEach((v) => clearTimeout(v.timeout));
    pendingCaptchas.clear();
}

module.exports = { pendingCaptchas, registerPendingCaptcha, clearPendingCaptchas };
