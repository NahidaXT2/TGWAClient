// ============================================================
// Utilidades de privacidad
// ============================================================
function maskJid(jid) {
    if (!jid) return 'unknown';
    const s = String(jid);
    const at = s.indexOf('@');
    const local = at === -1 ? s : s.slice(0, at);
    const domain = at === -1 ? '' : s.slice(at);

    if (local.length <= 8) return `***${domain}`;
    return `${local.slice(0, 3)}***${local.slice(-3)}${domain}`;
}

module.exports = { maskJid };
