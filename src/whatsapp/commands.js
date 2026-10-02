// ============================================================
// Comandos WhatsApp
// ============================================================
const { extractUsername, fetchTikTokVideos, parseVideos } = require('./tiktok-api');
const { registerPendingSelection } = require('./tiktok-selections');
const { WPP_TIKTOK_TIMEOUT } = require('../config');
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
    tiktok: {
        description: 'Descargar videos de TikTok: /tiktok @usuario o URL',
        handler: async ({ sock, remoteJid, args }) => {
            if (args.length === 0) {
                return '❌ Uso: /tiktok @usuario o /tiktok <url>';
            }

            const input = args.join(' ');
            const username = extractUsername(input);

            try {
                await sock.sendMessage(remoteJid, { text: '🔍 Buscando videos...' });

                const html = await fetchTikTokVideos(username);
                const videos = parseVideos(html);

                if (videos.length === 0) {
                    return '❌ No se encontraron videos para este perfil';
                }

                // WhatsApp tiene límite de 10 imágenes por álbum
                const MAX_ALBUM_SIZE = 10;
                const albumChunks = [];

                for (let i = 0; i < videos.length; i += MAX_ALBUM_SIZE) {
                    albumChunks.push(videos.slice(i, i + MAX_ALBUM_SIZE));
                }

                // Enviar cada chunk como un álbum
                for (let chunkIndex = 0; chunkIndex < albumChunks.length; chunkIndex++) {
                    const chunk = albumChunks[chunkIndex];
                    const startIndex = chunkIndex * MAX_ALBUM_SIZE + 1;

                    const albumItems = chunk.map((v, i) => ({
                        image: { url: v.thumbnail },
                        caption: `${startIndex + i}`,
                    }));

                    await sock.sendMessage(remoteJid, { album: albumItems });
                }

                // Mensaje de instrucción para seleccionar
                const selectionMessage = `📹 Se encontraron ${videos.length} videos.\n\nResponde con el número del video que quieres (1-${videos.length})`;
                const msg = await sock.sendMessage(remoteJid, { text: selectionMessage });

                // Registrar selección pendiente
                registerPendingSelection(msg.key.id, videos, remoteJid, WPP_TIKTOK_TIMEOUT);

                return null; // Ya enviamos mensajes manualmente
            } catch (error) {
                console.error(`ERROR [TikTok] ${error.message}`);
                return `❌ Error: ${error.message}`;
            }
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
