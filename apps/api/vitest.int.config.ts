import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Integración contra PostgreSQL y Redis reales (base `pharma_test`, Redis db 1).
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/integration/**/*.int.test.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    environment: 'node',
    // Los archivos comparten base de datos y Redis: se ejecutan en serie.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
