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
        console.log(`[TikTok API] Fetching videos for: ${username}`);
        const response = await axios.post(url, data, {
            headers,
            params,
            timeout: 30000,
        });

        console.log(`[TikTok API] Response status: ${response.status}`);
        console.log(`[TikTok API] Response data length: ${response.data?.length || 0}`);
        console.log(`[TikTok API] Response data preview: ${response.data?.substring(0, 200) || 'empty'}`);

        return response.data;
    } catch (error) {
        console.error(`[TikTok API] Error: ${error.message}`);
        if (error.response) {
            console.error(`[TikTok API] Status: ${error.response.status}`);
            console.error(`[TikTok API] Data: ${error.response.data?.substring(0, 200) || 'empty'}`);
        }
        throw new Error(`Error fetching TikTok videos: ${error.message}`);
    }
}

// ============================================================
// Parsear HTML para extraer información del perfil
// ============================================================
function parseProfileHeader(html) {
    console.log(`[TikTok Parse] Parsing profile header`);

    const $ = cheerio.load(html);
    const header = $('.profile-header');

    const avatarStyle = header.find('.avatar').attr('style') || '';
    const avatarMatch = avatarStyle.match(/url\(['"]?([^'"]+)['"]?\)/);
    const avatar = avatarMatch ? avatarMatch[1] : null;

    const username = header.find('h1.pure-u-1').text().trim();
    const postsInfo = header.find('.posts-count').text().trim();

    console.log(`[TikTok Parse] Profile: username=${username}, avatar=${avatar ? 'yes' : 'no'}`);

    return {
        avatar,
        username,
        postsInfo,
    };
}

// ============================================================
// Parsear HTML para extraer videos y thumbnails
// ============================================================
function parseVideos(html) {
    console.log(`[TikTok Parse] Parsing HTML, length: ${html?.length || 0}`);

    const $ = cheerio.load(html);
    const results = [];

    // Verificar si el perfil no existe
    if (html.includes('PROFILE_LINK_NOT_EXISTING')) {
        console.log('[TikTok Parse] Profile not existing');
        throw new Error('El perfil de TikTok no existe o no es público');
    }

    // Verificar si hay error de CAPTCHA u otros
    if (html.includes('captcha') || html.includes('CAPTCHA')) {
        console.log('[TikTok Parse] CAPTCHA detected');
        throw new Error('Se requiere CAPTCHA. Intenta nuevamente más tarde.');
    }

    const videoItems = $('.custom-video-item');
    console.log(`[TikTok Parse] Found ${videoItems.length} video items`);

    // Recorrer cada contenedor de video
    videoItems.each((index, element) => {
        const $item = $(element);

        // Extract thumbnail URL: intenta obtenerla del style="background-image: url(...)" o del data-url
        const styleAttr = $item.find('.video-thumbnail, .video-overlay-active').first().attr('style') || '';
        const bgMatch = styleAttr.match(/url\((['"]?)(.*?)\1\)/);
        const thumbnail = bgMatch ? bgMatch[2] : null;

        // Extract duration del primer .video-info-box dentro de .video-info
        const duration = $item.find('.video-info .video-info-box').first().text().trim();

        console.log(`[TikTok Parse] Item ${index}: thumbnail=${thumbnail ? 'yes' : 'no'}, duration=${duration}`);

        // Buscar todos los enlaces de descarga dentro de este contenedor
        $item.find('a.dl-button.download_link.without_watermark').each((_, aEl) => {
            const downloadUrl = $(aEl).attr('href');

            console.log(`[TikTok Parse] Download URL: ${downloadUrl?.substring(0, 50) || 'null'}...`);

            // Filtrar solo las URLs de descarga que contengan "tiktokcdn"
            if (downloadUrl && downloadUrl.includes('tiktokcdn')) {
                results.push({
                    downloadUrl,
                    thumbnail,
                    duration,
                });
            }
        });
    });

    console.log(`[TikTok Parse] Total videos found: ${results.length}`);
    return results;
}

module.exports = {
    extractUsername,
    fetchTikTokVideos,
    parseVideos,
    parseProfileHeader,
};
