// Servidor mínimo para las pruebas: estáticos de la build + proxy de /api, como nginx en producción.
import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, resolve } from 'node:path';

const root = resolve('dist/frontend/browser');
const apiPort = Number(process.env.API_PORT || 8000);
const types = {
  '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

if (!existsSync(join(root, 'index.html'))) {
  console.error('No hay build en dist/frontend/browser. Ejecuta antes `npx ng build` (o `npm run e2e`).');
  process.exit(1);
}

http.createServer((req, res) => {
  if (req.url === '/health') return res.writeHead(200).end('ok');
  if (req.url.startsWith('/api/')) {
    const proxy = http.request(
      { host: '127.0.0.1', port: apiPort, path: req.url, method: req.method, headers: req.headers },
      r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); },
    );
    proxy.on('error', () => res.writeHead(502).end());
    return req.pipe(proxy);
  }
  let file = join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  createReadStream(file).pipe(res);
}).listen(Number(process.env.PORT || 4300));
