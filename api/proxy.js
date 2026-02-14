// api/proxy.js - Private Transparent Proxy for Tidal API
export default async function handler(req, res) {
    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'Missing url parameter' });
    }

    if (!url.startsWith('https://api.tidal.com/') && !url.startsWith('https://auth.tidal.com/')) {
        return res.status(403).json({ error: 'Forbidden target domain' });
    }

    try {
        const headers = {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };

        if (req.headers.authorization) {
            headers['Authorization'] = req.headers.authorization;
        }

        let body = undefined;
        if (req.method === 'POST') {
            const contentType = req.headers['content-type'] || 'application/json';
            headers['Content-Type'] = contentType;

            if (contentType.includes('application/x-www-form-urlencoded')) {
                // Convert parsed object back to form string
                body = new URLSearchParams(req.body).toString();
            } else if (contentType.includes('application/json')) {
                body = JSON.stringify(req.body);
            } else {
                body = req.body;
            }
        }

        console.log(`[Proxy] ${req.method} -> ${url}`);

        const response = await fetch(url, {
            method: req.method,
            headers: headers,
            body: body
        });

        const data = await response.json().catch(async () => {
            const text = await response.text();
            try { return JSON.parse(text); } catch(e) { return { raw: text }; }
        });
        
        // Ensure headers for client
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        return res.status(response.status).json(data);
    } catch (error) {
        console.error('Proxy Error:', error);
        return res.status(500).json({ error: 'Proxy Exception', message: error.message });
    }
}
