import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const shared = fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url));
const gameSdk = fileURLToPath(new URL('../../packages/game-sdk/src/index.ts', import.meta.url));
const gameTrivia = fileURLToPath(
  new URL('../../packages/game-trivia/src/index.ts', import.meta.url),
);
const gameTrueFalse = fileURLToPath(
  new URL('../../packages/game-true-false/src/index.ts', import.meta.url),
);

export default defineConfig({
  plugins: [react()],
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
