/**
 * سرور کوچک برای پیش‌نمایش UI در مرورگر
 * اجرا: node tests/server.js [port]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const port = parseInt(process.argv[2] || '8765', 10);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg'
};

http.createServer((req, res) => {
  let filePath = decodeURIComponent(req.url.split('?')[0]);
  if (filePath === '/') filePath = '/tests/preview.html';
  const full = path.join(root, path.normalize(filePath).replace(/^([/\\])+/, ''));
  if (!full.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(port, () => console.log(`preview server: http://localhost:${port}`));
