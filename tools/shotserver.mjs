// Tiny capture sink. The game POSTs rendered frames here and they land in
// shots/ as PNGs, which is far more reliable than screenshotting a browser
// window that may be backgrounded — and it is how contact sheets get built.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('shots');
fs.mkdirSync(OUT, { recursive: true });

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method !== 'POST') { res.writeHead(404); return res.end('post only'); }

  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    try {
      const { name, dataUrl } = JSON.parse(body);
      const b64 = dataUrl.split(',')[1];
      const safe = String(name).replace(/[^a-z0-9._-]/gi, '_');
      const file = path.join(OUT, safe.endsWith('.png') ? safe : safe + '.png');
      fs.writeFileSync(file, Buffer.from(b64, 'base64'));
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(file);
      console.log('saved', file, (b64.length / 1024).toFixed(0) + 'kB');
    } catch (e) {
      res.writeHead(500); res.end(String(e));
    }
  });
}).listen(5274, '127.0.0.1', () => console.log('shot server on 5274'));
