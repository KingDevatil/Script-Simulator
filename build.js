import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

const base = path.dirname(fileURLToPath(import.meta.url));

const css = fs.readFileSync(path.join(base, 'css/style.css'), 'utf8');
const sampleScriptPath = path.join(base, 'data/scripts/dangerous-relationships.json');
const sampleScript = fs.existsSync(sampleScriptPath) ? fs.readFileSync(sampleScriptPath, 'utf8') : '{}';

const standalonePath = path.join(base, 'index.standalone.js');
await esbuild.build({
  entryPoints: [path.join(base, 'js/main.js')],
  bundle: true,
  format: 'iife',
  outfile: standalonePath,
  minify: true,
  logLevel: 'info'
});

const js = fs.readFileSync(standalonePath, 'utf8');
fs.unlinkSync(standalonePath);

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="theme-color" content="#1a1a2e">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>剧本模拟器</title>
  <link rel="manifest" href="/manifest.json">
  <style>${css}</style>
</head>
<body>
  <div id="app"></div>
  <script>window.__SAMPLE_SCRIPT__ = ${sampleScript};</script>
  <script>${js}</script>
</body>
</html>`;

const docsDir = path.join(base, 'docs');
if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
const outPath = path.join(docsDir, 'index.html');
const rootOutPath = path.join(base, 'index.html');
fs.writeFileSync(outPath, html, 'utf8');
fs.writeFileSync(rootOutPath, html, 'utf8');
writeServiceWorker();

const size = (fs.statSync(outPath).size / 1024).toFixed(1);
console.log(`Built: docs/index.html (${size}KB)`);
console.log(`Built: index.html (${size}KB)`);

function writeServiceWorker() {
  const assets = [
    '/',
    '/index.html',
    '/css/style.css',
    '/js/main.js',
    '/manifest.json',
    '/assets/icon-192.png',
    '/assets/icon-512.png'
  ].filter(asset => {
    if (asset === '/') return true;
    return fs.existsSync(path.join(base, asset.slice(1)));
  });
  const version = Date.now();
  const sw = `const CACHE_NAME = 'script-simulator-${version}';
const ASSETS = ${JSON.stringify(assets)};

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
`;
  fs.writeFileSync(path.join(base, 'sw.js'), sw, 'utf8');
}
