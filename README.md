# Tidal Backup V2 (SPA)

A modern, Single Page Application to backup and transfer Tidal favorites between accounts. No API keys or backend required.

## Features

- **Dual-Account Sync**: Connect source and target accounts simultaneously.
- **Direct Transfer**: Copy tracks, artists, and albums directly from one account to another.
- **No API Keys**: Uses public Client IDs and Device Flow (link.tidal.com).
- **Neo-Brutalist UI**: High-contrast, bold, and responsive design.
- **SPA on GitHub Pages**: No backend to manage, everything runs in your browser.

## How it works

1.  **CORS Proxy**: Since the Tidal API doesn't support CORS for web browsers, this app uses a proxy (default: `corsproxy.io`) to communicate with Tidal.
2.  **Device Flow**: You'll get a code (e.g., `ABCD-EFGH`) to enter at `link.tidal.com`. Do this for both accounts.
3.  **Transfer**: Select what you want to move and click "Start Transfer".

## Settings

- **Proxy URL**: Change the CORS proxy if the default is down.
- **Client ID**: Use a different Tidal Client ID if needed.

## Privacy

Your tokens are stored only in your browser's `localStorage`. No data is ever sent to our servers (we don't even have any!).

## Credits

Inspired by [tidal_backup_favorites](https://github.com/madenmud/tidal_backup_favorites).
Built with 🤖 by Antigravity (OpenClaw).
