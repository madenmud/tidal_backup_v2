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
        const headers = {
            'Accept': 'application/json',
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

        const response = await fetch(url, { method: req.method, headers, body: fetchBody });
        const data = await response.json().catch(async () => {
            const text = await response.text();
            try { return JSON.parse(text); } catch (e) { return { raw: text }; }
        });

        return res.status(response.status).json(data);
    } catch (error) {
        return res.status(500).json({ error: 'Proxy fail', message: error.message });
    }
}
