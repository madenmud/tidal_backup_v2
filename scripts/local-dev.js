const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Dynamic import for node-fetch to support CommonJS
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, '../public');

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

const TIDALAPI_CLIENT_ID = 'fX2JxdmntZWK0ixT';
const TIDALAPI_CLIENT_SECRET = '1Nn9AfDAjxrgJFJbKNWLeAyKGVGmINuXPPLHVXAvxAg=';

async function handleProxy(req, res) {
    const parsedUrl = url.parse(req.url, true);
    const targetUrlParam = parsedUrl.query.url;

    if (!targetUrlParam) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing url' }));
        return;
    }

    try {
        let decodedUrl = targetUrlParam;
        try { decodedUrl = decodeURIComponent(targetUrlParam); } catch (_) { }

        console.log(`[Proxy] ${req.method} ${decodedUrl}`);

        const isAuth = decodedUrl.includes('auth.tidal.com');
        const isLegacyApi = decodedUrl.includes('api.tidal.com/v1') || decodedUrl.includes('api.tidal.com/v2');
        const isQobuz = decodedUrl.includes('qobuz.com');

        const headers = {
            'Accept': isAuth ? '*/*' : (req.headers.accept || 'application/json'),
            'User-Agent': (isLegacyApi || isQobuz)
                ? 'Mozilla/5.0 (Linux; Android 12; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Safari/537.36'
                : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };

        if (isLegacyApi) headers['x-tidal-client-version'] = '2025.7.16';
        if (req.headers.authorization) headers['Authorization'] = req.headers.authorization;
        if (req.headers['x-user-auth-token']) headers['x-user-auth-token'] = req.headers['x-user-auth-token'];

        let fetchBody = undefined;
        if ((req.method === 'POST' || req.method === 'PUT')) {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const bodyBuffer = Buffer.concat(chunks);
            const bodyString = bodyBuffer.toString();

            if (bodyString) {
                const contentType = req.headers['content-type'] || '';
                headers['Content-Type'] = contentType || 'application/x-www-form-urlencoded';

                // Special handling for Tidal Token Exchange locally
                if (decodedUrl.includes('auth.tidal.com') && decodedUrl.includes('oauth2/token') && bodyString.includes('device_code')) {
                    // Simple parsing for form-urlencoded
                    const params = new URLSearchParams(bodyString);
                    if (!params.has('client_secret') && params.get('client_id') === TIDALAPI_CLIENT_ID) {
                        params.append('client_secret', TIDALAPI_CLIENT_SECRET);
                        params.append('scope', 'r_usr w_usr w_sub');
                        fetchBody = params.toString();
                    } else {
                        fetchBody = bodyString;
                    }
                } else {
                    fetchBody = bodyString;
                }
            }
        }

        const response = await fetch(decodedUrl, {
            method: req.method,
            headers,
            body: fetchBody
        });

        // Forward status and headers
        res.statusCode = response.status;
        res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');

        // Forward body
        const arrayBuffer = await response.arrayBuffer();
        res.end(Buffer.from(arrayBuffer));

    } catch (error) {
        console.error('[Proxy Error]', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Proxy fail', message: error.message }));
    }
}

const server = http.createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-auth-token');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    const parsedUrl = url.parse(req.url);
    let pathname = parsedUrl.pathname;

    // API Proxy Handler
    if (pathname === '/api/proxy') {
        await handleProxy(req, res);
        return;
    }

    // Static File Serving
    if (pathname === '/') pathname = '/index.html';

    // Normalize path to prevent directory traversal
    const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    let filePath = path.join(PUBLIC_DIR, safePath);

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
    });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`
🚀 Tidal Backup V2 Local Server Running!
---------------------------------------
📡 URL: http://127.0.0.1:${PORT}
📁 Serving: ${PUBLIC_DIR}
JB Proxy: Active (/api/proxy)
---------------------------------------
`);
});
