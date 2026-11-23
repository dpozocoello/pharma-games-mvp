import { expect, test } from '@playwright/test';

/**
 * PWA sin conexión (CLAUDE.md §11, ADR-030): una vez instalada, la app abre sin red y lo dice;
 * los datos de la API nunca salen de una caché.
 */
test.use({ serviceWorkers: 'allow' });
// Playwright solo controla service workers de forma fiable en Chromium. En iPhone/Safari se
// verifica a mano (docs/operacion.md).
test.skip(({ browserName }) => browserName !== 'chromium', 'Service workers: solo Chromium');

test('con la app ya instalada, abre sin conexión y avisa', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Juega y aprende/i })).toBeVisible();

  // Espera a que el service worker controle la página (precarga lista).
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByRole('heading', { name: /Juega y aprende/i })).toBeVisible();
  await expect(page.getByText(/Sin conexión/i)).toBeVisible();

  // La API no se cachea: sin red, falla (no devuelve datos viejos).
  const apiOk = await page.evaluate(() =>
    fetch('/api/v1/countries')
      .then((r) => r.ok)
      .catch(() => false),
  );
  expect(apiOk).toBe(false);

  await context.setOffline(false);
});

test('los juegos quedan precargados para jugar con red irregular', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys()) urls.push(req.url);
    }
    return urls;
  });
  // Workbox guarda la URL con `?__WB_REVISION__=…`: se compara la ruta.
  const paths = cached.map((u) => new URL(u).pathname);
  expect(paths).toContain('/index.html');
  // Los dos moldes de juego (chunks dinámicos) además del bundle inicial.
  expect(paths.filter((p) => /^\/assets\/.+\.js$/.test(p)).length).toBeGreaterThanOrEqual(3);
  expect(cached.some((u) => u.includes('/api/'))).toBe(false);
});
