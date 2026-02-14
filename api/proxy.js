// api/proxy.js - Private Proxy for Tidal API
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing url' });

    try {
        let decodedUrl = url;
        try { decodedUrl = decodeURIComponent(url); } catch (_) { /* already decoded */ }
        const isAuth = decodedUrl.includes('auth.tidal.com');
        const headers = {
            'Accept': isAuth ? '*/*' : (req.headers.accept || 'application/json'),
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };
        if (req.headers.authorization) headers['Authorization'] = req.headers.authorization;

        let fetchBody = undefined;
        if (req.method === 'POST' && req.body) {
            const contentType = req.headers['content-type'] || '';
            headers['Content-Type'] = contentType || 'application/x-www-form-urlencoded';
            if (contentType.includes('application/x-www-form-urlencoded')) {
                fetchBody = typeof req.body === 'string'
                    ? req.body
                    : new URLSearchParams(req.body).toString();
            } else {
                fetchBody = typeof req.body === 'object' ? JSON.stringify(req.body) : req.body;
            }
        }

        const response = await fetch(decodedUrl, { method: req.method, headers, body: fetchBody });
        const ct = response.headers.get('content-type') || '';
        let data;
        if (ct.includes('application/json')) {
            data = await response.json();
        } else {
            const text = await response.text();
            try { data = JSON.parse(text); } catch (e) {
                data = { error: 'Non-JSON response', status: response.status, preview: text.slice(0, 200) };
            }
        }

        return res.status(response.status).json(data);
    } catch (error) {
        const msg = error.cause?.message || error.message;
        return res.status(500).json({ error: 'Proxy fail', message: msg });
    }
}
