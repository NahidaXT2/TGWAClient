// ============================================================
// Comandos WhatsApp
// ============================================================
const { extractUsername, fetchTikTokVideos, parseVideos, parseProfileHeader } = require('./tiktok-api');
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
                console.log(`[TikTok Command] Input: ${input}, Extracted username: ${username}`);
                await sock.sendMessage(remoteJid, { text: '🔍 Buscando videos...' });

                const html = await fetchTikTokVideos(username);
                const profile = parseProfileHeader(html);
                const videos = parseVideos(html);

                if (videos.length === 0) {
                    return '❌ No se encontraron videos para este perfil';
                }

                console.log(`[TikTok Command] Videos to send: ${videos.length}, Profile: ${profile.username}`);

                // Limitar a 4 videos máximo
                const MAX_VIDEOS = 4;
                const videosToSend = videos.slice(0, MAX_VIDEOS);

                console.log(`[TikTok Command] Sending ${videosToSend.length} videos (limited from ${videos.length})`);

                // Enviar álbum nativo con Baileys 6.7.0
                try {
                    // Paso 1: Enviar mensaje de álbum para obtener albumParentKey
                    const albumMsg = await sock.sendMessage(remoteJid, {
                        album: {
                            expectedImageCount: videosToSend.length,
                        },
                    });
                    console.log(`[TikTok Command] Album message sent, albumParentKey: ${albumMsg.key.id}`);

                    // Paso 2: Enviar cada imagen con el albumParentKey
                    for (let i = 0; i < videosToSend.length; i++) {
                        const video = videosToSend[i];
                        console.log(`[TikTok Command] Sending image ${i + 1}/${videosToSend.length} with albumParentKey`);

                        try {
                            await sock.sendMessage(remoteJid, {
                                image: { url: video.thumbnail },
                                caption: `${i + 1} - ${profile.username} - Duración: ${video.duration}`,
                                albumParentKey: albumMsg.key,
                            });
                        } catch (err) {
                            console.error(`[TikTok Command] Error sending image ${i + 1}: ${err.message}`);
                        }
                    }

                    console.log(`[TikTok Command] Album sent successfully with ${videosToSend.length} images`);
                } catch (err) {
                    console.error(`[TikTok Command] Error sending album: ${err.message}`);
                    // Fallback: enviar imágenes una por una si falla el álbum
                    for (let i = 0; i < videosToSend.length; i++) {
                        const video = videosToSend[i];
                        try {
                            await sock.sendMessage(remoteJid, {
                                image: { url: video.thumbnail },
                                caption: `${i + 1}`,
                            });
                        } catch (fallbackErr) {
                            console.error(`[TikTok Command] Error sending image ${i + 1} (fallback): ${fallbackErr.message}`);
                        }
                    }
                }

                // Mensaje de instrucción para seleccionar
                const selectionMessage = `📹 Se encontraron ${videos.length} videos (mostrando los primeros ${videosToSend.length}).\n\nResponde con el número del video que quieres (1-${videosToSend.length})`;
                const msg = await sock.sendMessage(remoteJid, { text: selectionMessage });

                console.log(`[TikTok Command] Selection message ID: ${msg.key.id}`);

                // Registrar selección pendiente (con los videos limitados y perfil)
                registerPendingSelection(msg.key.id, videosToSend, remoteJid, WPP_TIKTOK_TIMEOUT, profile);

                return null; // Ya enviamos mensajes manualmente
            } catch (error) {
                console.error(`ERROR [TikTok Command] ${error.message}`);
                console.error(`ERROR [TikTok Command] Stack: ${error.stack}`);
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
