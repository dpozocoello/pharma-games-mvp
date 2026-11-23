// Gateway de staging local: hace de CDN + balanceador (sin dependencias).
// - Sirve el build de la PWA (puerto PWA_PORT) y del panel (ADMIN_PORT) con fallback SPA.
// - Reparte /api, /health y /ready entre las réplicas de la API (round-robin) y, si una no
//   responde, reintenta en la siguiente (failover), agregando X-Forwarded-For.
import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const UPSTREAMS = (process.env.API_UPSTREAMS ?? 'http://127.0.0.1:3001,http://127.0.0.1:3002')
  .split(',')
  .map((u) => new URL(u));
const SITES = [
  { port: Number(process.env.PWA_PORT ?? 8080), dir: join(ROOT, 'apps/pwa/dist') },
  { port: Number(process.env.ADMIN_PORT ?? 8081), dir: join(ROOT, 'apps/admin/dist') },
];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
};

let next = 0;
function proxy(req, res, body, attempt = 0, first = next++) {
  // `first` se fija una vez por solicitud; los reintentos recorren las demás réplicas en orden.
  const target = UPSTREAMS[(first + attempt) % UPSTREAMS.length];
  const headers = { ...req.headers, 'x-forwarded-for': req.socket.remoteAddress ?? '127.0.0.1' };
  const up = http.request(
    { host: target.hostname, port: target.port, method: req.method, path: req.url, headers },
    (r) => {
      res.writeHead(r.statusCode ?? 502, { ...r.headers, 'x-upstream': target.port });
      r.pipe(res);
    },
  );
  up.on('error', () => {
    // Réplica caída: se reintenta en la siguiente (todas son intercambiables, sin estado).
    if (attempt + 1 < UPSTREAMS.length) return proxy(req, res, body, attempt + 1, first);
    res.writeHead(502, { 'content-type': 'application/problem+json' });
    res.end(JSON.stringify({ title: 'BAD_GATEWAY', status: 502 }));
  });
  up.end(body);
}

function serveStatic(dir, req, res) {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = normalize(join(dir, path));
  if (!file.startsWith(dir)) return res.writeHead(403).end();
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(dir, 'index.html'); // SPA
  const ext = extname(file);
  // El HTML y el service worker se revalidan siempre; los assets con hash se cachean un año.
  const immutable = file.includes('/assets/');
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}

for (const site of SITES) {
  http
    .createServer((req, res) => {
      if (/^\/(api\/|health|ready)/.test(req.url ?? '')) {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => proxy(req, res, Buffer.concat(chunks)));
        return;
      }
      serveStatic(site.dir, req, res);
    })
    .listen(site.port, () => console.log(`gateway :${site.port} -> ${site.dir}`));
}
