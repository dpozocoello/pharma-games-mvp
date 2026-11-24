// Presupuesto de peso (CLAUDE.md §4.6), se ejecuta después de `pnpm build`:
// - JS inicial de la PWA (lo que carga index.html, sin los juegos dinámicos) <= 300 KB gzip;
// - cada juego, con sus recursos, <= 1,5 MB.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PWA_INITIAL_JS_GZIP_KB = 300;
const GAME_MAX_KB = 1536;
const errors = [];

const pwaDist = join(root, 'apps/pwa/dist');
const indexHtml = join(pwaDist, 'index.html');
if (!existsSync(indexHtml)) {
  console.error('No existe apps/pwa/dist/index.html: ejecuta `pnpm build` antes de `pnpm size`.');
  process.exit(1);
}

// JS inicial: <script src> y <link rel="modulepreload"> de index.html.
const html = readFileSync(indexHtml, 'utf8');
const initial = new Set();
for (const m of html.matchAll(
  /<(?:script[^>]*\ssrc|link[^>]*rel="modulepreload"[^>]*\shref)="([^"]+\.js)"/g,
)) {
  initial.add(m[1].replace(/^\//, ''));
}
if (initial.size === 0) errors.push('index.html no referencia ningún JS: revisa el build.');
let initialGzip = 0;
for (const rel of initial) {
  const kb = gzipSync(readFileSync(join(pwaDist, rel))).byteLength / 1024;
  initialGzip += kb;
  console.log(`  pwa inicial  ${rel}  ${kb.toFixed(1)} KB gzip`);
}
console.log(`PWA JS inicial: ${initialGzip.toFixed(1)} KB gzip (límite ${PWA_INITIAL_JS_GZIP_KB})`);
if (initialGzip > PWA_INITIAL_JS_GZIP_KB) {
  errors.push(`PWA: ${initialGzip.toFixed(1)} KB gzip supera ${PWA_INITIAL_JS_GZIP_KB} KB`);
}

// Cada juego: todo lo que publica su paquete (dist/), recursos incluidos.
const dirSize = (dir) =>
  readdirSync(dir).reduce((acc, name) => {
    const p = join(dir, name);
    const st = statSync(p);
    return acc + (st.isDirectory() ? dirSize(p) : name.endsWith('.map') ? 0 : st.size);
  }, 0);
for (const pkg of ['game-trivia', 'game-true-false', 'game-platform', 'game-launch']) {
  const dist = join(root, 'packages', pkg, 'dist');
  if (!existsSync(dist)) {
    errors.push(`${pkg}: falta dist/ (ejecuta pnpm build)`);
    continue;
  }
  const kb = dirSize(dist) / 1024;
  console.log(`${pkg}: ${kb.toFixed(1)} KB (límite ${GAME_MAX_KB})`);
  if (kb > GAME_MAX_KB) errors.push(`${pkg}: ${kb.toFixed(1)} KB supera ${GAME_MAX_KB} KB`);
}

if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`);
  process.exit(1);
}
console.log('✓ Presupuesto de peso cumplido');
