// api/proxy.js - Private CORS Proxy for Tidal API
export default async function handler(req, res) {
    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'Missing url parameter' });
    }

    // Only allow Tidal API domains for security
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

        let body;
        if (req.method === 'POST') {
            const contentType = req.headers['content-type'] || 'application/json';
            headers['Content-Type'] = contentType;
            
            if (contentType.includes('application/x-www-form-urlencoded')) {
                // If it came in as a string/buffer, pass it along. 
                // Vercel parses bodies, so if it's already an object, convert back to form-urlencoded
                if (typeof req.body === 'object') {
                    body = new URLSearchParams(req.body).toString();
                } else {
                    body = req.body;
                }
            } else {
                body = typeof req.body === 'object' ? JSON.stringify(req.body) : req.body;
            }
        }

        const response = await fetch(url, {
            method: req.method,
            headers: headers,
            body: body
        });

        const data = await response.json().catch(async () => {
            const text = await response.text();
            return { raw: text };
        });
        
        // Ensure CORS for our own frontend (though on the same domain it's not strictly needed)
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        res.status(response.status).json(data);
    } catch (error) {
        console.error('Proxy Error:', error);
        res.status(500).json({ error: 'Failed to fetch from Tidal API', details: error.message });
    }
}
