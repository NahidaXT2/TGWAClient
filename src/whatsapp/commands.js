// ============================================================
// Comandos WhatsApp
// ============================================================
const COMMANDS = {
    now: {
        description: 'Muestra la hora del servidor',
        handler: async () => {
            const now = new Date();
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const local = now.toLocaleString('es-PE', { hour12: false });
            return [
                `🕐 Hora del servidor:`,
                `  • Local:  ${local}`,
                `  • ISO:    ${now.toISOString()}`,
                `  • TZ:     ${tz}`,
                `  • Epoch:  ${now.getTime()}`,
            ].join('\n');
        },
    },
    ping: {
        description: 'Verifica que el bot está vivo',
        handler: async () => `🏓 Pong (${Date.now()})`,
    },
    echo: {
        description: 'Repite el texto que envíes: /echo hola mundo',
        handler: async ({ args }) => args.length ? args.join(' ') : '(vacío)',
    },
    help: {
        description: 'Lista los comandos disponibles',
        handler: async () => {
            const lines = ['📋 Comandos disponibles:'];
            for (const [name, cmd] of Object.entries(COMMANDS)) {
                lines.push(`  /${name} — ${cmd.description}`);
            }
            return lines.join('\n');
        },
    },
};

function parseCommand(text) {
    const trimmed = text.trim();
    if (!trimmed.startsWith('/')) return null;
    const parts = trimmed.slice(1).split(/\s+/);
    if (!parts[0]) return null;
    return { name: parts[0].toLowerCase(), args: parts.slice(1) };
}

module.exports = { COMMANDS, parseCommand };
