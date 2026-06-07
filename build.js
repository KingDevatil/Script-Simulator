const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const base = __dirname;

// Read CSS
const css = fs.readFileSync(path.join(base, 'css/style.css'), 'utf8');

// Read sample script
const sampleScript = fs.readFileSync(path.join(base, 'data/scripts/dangerous-relationships.json'), 'utf8');

// Bundle JS
execSync(`npx esbuild js/main.js --bundle --format=iife --outfile=index.standalone.js --minify`, { cwd: base, stdio: 'inherit' });
const js = fs.readFileSync(path.join(base, 'index.standalone.js'), 'utf8');

// Clean up
fs.unlinkSync(path.join(base, 'index.standalone.js'));

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
  <style>${css}</style>
</head>
<body>
  <div id="app"></div>
  <script>window.__SAMPLE_SCRIPT__ = ${sampleScript};</script>
  <script>${js}</script>
</body>
</html>`;

fs.writeFileSync(path.join(base, 'index.standalone.html'), html, 'utf8');

const size = (fs.statSync(path.join(base, 'index.standalone.html')).size / 1024).toFixed(1);
console.log(`Built: index.standalone.html (${size}KB)`);
