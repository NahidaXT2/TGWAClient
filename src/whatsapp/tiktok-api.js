const axios = require('axios');
const cheerio = require('cheerio');

// ============================================================
// Extraer username desde diferentes formatos de entrada
// ============================================================
function extractUsername(input) {
    const trimmed = input.trim();

    // Si es un username directo (@usuario)
    if (trimmed.startsWith('@')) {
        return trimmed;
    }

    // Si es una URL de TikTok, extraer el username
    const tiktokUrlPatterns = [
        /tiktok\.com\/@([^\/\?]+)/,
        /vm\.tiktok\.com\/.*/,
        /vt\.tiktok\.com\/.*/,
    ];

    for (const pattern of tiktokUrlPatterns) {
        const match = trimmed.match(pattern);
        if (match) {
            // Si es URL de video corto (vm/vt), necesitamos extraer de otra forma
            if (trimmed.includes('vm.tiktok.com') || trimmed.includes('vt.tiktok.com')) {
                // Para URLs cortas, podríamos necesitar hacer una request para redirigir
                // Por ahora, retornamos el input completo y se manejará en fetchTikTokVideos
                return trimmed;
            }
            return '@' + match[1];
        }
    }

    // Si no es URL, asumir que es username sin @
    if (!trimmed.includes('/')) {
        return trimmed.startsWith('@') ? trimmed : '@' + trimmed;
    }

    return trimmed;
}

// ============================================================
// Obtener videos de TikTok desde ssstik.io
// ============================================================
async function fetchTikTokVideos(username) {
    const url = 'https://ssstik.io/abc';

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Referer': 'https://ssstik.io/tiktok-viewer',
        'HX-Request': 'true',
        'HX-Trigger': '_gcaptcha_pt',
        'HX-Target': 'target',
        'HX-Current-URL': 'https://ssstik.io/tiktok-viewer',
        'Origin': 'https://ssstik.io',
        'Sec-GPC': '1',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
        'Priority': 'u=4',
        'TE': 'trailers',
    };

    const params = {
        url: 'dl',
    };

    const data = new URLSearchParams();
    data.append('id', username);
    data.append('locale', 'en');
    data.append('tt', 'UmlZWXph');
    data.append('debug', 'ab=1&loc=PE&ip=161.132.54.231');

    try {
        const response = await axios.post(url, data, {
            headers,
            params,
            timeout: 30000,
        });

        return response.data;
    } catch (error) {
        throw new Error(`Error fetching TikTok videos: ${error.message}`);
    }
}

// ============================================================
// Parsear HTML para extraer videos y thumbnails
// ============================================================
function parseVideos(html) {
    const $ = cheerio.load(html);
    const results = [];

    // Verificar si el perfil no existe
    if (html.includes('PROFILE_LINK_NOT_EXISTING')) {
        throw new Error('El perfil de TikTok no existe o no es público');
    }

    // Recorrer cada contenedor de video
    $('.custom-video-item').each((index, element) => {
        const $item = $(element);

        // Extract thumbnail URL: intenta obtenerla del style="background-image: url(...)" o del data-url
        const styleAttr = $item.find('.video-thumbnail, .video-overlay-active').first().attr('style') || '';
        const bgMatch = styleAttr.match(/url\((['"]?)(.*?)\1\)/);
        const thumbnail = bgMatch ? bgMatch[2] : null;

        // Buscar todos los enlaces de descarga dentro de este contenedor
        $item.find('a.dl-button.download_link.without_watermark').each((_, aEl) => {
            const downloadUrl = $(aEl).attr('href');

            // Filtrar solo las URLs de descarga que contengan "tiktokcdn"
            if (downloadUrl && downloadUrl.includes('tiktokcdn')) {
                results.push({
                    downloadUrl,
                    thumbnail,
                });
            }
        });
    });

    return results;
}

module.exports = {
    extractUsername,
    fetchTikTokVideos,
    parseVideos,
};
