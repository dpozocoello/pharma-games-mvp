import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC emite la metadata de decoradores que NestJS necesita para la inyección de dependencias.
// Pruebas unitarias: sin base de datos ni Redis reales. Las de integración van en vitest.int.config.ts.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts', 'prisma/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['test/integration/**', 'node_modules/**'],
    environment: 'node',
  },
});
