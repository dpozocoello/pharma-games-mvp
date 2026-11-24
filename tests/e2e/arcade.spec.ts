import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_ARCADE_RULES } from '../../packages/shared/src/arcade';

/**
 * Piloto arcade (ADR-034), Pixel 5 e iPhone 12: con el piloto encendido desde la configuración
 * del país, el dependiente juega un estilo arcade, la respuesta correcta nunca viaja en la red, la
 * partida termina y los controles táctiles miden ≥ 44 px.
 */
const API_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';
const ADMIN_PHONE = '+51900000091';

async function devOtp(phone: string, previous: string | null = null): Promise<string> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const res = await fetch(`${API_URL}/api/v1/dev/outbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    const code = res.ok ? ((await res.json()) as { code: string | null }).code : null;
    if (code && code !== previous) return code;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No llegó código OTP para ${phone}`);
}

async function currentOtp(phone: string): Promise<string | null> {
  const res = await fetch(`${API_URL}/api/v1/dev/outbox`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  });
  return res.ok ? ((await res.json()) as { code: string | null }).code : null;
}

/**
 * Sesión del admin reutilizada entre ejecuciones con su cookie de renovación (rota en cada uso):
 * así la prueba no gasta los 3 envíos de OTP cada 15 minutos que permite el servidor.
 */
// Fuera de test-results: Playwright vacía esa carpeta al empezar cada ejecución.
const SESSION_FILE = join(tmpdir(), 'pharma-e2e-admin-session');

async function refreshAdmin(cookie: string): Promise<string | null> {
  const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ app: 'admin' }),
  });
  if (!res.ok) return null;
  saveCookie(res);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

function saveCookie(res: Response) {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith('pharma_rt_admin='));
  if (!raw) return;
  writeFileSync(SESSION_FILE, raw.split(';')[0]!);
}

async function adminToken(): Promise<string> {
  if (existsSync(SESSION_FILE)) {
    const token = await refreshAdmin(readFileSync(SESSION_FILE, 'utf8'));
    if (token) return token;
  }
  const identifier = { type: 'phone', value: ADMIN_PHONE };
  const previous = await currentOtp(ADMIN_PHONE);
  await fetch(`${API_URL}/api/v1/auth/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app: 'admin', identifier }),
  });
  const code = await devOtp(ADMIN_PHONE, previous);
  const res = await fetch(`${API_URL}/api/v1/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app: 'admin', identifier, code }),
  });
  saveCookie(res);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

/** Enciende o apaga el piloto en PE como lo haría el panel (sin desplegar). */
async function setPilot(enabled: boolean) {
  const token = await adminToken();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const cfg = await (
    await fetch(`${API_URL}/api/v1/admin/countries/PE/config`, { headers: auth })
  ).json();
  const arcade = {
    ...DEFAULT_ARCADE_RULES,
    ...(cfg.pointsRules.arcade ?? {}),
    enabled,
    // Todas las farmacias al grupo arcade para que la prueba no dependa del sorteo.
    abTest: {
      ...DEFAULT_ARCADE_RULES.abTest,
      ...(cfg.pointsRules.arcade?.abTest ?? {}),
      arcadeSharePct: enabled ? 100 : 50,
    },
  };
  const res = await fetch(`${API_URL}/api/v1/admin/countries/PE/config`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({
      terms: cfg.terms,
      rankingPeriodMonths: cfg.rankingPeriodMonths,
      pointsRules: { ...cfg.pointsRules, arcade },
    }),
  });
  expect(res.status).toBe(200);
}

async function login(page: Page, localPhone: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Perú' }).click();
  await page.getByLabel(/Número de celular/i).fill(localPhone);
  const previous = await currentOtp(`+51${localPhone}`);
  await page.getByRole('button', { name: /Recibir código/i }).click();
  await page.getByLabel(/Código de 6 dígitos/i).fill(await devOtp(`+51${localPhone}`, previous));
  await page.getByRole('button', { name: /Ingresar/i }).click();
  const consent = page.getByRole('button', { name: /Acepto y continuar/i });
  const home = page.getByText(/Perú \(PE\) — fijado a tu cuenta/i);
  await expect(consent.or(home)).toBeVisible();
  if (await consent.isVisible()) await consent.click();
  await expect(home).toBeVisible();
}

test.beforeAll(async () => {
  await setPilot(true);
});
test.afterAll(async () => {
  await setPilot(false);
});

test('juega una partida arcade completa sin que la respuesta correcta viaje', async ({
  page,
}, testInfo) => {
  const pixel = testInfo.project.name === 'Pixel 5';
  const bodies: string[] = [];
  page.on('response', async (r) => {
    if (r.url().includes('/api/v1/') && (r.headers()['content-type'] ?? '').includes('json')) {
      bodies.push(await r.text().catch(() => ''));
    }
  });

  await login(page, pixel ? '900000010' : '900000011');

  // El servidor solo ofrece estilos arcade a este grupo.
  const chooser = page.getByRole('group', { name: 'Estilo de juego' });
  await expect(chooser).toBeVisible();
  await expect(chooser.getByText('Clásico')).toHaveCount(0);
  await chooser.getByText(pixel ? 'Plataformas' : 'Lanzamiento').click();

  const started = page.waitForResponse((r) => /\/games\/[^/]+\/sessions$/.test(r.url()));
  await page
    .getByRole('button', { name: /^Jugar / })
    .first()
    .click();
  const session = await (await started).json();
  expect(session.game.style).toBe(pixel ? 'PLATFORM' : 'LAUNCH');
  expect(session.limits.secondsPerQuestion).toBe(30);

  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  const title = pixel ? /Ruta del Mostrador/ : /Tiro de Muestras/;
  await expect(page.getByText(title).first()).toBeVisible();

  if (pixel) {
    // Plataformas real: moverse y saltar selecciona una caja; los controles miden ≥ 44 px.
    for (const name of ['Mover a la derecha', 'Saltar']) {
      const box = await page.getByRole('button', { name }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    const right = page.getByRole('button', { name: 'Mover a la derecha' });
    await right.dispatchEvent('pointerdown');
    await page.waitForTimeout(250);
    await right.dispatchEvent('pointerup');
    const jump = page.getByRole('button', { name: 'Saltar' });
    await jump.dispatchEvent('pointerdown');
    await page.waitForTimeout(100);
    await jump.dispatchEvent('pointerup');
  } else {
    // Lanzamiento real: arrastrar la honda hacia atrás y soltar (con el lienzo en pantalla).
    await canvas.scrollIntoViewIfNeeded();
    const c = (await canvas.boundingBox())!;
    const ax = c.x + (66 / 360) * c.width;
    const ay = c.y + (280 / 400) * c.height;
    await page.mouse.move(ax, ay);
    await page.mouse.down();
    await page.mouse.move(ax - (62 / 360) * c.width, ay + (52 / 400) * c.height, { steps: 6 });
    await page.mouse.up();
  }
  const confirm = page.getByRole('button', { name: 'Confirmar' });
  await expect(confirm).toBeVisible({ timeout: 5000 });
  expect((await confirm.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await confirm.click();

  // El resto con el modo simple (accesibilidad): tocar la opción y confirmar.
  await page.getByRole('button', { name: 'Modo simple' }).click();
  const result = page.getByText(/Respuestas correctas:/);
  for (let i = 0; i < 20 && !(await result.isVisible()); i++) {
    const option = page.locator('button[data-option]').first();
    if (await option.isVisible().catch(() => false)) {
      await option.click();
      if (await confirm.isVisible().catch(() => false)) await confirm.click();
    }
    await page.waitForTimeout(300);
  }
  await expect(result).toBeVisible();

  // Ninguna respuesta de la API incluyó la respuesta correcta.
  expect(bodies.length).toBeGreaterThan(3);
  for (const b of bodies) expect(b).not.toMatch(/correctAnswer/);
});
