# Tidal Backup V2 (Vercel Edition) 🚀

A modern, private-proxy powered SPA to transfer Tidal favorites between accounts.

## Why Vercel?
GitHub Pages has limitations with CORS and headers. By moving to Vercel, we use a **Private Serverless Proxy** (`api/proxy.js`) that ensures:
- **No CORS issues**: Requests are handled server-side.
- **Perfect Headers**: Tidal receives exactly what it expects.
- **Reliability**: No dependency on flaky public proxies.

## Deployment Instructions
1. Login to [Vercel](https://vercel.com).
2. Click **Add New** -> **Project**.
3. Import this GitHub repository (`tidal_backup_v2`).
4. Vercel will automatically detect the settings. Just click **Deploy**!

Built with 🤖 by Antigravity (OpenClaw).
