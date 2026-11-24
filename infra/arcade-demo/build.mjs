// Empaqueta la demo arcade en un solo HTML: node infra/arcade-demo/build.mjs <salida.html>
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
// esbuild llega como dependencia de Vite (sin agregar dependencias nuevas al repositorio).
const viteEntry = createRequire(resolve(root, 'apps/pwa/package.json')).resolve('vite');
const { build } = createRequire(viteEntry)('esbuild');
const pkg = (n) => resolve(root, `packages/${n}/src/index.ts`);
const out = await build({
  entryPoints: [resolve(here, 'demo.ts')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2019',
  write: false,
  alias: Object.fromEntries(
    ['shared', 'game-sdk', 'game-arcade-kit', 'game-platform', 'game-launch', 'game-trivia'].map(
      (n) => [`@pharma/${n}`, pkg(n)],
    ),
  ),
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync(resolve(here, 'template.html'), 'utf8').replace('/*BUNDLE*/', () => js);
const dest = process.argv[2] ?? resolve(here, 'dist/index.html');
writeFileSync(dest, html);
console.log(`demo → ${dest} (${(js.length / 1024).toFixed(1)} KB JS)`);
