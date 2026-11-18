import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const shared = fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Se usa el código fuente de @pharma/shared (ESM) para permitir tree-shaking.
  resolve: { alias: { '@pharma/shared': shared } },
  server: {
    proxy: { '/api': 'http://localhost:3000' },
    port: 5174,
  },
  build: {
    target: 'es2019',
    sourcemap: true,
  },
});
