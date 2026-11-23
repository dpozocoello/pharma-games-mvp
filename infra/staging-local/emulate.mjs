// Emulación de uso sobre el staging local (infra/staging-local/start.sh), con dispositivos reales
// emulados por Playwright: un dependiente en un Pixel 5, el gerente de su farmacia, un bot que hace
// trampa, el administrador de país en escritorio y pruebas de resiliencia (caída de WhatsApp, de una
// réplica de la API y de la red). Guarda capturas y un resumen en OUT_DIR.
// Uso: node infra/staging-local/emulate.mjs [OUT_DIR]
import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { chromium, devices } from '@playwright/test';

const OUT = resolve(process.argv[2] ?? join(import.meta.dirname, '.run/emulacion'));
const PWA = 'http://localhost:8080';
const ADMIN = 'http://localhost:8081';
const INBOX = 'http://localhost:4010';
const RUN = join(import.meta.dirname, '.run');
mkdirSync(OUT, { recursive: true });

const steps = [];
let shot = 0;
let currentPage = null;
async function step(title, fn, pageForFailure) {
  const t0 = Date.now();
  currentPage = pageForFailure ?? currentPage;
  try {
    const detail = await fn();
    steps.push({ title, ok: true, ms: Date.now() - t0, ...(detail ? { detail } : {}) });
    console.log(
      `✓ ${title}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`,
    );
  } catch (e) {
    steps.push({
      title,
      ok: false,
      ms: Date.now() - t0,
      error: String(e?.message ?? e).split('\n')[0],
    });
    await currentPage
      ?.screenshot({ path: join(OUT, `error-${steps.length}.png`), fullPage: true })
      .catch(() => undefined);
    console.log(`✗ ${title}: ${String(e?.message ?? e).split('\n')[0]}`);
  }
}
async function capture(page, name, caption, opts = {}) {
  const file = `${String(++shot).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: join(OUT, file), ...opts });
  (captures ??= []).push({ file, caption });
}
let captures;

/** Último código recibido por un número en la bandeja de WhatsApp/SMS simulada (distinto del previo). */
async function otpFor(phone, previous) {
  for (let i = 0; i < 50; i++) {
    const m = await (await fetch(`${INBOX}/__inbox?to=${encodeURIComponent(phone)}`)).json();
    if (m?.code && m.at !== previous?.at) return m;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No llegó el OTP a ${phone}`);
}
const inboxOf = async (phone) =>
  (await fetch(`${INBOX}/__inbox?to=${encodeURIComponent(phone)}`)).json();

const browser = await chromium.launch();

// ─────────────────────────── 1. Dependiente en un Pixel 5 ───────────────────────────
const clerkPhone = '+51900000004';
const phoneCtx = await browser.newContext({ ...devices['Pixel 5'], locale: 'es-PE' });
const page = await phoneCtx.newPage();

await step('Entrada única: el dependiente abre el enlace y elige su país', async () => {
  await page.goto(PWA);
  await page.getByRole('button', { name: 'Perú' }).waitFor();
  await capture(page, 'pais', 'Un mismo enlace para los tres países: la persona elige el suyo.');
  await page.getByRole('button', { name: 'Perú' }).click();
});

await step('Ingreso con celular y código por WhatsApp', async () => {
  await page.getByLabel(/Número de celular/i).fill(clerkPhone.slice(3));
  await capture(page, 'ingreso', 'Ingreso con el celular (o el documento).');
  const before = await inboxOf(clerkPhone);
  await page.getByRole('button', { name: /Recibir código/i }).click();
  const msg = await otpFor(clerkPhone, before);
  await page.getByLabel(/Código de 6 dígitos/i).fill(msg.code);
  await capture(
    page,
    'otp',
    `Código de 6 dígitos recibido por ${msg.channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}.`,
  );
  await page.getByRole('button', { name: /Ingresar/i }).click();
  return `canal ${msg.channel}`;
});

await step('Consentimiento de datos versionado por país', async () => {
  const consent = page.getByRole('button', { name: /Acepto y continuar/i });
  const home = page.getByText(/Perú \(PE\) — fijado a tu cuenta/i);
  await consent.or(home).waitFor();
  if (await consent.isVisible()) {
    await capture(
      page,
      'consentimiento',
      'Consentimiento obligatorio antes de jugar (Ley 29733, Perú).',
    );
    await consent.click();
  }
  await home.waitFor();
});

await step('Catálogo de juegos con marcas pendientes', async () => {
  await page
    .getByRole('button', { name: /^Jugar / })
    .first()
    .waitFor();
  await capture(
    page,
    'catalogo',
    'País fijado a la cuenta, marcas pendientes y juegos tematizados por marca.',
    {
      fullPage: true,
    },
  );
  return `${await page.getByRole('button', { name: /^Jugar / }).count()} juegos disponibles`;
});

const ANSWER = 'button[data-option-id], button[data-tf-id]';
await step('Partida con corte de red a mitad del juego', async () => {
  await page
    .getByRole('button', { name: /^Jugar / })
    .first()
    .click();
  await page.locator(ANSWER).first().waitFor();
  await capture(
    page,
    'pregunta',
    'Pregunta de la partida. El celular nunca recibe la respuesta correcta.',
  );
  // Responde 3 preguntas con red.
  // Ritmo de una persona: lee la pregunta ~2,5 s antes de responder.
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(2500);
    await page.locator(ANSWER).first().click();
  }
  // Se corta la red: la partida sigue y las respuestas quedan en el celular.
  await phoneCtx.setOffline(true);
  await page.waitForTimeout(300);
  await capture(
    page,
    'sin-red',
    'Se cortó la red a mitad de la partida: se puede seguir respondiendo.',
  );
  const result = page.getByText(/Respuestas correctas:|Aciertos:/);
  let answeredOffline = 0;
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(2500);
    await page.locator(ANSWER).first().click();
    answeredOffline += 1;
  }
  // Vuelve la red y se termina la partida: el SDK envía lo pendiente y el servidor puntúa.
  await phoneCtx.setOffline(false);
  while (!(await result.isVisible())) {
    await page.waitForTimeout(2500);
    const btn = page.locator(`${ANSWER}, #retry-finish`).first();
    if (await btn.isVisible().catch(() => false)) await btn.click();
  }
  await capture(page, 'resultado', 'Resultado calculado por el servidor al volver la red.');
  return `${answeredOffline} respuestas sin red; ${(await result.textContent())?.trim()}`;
});

await step(
  'Rankings del periodo (individual y farmacia)',
  async () => {
    await page
      .getByRole('button', { name: /Volver al catálogo/i })
      .click()
      .catch(() => undefined);
    await page.getByRole('button', { name: /^Rankings$/ }).click();
    const rankings = page.getByRole('region', { name: /Rankings del periodo/i });
    await rankings
      .locator('li')
      .or(rankings.getByText(/Aún no hay puntos/))
      .first()
      .waitFor();
    await capture(page, 'ranking-individual', 'Ranking individual en vivo (top y "tu posición").', {
      fullPage: true,
    });
    const individualRows = await rankings.locator('li').count();
    await page.getByRole('button', { name: /\(Prom\.\)/ }).click();
    await rankings
      .locator('li')
      .or(rankings.getByText(/Aún no hay puntos/))
      .first()
      .waitFor();
    await page.waitForTimeout(300);
    await capture(
      page,
      'ranking-farmacia',
      'Ranking de farmacias: promedio por dependiente activo, no suma.',
      {
        fullPage: true,
      },
    );
    return `${individualRows} filas individuales, ${await rankings.locator('li').count()} farmacias`;
  },
  page,
);

await step('Perfil: puntaje, posiciones, partidas y marcas pendientes', async () => {
  await page.getByRole('button', { name: /Mi Perfil/i }).click();
  await page.getByRole('region', { name: /Perfil del dependiente/i }).waitFor();
  await capture(page, 'perfil', 'Perfil del dependiente.', { fullPage: true });
});

await step('Test inicial de conocimiento de una marca', async () => {
  await page.getByRole('button', { name: /^Juegos$/ }).click();
  const start = page.getByRole('button', { name: /Realizar test inicial/i }).first();
  await start.waitFor({ timeout: 5000 });
  await start.click();
  const groups = page.locator('fieldset');
  await groups.first().waitFor();
  for (let i = 0; i < (await groups.count()); i++)
    await groups.nth(i).locator('input[type=radio]').first().check();
  await capture(
    page,
    'test-inicial',
    'Test inicial por marca (mide el conocimiento antes de jugar).',
    { fullPage: true },
  );
  await page.getByRole('button', { name: /Enviar test inicial/i }).click();
  await page.getByText(/Test inicial de .* completado/i).waitFor();
});

await step('La app instalada abre sin conexión', async () => {
  const ctx = await browser.newContext({ ...devices['Pixel 5'], serviceWorkers: 'allow' });
  const p = await ctx.newPage();
  await p.goto(PWA);
  await p.evaluate(async () => navigator.serviceWorker.ready);
  await p.reload();
  await ctx.setOffline(true);
  await p.reload();
  await p.getByText(/Sin conexión/i).waitFor();
  await capture(p, 'offline', 'Sin red: la app abre desde el service worker y lo avisa.');
  await ctx.close();
});

// ─────────────────────────── 2. Un bot que hace trampa (por la API) ───────────────────────────
await step('Bot que responde en ráfaga mintiendo sobre el tiempo', async () => {
  // Inicia sesión como otro dependiente por la API, igual que lo haría un script.
  const phone = '+51900000009';
  const before = await inboxOf(phone);
  await fetch(`${PWA}/api/v1/auth/otp/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      app: 'pwa',
      countryCode: 'PE',
      identifier: { type: 'phone', value: phone },
    }),
  });
  const { code } = await otpFor(phone, before);
  const login = await (
    await fetch(`${PWA}/api/v1/auth/otp/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        app: 'pwa',
        countryCode: 'PE',
        identifier: { type: 'phone', value: phone },
        code,
      }),
    })
  ).json();
  const auth = { authorization: `Bearer ${login.accessToken}`, 'content-type': 'application/json' };
  if (login.me.consent.required && !login.me.consent.accepted) {
    await fetch(`${PWA}/api/v1/me/consent`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ consentVersionId: login.me.consent.current.id }),
    });
  }
  const cat = await (await fetch(`${PWA}/api/v1/games`, { headers: auth })).json();
  const game = cat.games.find(
    (g) => g.mechanic === 'TRUE_FALSE' && g.sessionsToday < g.maxSessionsPerDay,
  );
  const s = await (
    await fetch(`${PWA}/api/v1/games/${game.id}/sessions`, { method: 'POST', headers: auth })
  ).json();
  for (const q of s.questions) {
    await fetch(`${PWA}/api/v1/sessions/${s.session.id}/answers`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        token: s.session.token,
        answers: [{ questionId: q.id, answer: q.options[0].id, clientElapsedMs: 5000 }],
      }),
    });
  }
  const fin = await (
    await fetch(`${PWA}/api/v1/sessions/${s.session.id}/finish`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ token: s.session.token }),
    })
  ).json();
  return `${fin.correct}/${fin.total} correctas, ${fin.score} pts acreditados en revisión`;
});

// ─────────────────────────── 3. Gerente de farmacia ───────────────────────────
async function pwaLogin(ctxPage, phone) {
  await ctxPage.goto(PWA);
  await ctxPage.getByRole('button', { name: 'Perú' }).click();
  await ctxPage.getByLabel(/Número de celular/i).fill(phone.slice(3));
  const before = await inboxOf(phone);
  await ctxPage.getByRole('button', { name: /Recibir código/i }).click();
  await ctxPage.getByLabel(/Código de 6 dígitos/i).fill((await otpFor(phone, before)).code);
  await ctxPage.getByRole('button', { name: /Ingresar/i }).click();
  const consent = ctxPage.getByRole('button', { name: /Acepto y continuar/i });
  const home = ctxPage.getByText(/Perú \(PE\) — fijado a tu cuenta/i);
  await consent.or(home).waitFor();
  if (await consent.isVisible()) await consent.click();
  await home.waitFor();
}

await step('Panel del gerente de farmacia (solo lectura)', async () => {
  const ctx = await browser.newContext({ ...devices['Pixel 5'] });
  const p = await ctx.newPage();
  await pwaLogin(p, '+51900000093');
  await p.getByRole('button', { name: /Gerente|Mi Farmacia|Equipo/i }).click();
  await p.getByRole('region', { name: /Panel del gerente/i }).waitFor();
  await p.waitForTimeout(500);
  await capture(
    p,
    'gerente',
    'Gerente: % de participación, quién no ha entrado y posición de su farmacia.',
    {
      fullPage: true,
    },
  );
  await ctx.close();
});

// ─────────────────────────── 4. Administrador de país (escritorio) ───────────────────────────
const adminCtx = await browser.newContext({
  viewport: { width: 1366, height: 900 },
  acceptDownloads: true,
});
const admin = await adminCtx.newPage();
await step('Administrador de Perú entra al panel con OTP', async () => {
  const phone = '+51900000091';
  await admin.goto(ADMIN);
  await admin.getByLabel(/Celular con prefijo internacional/i).fill(phone);
  const before = await inboxOf(phone);
  await admin.getByRole('button', { name: /Solicitar código OTP/i }).click();
  await admin.getByLabel(/Código de 6 dígitos/i).fill((await otpFor(phone, before)).code);
  await admin.getByRole('button', { name: /Entrar al panel/i }).click();
  await admin.getByRole('complementary', { name: /Países en tu alcance/i }).waitFor();
  await admin.waitForTimeout(800);
  await capture(
    admin,
    'admin-config',
    'Admin de Perú: solo ve Perú; reglas de puntos y periodo se cambian sin desplegar.',
  );
});

await step(
  'Alertas de juego justo: el bot quedó en revisión',
  async () => {
    await admin.getByRole('button', { name: /^Anomalías/ }).click();
    await admin.getByRole('heading', { name: /Alertas de Anomalías/i }).waitFor();
    await admin.waitForLoadState('networkidle');
    await capture(
      admin,
      'admin-anomalias',
      'Alertas abiertas: los puntos no cuentan para ganadores hasta resolverlas.',
    );
    const confirm = admin.getByRole('button', { name: /Confirmar y Anular/i }).first();
    const n = await admin.getByRole('button', { name: /Confirmar y Anular/i }).count();
    if (n > 0) {
      await confirm.click();
      await admin.waitForTimeout(800);
    }
    if (n > 0)
      await capture(
        admin,
        'admin-anomalia-confirmada',
        'Alerta confirmada: se anula con un movimiento inverso auditado.',
      );
    return `${n} alertas abiertas; se confirmó una (anulación auditada en el libro)`;
  },
  admin,
);

await step(
  'Reporte de participación en CSV',
  async () => {
    await admin.getByRole('button', { name: /Configuración de País/i }).click();
    const btn = admin.getByRole('button', { name: /Exportar reporte de participación/i });
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await admin.getByText(/Reporte de participación .* exportado/i).waitFor();
    const csv = (await admin.locator('pre').last().textContent()) ?? '';
    writeFileSync(join(OUT, 'participacion.csv'), csv);
    await admin.locator('pre').last().scrollIntoViewIfNeeded();
    await capture(
      admin,
      'admin-participacion',
      'Reporte de participación por país, farmacia y marca (CSV).',
    );
    return `${csv.trim().split('\n').length - 1} filas`;
  },
  admin,
);

await step(
  'Cierre de periodo: se rechaza mientras el periodo sigue en curso',
  async () => {
    const btn = admin.getByRole('button', { name: /Cerrar periodo y exportar ganadores/i });
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    const msg = admin.getByText(/se puede cerrar desde ese momento/i);
    await msg.waitFor();
    await msg.scrollIntoViewIfNeeded();
    await capture(
      admin,
      'admin-cierre',
      'El periodo no se puede cerrar antes de terminar (ADR-031).',
    );
    return (await msg.textContent())?.trim();
  },
  admin,
);

// ─────────────────────────── 5. Resiliencia ───────────────────────────
await step('WhatsApp caído: el código llega por SMS', async () => {
  await fetch(`${INBOX}/__whatsapp/down`, { method: 'POST' });
  const phone = '+51900000010';
  const before = await inboxOf(phone);
  await fetch(`${PWA}/api/v1/auth/otp/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      app: 'pwa',
      countryCode: 'PE',
      identifier: { type: 'phone', value: phone },
    }),
  });
  const msg = await otpFor(phone, before);
  await fetch(`${INBOX}/__whatsapp/up`, { method: 'POST' });
  if (msg.channel !== 'sms') throw new Error(`llegó por ${msg.channel}`);
  return 'respaldo SMS automático';
});

await step(
  'Se cae una réplica de la API: el servicio sigue',
  async () => {
    const pid = execSync(`cat "${RUN}/api-2.pid"`).toString().trim();
    execSync(`kill ${pid}`);
    try {
      await new Promise((r) => setTimeout(r, 500));
      const codes = [];
      for (let i = 0; i < 20; i++) codes.push((await fetch(`${PWA}/api/v1/countries`)).status);
      // La persona sigue usando la app sin notarlo.
      await page.getByRole('button', { name: /Mi Perfil/i }).click();
      await page.getByRole('region', { name: /Perfil del dependiente/i }).waitFor();
      const ok = codes.filter((c) => c === 200).length;
      if (ok !== codes.length) throw new Error(`${ok}/${codes.length} respuestas 200`);
      return `${ok}/${codes.length} solicitudes OK con una réplica caída`;
    } finally {
      // Vuelve a levantar la réplica (como lo haría el orquestador).
      execSync(`"${join(import.meta.dirname, 'replica.sh')}" 2 3002 false`);
    }
  },
  page,
);

await browser.close();
writeFileSync(join(OUT, 'resumen.json'), JSON.stringify({ steps, captures }, null, 2));
const failed = steps.filter((s) => !s.ok).length;
console.log(`\n${steps.length - failed}/${steps.length} pasos OK · capturas en ${OUT}`);
process.exit(failed ? 1 : 0);
