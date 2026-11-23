import { expect, test, type Page } from '@playwright/test';

/**
 * Sesión larga (CLAUDE.md §10): el token de acceso dura 15 minutos y la PWA lo renueva sola con la
 * cookie de 90 días. Para no esperar 15 minutos, la prueba simula el vencimiento devolviendo un 401.
 */
const API_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';

/** Código vigente en la bandeja de desarrollo (puede ser el de una ejecución anterior). */
async function currentDevOtp(phone: string): Promise<string | null> {
  const res = await fetch(`${API_URL}/api/v1/dev/outbox`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  });
  return res.ok ? ((await res.json()) as { code: string | null }).code : null;
}

/** Espera un código distinto de `previous` (el que había antes de pedir uno nuevo). */
async function peekDevOtp(phone: string, previous: string | null = null): Promise<string> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const res = await fetch(`${API_URL}/api/v1/dev/outbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    const data = (await res.json()) as { code: string | null };
    if (data.code && data.code !== previous) return data.code;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No llegó código OTP para ${phone}`);
}

async function login(page: Page, localPhone: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Perú' }).click();
  await page.getByLabel(/Número de celular/i).fill(localPhone);
  const previous = await currentDevOtp(`+51${localPhone}`);
  await page.getByRole('button', { name: /Recibir código/i }).click();
  await page
    .getByLabel(/Código de 6 dígitos/i)
    .fill(await peekDevOtp(`+51${localPhone}`, previous));
  await page.getByRole('button', { name: /Ingresar/i }).click();
  // `isVisible` no espera: se espera a que aparezca el consentimiento o la pantalla principal.
  const consent = page.getByRole('button', { name: /Acepto y continuar/i });
  const home = page.getByText(/Perú \(PE\) — fijado a tu cuenta/i);
  await expect(consent.or(home)).toBeVisible();
  if (await consent.isVisible()) await consent.click();
  await expect(home).toBeVisible();
}

const expired401 = {
  status: 401,
  contentType: 'application/problem+json',
  body: JSON.stringify({ type: 'about:blank', title: 'UNAUTHORIZED', status: 401 }),
};

test('un token vencido a mitad de partida se renueva solo y la partida termina', async ({
  page,
}, testInfo) => {
  // Un dependiente por dispositivo emulado: el tope de partidas diarias es por usuario.
  await login(page, testInfo.project.name === 'Pixel 5' ? '900000005' : '900000006');

  await page
    .getByRole('button', { name: /^Jugar / })
    .first()
    .click();
  await expect(page.locator('button[data-option-id]').first()).toBeVisible();

  // Desde aquí, el primer envío de respuestas "encuentra" el token vencido.
  let refreshes = 0;
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/auth/refresh')) refreshes += 1;
  });
  let expired = false;
  await page.route('**/api/v1/sessions/*/answers', async (route) => {
    if (!expired) {
      expired = true;
      return route.fulfill(expired401);
    }
    return route.continue();
  });

  // Responde todas las preguntas (la primera opción, da igual si es correcta).
  const result = page.getByText(/Respuestas correctas:/);
  while (!(await result.isVisible())) {
    const option = page.locator('button[data-option-id]').first();
    if (await option.isVisible().catch(() => false)) await option.click();
    await page.waitForTimeout(150);
  }

  await expect(result).toBeVisible();
  await expect(page.getByText(/Sin conexión para cerrar la partida/)).toHaveCount(0);
  expect(expired).toBe(true);
  expect(refreshes).toBe(1);
});

test('si la sesión de 90 días terminó, vuelve al ingreso con un aviso', async ({
  page,
}, testInfo) => {
  await login(page, testInfo.project.name === 'Pixel 5' ? '900000007' : '900000008');

  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/problem+json',
      body: JSON.stringify({ status: 401, code: 'REFRESH_INVALID' }),
    }),
  );
  await page.route('**/api/v1/rankings**', (route) => route.fulfill(expired401));

  await page
    .getByRole('button', { name: /Ranking/i })
    .first()
    .click();

  await expect(page.getByText(/Tu sesión terminó/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Recibir código/i })).toBeVisible();
});
