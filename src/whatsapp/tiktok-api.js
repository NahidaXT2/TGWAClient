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

    // Si es una URL de video individual (contiene /video/), retornar la URL completa
    if (trimmed.includes('/video/')) {
        console.log(`[TikTok API] Detected single video URL: ${trimmed}`);
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
// Obtener video individual desde musicaldown.net con reintentos
// ============================================================
async function fetchSingleVideoMusicalDown(url, maxRetries = 3) {
    const apiUrl = 'https://musicaldown.net/api/ajaxSearch';

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Origin': 'https://musicaldown.net',
        'Sec-GPC': '1',
        'Connection': 'keep-alive',
        'Referer': 'https://musicaldown.net/en',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Priority': 'u=0',
    };

    const data = new URLSearchParams();
    data.append('q', url);
    data.append('cursor', '0');
    data.append('page', '0');
    data.append('lang', 'en');

    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`[MusicalDown] Fetching video: ${url} (attempt ${attempt}/${maxRetries})`);
            const response = await axios.post(apiUrl, data, {
                headers,
                timeout: 30000,
            });

            console.log(`[MusicalDown] Response status: ${response.status}`);
            console.log(`[MusicalDown] Response data preview: ${JSON.stringify(response.data).substring(0, 200)}...`);

            if (response.data?.status === 'ok') {
                return response.data;
            }

            throw new Error('Invalid response status from musicaldown');
        } catch (error) {
            lastError = error;
            console.error(`[MusicalDown] Error (attempt ${attempt}/${maxRetries}): ${error.message}`);
            if (error.response) {
                console.error(`[MusicalDown] Status: ${error.response.status}`);
            }

            if (attempt < maxRetries) {
                const delay = attempt * 2000;
                console.log(`[MusicalDown] Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    throw new Error(`Error fetching from musicaldown after ${maxRetries} attempts: ${lastError.message}`);
}

// ============================================================
// Parsear respuesta de musicaldown para extraer opciones
// ============================================================
function parseMusicalDownOptions(jsonResponse) {
    console.log(`[MusicalDown] Parsing options`);

    const html = jsonResponse.data;
    const $ = cheerio.load(html);

    // Extraer thumbnail
    const thumbnail = $('.image-tik img').attr('src') || null;

    // Extraer descripción
    const description = $('h3').text().trim();

    // Extraer opciones de descarga
    const options = [];
    $('.tik-button-dl').each((index, element) => {
        const $btn = $(element);
        const text = $btn.text().trim();
        const href = $btn.attr('href');

        if (href) {
            let format = 'unknown';
            if (text.includes('MP4 HD')) format = 'mp4_hd';
            else if (text.includes('MP4 [2]')) format = 'mp4_2';
            else if (text.includes('MP4 [1]')) format = 'mp4_1';
            else if (text.includes('MP3')) format = 'mp3';

            options.push({
                label: text,
                url: href,
                format,
            });
        }
    });

    console.log(`[MusicalDown] Found ${options.length} options: ${options.map(o => o.format).join(', ')}`);

    return {
        thumbnail,
        description,
        options,
    };
}

// ============================================================
// Obtener videos de TikTok desde ssstik.io con reintentos
// ============================================================
async function fetchTikTokVideos(username, maxRetries = 3) {
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

    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`[TikTok API] Fetching videos for: ${username} (attempt ${attempt}/${maxRetries})`);
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
            lastError = error;
            console.error(`[TikTok API] Error (attempt ${attempt}/${maxRetries}): ${error.message}`);
            if (error.response) {
                console.error(`[TikTok API] Status: ${error.response.status}`);
                console.error(`[TikTok API] Data: ${error.response.data?.substring(0, 200) || 'empty'}`);
            }

            if (attempt < maxRetries) {
                const delay = attempt * 2000; // 2s, 4s, 6s
                console.log(`[TikTok API] Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    throw new Error(`Error fetching TikTok videos after ${maxRetries} attempts: ${lastError.message}`);
}

// ============================================================
// Detectar tipo de respuesta: perfil o video individual
// ============================================================
function detectResponseType(html) {
    const $ = cheerio.load(html);

    if ($('.custom-video-item').length > 0) {
        return 'profile';
    }

    if ($('.result#mainpicture').length > 0) {
        return 'single';
    }

    console.log('[TikTok Parse] Unknown response type');
    return 'unknown';
}

// ============================================================
// Parsear HTML para extraer información de video individual
// ============================================================
function parseSingleVideo(html) {
    console.log(`[TikTok Parse] Parsing single video`);

    const $ = cheerio.load(html);
    const result = $('.result#mainpicture');

    // Avatar
    const avatar = result.find('.result_author').attr('src') || null;

    // Username
    const username = result.find('h2').text().trim();

    // Description
    const description = result.find('.maintext').text().trim();

    // Thumbnail del background-image
    const styleMatch = html.match(/#mainpicture \.result_overlay \{[\s\S]*?background-image:\s*url\((['"]?)(.*?)\1\)/);
    const thumbnail = styleMatch ? styleMatch[2] : null;

    // Download URL (sin watermark)
    const downloadLink = result.find('a.download_link.without_watermark').first();
    const downloadUrl = downloadLink.attr('href') || null;

    // Stats (likes, comments, shares)
    const trendingActions = result.find('.trending-actions div');
    const stats = {};
    trendingActions.each((i, el) => {
        const svg = $(el).find('svg');
        let type = null;
        if (svg.hasClass('feather-thumbs-up')) type = 'likes';
        else if (svg.hasClass('feather-message-square')) type = 'comments';
        else if (svg.hasClass('feather-share-2')) type = 'shares';

        if (type) {
            stats[type] = $(el).find('div').last().text().trim();
        }
    });

    console.log(`[TikTok Parse] Single video: username=${username}, downloadUrl=${downloadUrl ? 'yes' : 'no'}`);

    return {
        avatar,
        username,
        description,
        thumbnail,
        downloadUrl,
        stats,
    };
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
    detectResponseType,
    parseSingleVideo,
    fetchSingleVideoMusicalDown,
    parseMusicalDownOptions,
};
