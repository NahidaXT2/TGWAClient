// ============================================================
// Tracking de selecciones de videos TikTok (request-response bloqueante)
// Almacena: messageId => { resolve, reject, timeout, videos, remoteJid }
// ============================================================
const pendingSelections = new Map();

function registerPendingSelection(messageId, videos, remoteJid, timeoutMs, profile = null) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            if (pendingSelections.has(messageId)) {
                pendingSelections.delete(messageId);
                reject(new Error('Timeout: el usuario no seleccionó un video en ' + timeoutMs + 'ms'));
            }
        }, timeoutMs);
        pendingSelections.set(messageId, { resolve, reject, timeout, videos, remoteJid, profile });
    });
}

function clearPendingSelections() {
    pendingSelections.forEach((v) => clearTimeout(v.timeout));
    pendingSelections.clear();
}

module.exports = { pendingSelections, registerPendingSelection, clearPendingSelections };
