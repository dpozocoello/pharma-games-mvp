import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const shared = fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url));
const gameSdk = fileURLToPath(new URL('../../packages/game-sdk/src/index.ts', import.meta.url));
const gameTrivia = fileURLToPath(
  new URL('../../packages/game-trivia/src/index.ts', import.meta.url),
);
const gameTrueFalse = fileURLToPath(
  new URL('../../packages/game-true-false/src/index.ts', import.meta.url),
);

export default defineConfig({
  plugins: [
    react(),
    // Service worker (ADR-030): precarga la app y los juegos para abrir sin red. La API nunca se
    // cachea (los puntajes y respuestas son siempre del servidor). `prompt`: una versión nueva solo
    // se activa cuando la persona lo acepta, nunca a mitad de una partida.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: false, // se usa public/manifest.webmanifest
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,webmanifest}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/health/, /^\/ready/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [],
      },
    }),
  ],
  resolve: {
    alias: {
      '@pharma/shared': shared,
      '@pharma/game-sdk': gameSdk,
      '@pharma/game-trivia': gameTrivia,
      '@pharma/game-true-false': gameTrueFalse,
    },
  },
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: {
    target: 'es2019',
    sourcemap: true,
  },
});
