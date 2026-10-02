// ============================================================
// Comandos WhatsApp
// ============================================================
const { extractUsername, fetchTikTokVideos, parseVideos, parseProfileHeader, detectResponseType, parseSingleVideo, fetchSingleVideoMusicalDown, parseMusicalDownOptions } = require('./tiktok-api');
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

                // Detectar tipo de respuesta
                const responseType = detectResponseType(html);
                console.log(`[TikTok Command] Response type: ${responseType}`);

                // Si es video individual, usar musicaldown para opciones múltiples
                if (responseType === 'single') {
                    console.log(`[TikTok Command] Processing single video with musicaldown`);
                    await sock.sendMessage(remoteJid, { text: '� Buscando opciones de descarga...' });

                    let musicalData = null;
                    let lastError = null;

                    // Intentar con musicaldown
                    try {
                        const musicalResponse = await fetchSingleVideoMusicalDown(input);
                        musicalData = parseMusicalDownOptions(musicalResponse);
                    } catch (err) {
                        lastError = err;
                        console.error(`[TikTok Command] MusicalDown failed: ${err.message}`);
                    }

                    // Si musicaldown falló, intentar fallback con ssstik
                    if (!musicalData || musicalData.options.length === 0) {
                        console.log(`[TikTok Command] Fallback to ssstik.io`);
                        await sock.sendMessage(remoteJid, { text: '⚠️ musicaldown falló, intentando con ssstik.io...' });

                        let videoData = null;
                        for (let attempt = 1; attempt <= 3; attempt++) {
                            try {
                                console.log(`[TikTok Command] Parsing ssstik attempt ${attempt}/3`);
                                videoData = parseSingleVideo(html);
                                break;
                            } catch (err) {
                                lastError = err;
                                console.error(`[TikTok Command] Parse error (attempt ${attempt}/3): ${err.message}`);
                                if (attempt < 3) {
                                    await new Promise(resolve => setTimeout(resolve, 1000));
                                }
                            }
                        }

                        if (!videoData || !videoData.downloadUrl) {
                            throw lastError || new Error('No se pudo extraer el video con ningún servicio');
                        }

                        const caption = [
                            videoData.username,
                            videoData.description,
                            `❤️ ${videoData.stats.likes || 'N/A'} | 💬 ${videoData.stats.comments || 'N/A'} | 📤 ${videoData.stats.shares || 'N/A'}`,
                        ].filter(Boolean).join('\n');

                        await sock.sendMessage(remoteJid, {
                            video: { url: videoData.downloadUrl },
                            caption,
                        });

                        console.log(`[TikTok Command] Single video sent via ssstik fallback`);
                        return null;
                    }

                    // Presentar opciones de musicaldown
                    console.log(`[TikTok Command] Presenting ${musicalData.options.length} format options`);

                    const optionsText = musicalData.options.map((opt, i) => `${i + 1}. ${opt.label}`).join('\n');
                    const selectionMessage = `📹 Formatos disponibles:\n\n${optionsText}\n\nResponde con el número del formato que quieres (1-${musicalData.options.length})`;

                    const msg = await sock.sendMessage(remoteJid, { text: selectionMessage });

                    console.log(`[TikTok Command] Selection message ID: ${msg.key.id}`);

                    // Registrar selección pendiente de formato
                    registerPendingSelection(msg.key.id, musicalData.options, remoteJid, WPP_TIKTOK_TIMEOUT, null, 'format', musicalData)
                        .catch((err) => {
                            console.log(`[TikTok Command] Selección timeout: ${err.message}`);
                        });

                    return null;
                }

                // Si es perfil, continuar con flujo normal
                if (responseType !== 'profile') {
                    return '❌ No se pudo identificar el tipo de respuesta';
                }

                let profile = null;
                let videos = [];
                let lastParseError = null;

                // Reintentar parseado hasta 3 veces
                for (let attempt = 1; attempt <= 3; attempt++) {
                    try {
                        console.log(`[TikTok Command] Parsing profile attempt ${attempt}/3`);
                        profile = parseProfileHeader(html);
                        videos = parseVideos(html);
                        break;
                    } catch (err) {
                        lastParseError = err;
                        console.error(`[TikTok Command] Parse error (attempt ${attempt}/3): ${err.message}`);
                        if (attempt < 3) {
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }
                    }
                }

                if (videos.length === 0) {
                    if (lastParseError) {
                        throw lastParseError;
                    }
                    return '❌ No se encontraron videos para este perfil';
                }

                console.log(`[TikTok Command] Videos to send: ${videos.length}, Profile: ${profile.username}`);

                const MAX_VIDEOS = 12;
                const videosToSend = videos.slice(0, MAX_VIDEOS);

                console.log(`[TikTok Command] Sending ${videosToSend.length} videos (limited from ${videos.length})`);

                const ALBUM_SIZE = 12;
                const numAlbums = Math.ceil(videosToSend.length / ALBUM_SIZE);

                for (let albumIndex = 0; albumIndex < numAlbums; albumIndex++) {
                    const startIdx = albumIndex * ALBUM_SIZE;
                    const endIdx = Math.min(startIdx + ALBUM_SIZE, videosToSend.length);
                    const albumVideos = videosToSend.slice(startIdx, endIdx);

                    console.log(`[TikTok Command] Sending album ${albumIndex + 1}/${numAlbums} with ${albumVideos.length} videos`);

                    try {
                        // Paso 1: Enviar mensaje de álbum para obtener albumParentKey
                        const albumMsg = await sock.sendMessage(remoteJid, {
                            album: {
                                expectedImageCount: albumVideos.length,
                            },
                        });
                        console.log(`[TikTok Command] Album ${albumIndex + 1} message sent, albumParentKey: ${albumMsg.key.id}`);

                        // Paso 2: Enviar cada imagen con el albumParentKey
                        for (let i = 0; i < albumVideos.length; i++) {
                            const video = albumVideos[i];
                            const globalIndex = startIdx + i + 1; // Índice global 1-12
                            console.log(`[TikTok Command] Sending image ${globalIndex}/${videosToSend.length} with albumParentKey`);

                            try {
                                await sock.sendMessage(remoteJid, {
                                    image: { url: video.thumbnail },
                                    caption: `${globalIndex} - ${profile.username} - Duración: ${video.duration}`,
                                    albumParentKey: albumMsg.key,
                                });
                            } catch (err) {
                                console.error(`[TikTok Command] Error sending image ${globalIndex}: ${err.message}`);
                            }
                        }

                        console.log(`[TikTok Command] Album ${albumIndex + 1} sent successfully with ${albumVideos.length} images`);
                    } catch (err) {
                        console.error(`[TikTok Command] Error sending album ${albumIndex + 1}: ${err.message}`);
                        // Fallback: enviar imágenes una por una si falla el álbum
                        for (let i = 0; i < albumVideos.length; i++) {
                            const video = albumVideos[i];
                            const globalIndex = startIdx + i + 1;
                            try {
                                await sock.sendMessage(remoteJid, {
                                    image: { url: video.thumbnail },
                                    caption: `${globalIndex}`,
                                });
                            } catch (fallbackErr) {
                                console.error(`[TikTok Command] Error sending image ${globalIndex} (fallback): ${fallbackErr.message}`);
                            }
                        }
                    }

                    // Delay entre álbumes para evitar spam
                    if (albumIndex < numAlbums - 1) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }

                // Mensaje de instrucción para seleccionar
                const selectionMessage = `📹 Se encontraron ${videos.length} videos (mostrando los primeros ${videosToSend.length}).\n\nResponde con el número del video que quieres (1-${videosToSend.length})`;
                const msg = await sock.sendMessage(remoteJid, { text: selectionMessage });

                console.log(`[TikTok Command] Selection message ID: ${msg.key.id}`);

                // Registrar selección pendiente (con los videos limitados y perfil)
                registerPendingSelection(msg.key.id, videosToSend, remoteJid, WPP_TIKTOK_TIMEOUT, profile)
                    .catch((err) => {
                        console.log(`[TikTok Command] Selección timeout: ${err.message}`);
                    });

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
