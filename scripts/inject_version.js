/**
 * Generates version.js and adds cache-busting to script URLs at build time.
 */
const fs = require('fs');
const path = require('path');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
const version = `v${pkg.version}`;
const buildTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
const cacheKey = Date.now().toString(36);

const content = `/** Generated at build time. Do not edit. */
window.__BUILD__ = { version: "${version}", buildTime: "${buildTime}" };
`;

fs.writeFileSync(path.join(__dirname, '../public/js/version.js'), content);

const htmlPath = path.join(__dirname, '../public/index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
html = html.replace(/__CACHE_KEY__/g, cacheKey);
html = html.replace(/\?v=[a-z0-9]+/g, `?v=${cacheKey}`);
fs.writeFileSync(htmlPath, html);

console.log(`[build] Injected ${version} (${buildTime}) cache=${cacheKey}`);
