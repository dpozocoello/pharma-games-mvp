// Graba los videos de entrega del MVP sobre el staging local (infra/staging-local/start.sh):
// para cada país (CO, EC, PE) y cada sección, más la gestión global. Cada video lleva portada,
// subtítulos de lo que pasa y un indicador de toques/clics. Salida: OUT_DIR/*.webm + manifest.json.
// Uso: node infra/staging-local/record-demo.mjs [OUT_DIR] [PE,CO,EC]
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, devices } from '@playwright/test';

const OUT = resolve(process.argv[2] ?? join(import.meta.dirname, '.run/videos'));
const ONLY = (process.argv[3] ?? 'PE,CO,EC').split(',');
const PWA = 'http://localhost:8080';
const ADMIN = 'http://localhost:8081';
const INBOX = 'http://localhost:4010';
mkdirSync(OUT, { recursive: true });

const COUNTRIES = {
  PE: { code: 'PE', name: 'Perú', prefix: '+51', term: 'botica', law: 'Ley 29733', flag: '🇵🇪' },
  CO: {
    code: 'CO',
    name: 'Colombia',
    prefix: '+57',
    term: 'droguería',
    law: 'Ley 1581',
    flag: '🇨🇴',
  },
  EC: { code: 'EC', name: 'Ecuador', prefix: '+593', term: 'farmacia', law: 'LOPDP', flag: '🇪🇨' },
};
/** Teléfonos ficticios de las semillas (apps/api/prisma/seed-data.ts → fakePhone). */
function phone(code, n) {
  const nn = String(n).padStart(2, '0');
  if (code === 'CO') return `+57300000${nn.padStart(4, '0')}`;
  if (code === 'EC') return `+5939000${nn.padStart(5, '0')}`;
  return `+519000${nn.padStart(5, '0')}`;
}
const local = (c, n) => phone(c.code, n).slice(c.prefix.length);

// ───────────────────────── Capa visual: portada, subtítulos y toques ─────────────────────────
const OVERLAY = () => {
  const css = `
  #demo-cap{position:fixed;left:12px;right:12px;bottom:14px;z-index:2147483646;pointer-events:none;
    background:rgba(15,23,42,.92);color:#f8fafc;font:600 15px/1.35 system-ui,sans-serif;padding:10px 14px;
    border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.25);transition:opacity .2s;opacity:0}
  #demo-cap.on{opacity:1} #demo-cap small{display:block;font-weight:500;color:#cbd5e1;font-size:12.5px;margin-bottom:2px;letter-spacing:.04em;text-transform:uppercase}
  #demo-title{position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;justify-content:center;gap:10px;
    padding:28px;background:#0f1f4d;color:#fff;font-family:system-ui,sans-serif;pointer-events:none}
  #demo-title b{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#93c5fd}
  #demo-title h1{margin:0;font-size:30px;line-height:1.15} #demo-title p{margin:0;font-size:16px;color:#dbeafe;max-width:34em}
  .demo-tap{position:fixed;z-index:2147483645;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;
    border:3px solid #facc15;background:rgba(250,204,21,.25);pointer-events:none;animation:demo-tap .6s ease-out forwards}
  @keyframes demo-tap{from{transform:scale(.4);opacity:1}to{transform:scale(1.4);opacity:0}}`;
  const boot = () => {
    if (document.getElementById('demo-style')) return;
    const st = document.createElement('style');
    st.id = 'demo-style';
    st.textContent = css;
    document.head.appendChild(st);
    const cap = document.createElement('div');
    cap.id = 'demo-cap';
    document.body.appendChild(cap);
    window.addEventListener(
      'pointerdown',
      (e) => {
        const d = document.createElement('div');
        d.className = 'demo-tap';
        d.style.left = `${e.clientX}px`;
        d.style.top = `${e.clientY}px`;
        document.body.appendChild(d);
        setTimeout(() => d.remove(), 700);
      },
      true,
    );
    const saved = sessionStorage.getItem('demo-cap');
    if (saved) window.__demoCaption(...JSON.parse(saved));
  };
  window.__demoCaption = (label, text) => {
    sessionStorage.setItem('demo-cap', JSON.stringify([label, text]));
    const cap = document.getElementById('demo-cap');
    if (!cap) return;
    cap.innerHTML = '';
    if (label) {
      const s = document.createElement('small');
      s.textContent = label;
      cap.appendChild(s);
    }
    cap.appendChild(document.createTextNode(text));
    cap.classList.toggle('on', Boolean(text));
  };
  window.__demoTitle = (eyebrow, title, sub) => {
    const t = document.createElement('div');
    t.id = 'demo-title';
    t.innerHTML = '<b></b><h1></h1><p></p>';
    t.querySelector('b').textContent = eyebrow;
    t.querySelector('h1').textContent = title;
    t.querySelector('p').textContent = sub;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function say(page, label, text, ms = 2600) {
  await page
    .evaluate(([l, t]) => window.__demoCaption?.(l, t), [label, text])
    .catch(() => undefined);
  await wait(ms);
}
async function titleCard(page, eyebrow, title, sub) {
  await page.evaluate(([e, t, s]) => window.__demoTitle?.(e, t, s), [eyebrow, title, sub]);
  await wait(3300);
}

// ───────────────────────── Grabación de un video ─────────────────────────
const browser = await chromium.launch({ slowMo: 120 });
const manifest = [];

/** IDS=PE-6-config,G-1-superadmin graba solo esos videos (para iterar el guion). */
const IDS = process.env.IDS ? process.env.IDS.split(',') : null;

async function video(meta, kind, fn) {
  if (IDS && !IDS.includes(meta.id)) return;
  const base = kind === 'phone' ? devices['Pixel 5'] : { viewport: { width: 1280, height: 760 } };
  const size = base.viewport;
  const ctx = await browser.newContext({
    ...base,
    locale: 'es',
    recordVideo: { dir: OUT, size },
  });
  await ctx.addInitScript(OVERLAY);
  const page = await ctx.newPage();
  const t0 = Date.now();
  let ok = true;
  let error;
  try {
    await fn(page, ctx);
    await wait(1200);
  } catch (e) {
    ok = false;
    error = String(e?.message ?? e).split('\n')[0];
    await say(page, '', '').catch(() => undefined);
  }
  const vid = page.video();
  await ctx.close();
  const file = `${meta.id}.webm`;
  renameSync(await vid.path(), join(OUT, file));
  manifest.push({ ...meta, kind, file, seconds: Math.round((Date.now() - t0) / 1000), ok, error });
  console.log(`${ok ? '✓' : '✗'} ${meta.id} ${meta.title}${error ? ` — ${error}` : ''}`);
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

// ───────────────────────── Ayudantes de flujo ─────────────────────────
async function inboxAt(e164) {
  return (await fetch(`${INBOX}/__inbox?to=${encodeURIComponent(e164)}`)).json();
}
async function otpFor(e164, before) {
  for (let i = 0; i < 60; i++) {
    const m = await inboxAt(e164);
    if (m?.code && m.at !== before?.at) return m;
    await wait(100);
  }
  throw new Error(`No llegó el OTP a ${e164}`);
}
async function pwaLogin(page, c, n, label) {
  const e164 = phone(c.code, n);
  await page.goto(PWA);
  await page.getByRole('button', { name: c.name, exact: true }).waitFor();
  await say(page, label, `Un solo enlace para los tres países. La persona elige ${c.name}.`);
  await page.getByRole('button', { name: c.name, exact: true }).click();
  await say(page, label, 'Ingresa con su celular (también puede usar su documento).', 1600);
  await page.getByLabel(/Número de celular/i).pressSequentially(local(c, n), { delay: 60 });
  const before = await inboxAt(e164);
  await page.getByRole('button', { name: /Recibir código/i }).click();
  const msg = await otpFor(e164, before);
  await say(
    page,
    label,
    `Recibe un código de 6 dígitos por ${msg.channel === 'sms' ? 'SMS' : 'WhatsApp'} (respaldo SMS automático).`,
  );
  await page.getByLabel(/Código de 6 dígitos/i).pressSequentially(msg.code, { delay: 90 });
  await page.getByRole('button', { name: /Ingresar/i }).click();
  const consent = page.getByRole('button', { name: /Acepto y continuar/i });
  const home = page.getByText(new RegExp(`${c.name} \\(${c.code}\\) — fijado a tu cuenta`));
  await consent.or(home).waitFor();
  if (await consent.isVisible()) {
    await say(
      page,
      label,
      `Antes de jugar acepta el consentimiento de datos de ${c.name} (${c.law}). Es versionado por país.`,
      3400,
    );
    await consent.click();
  }
  await home.waitFor();
}
async function adminLogin(page, c, n, label) {
  const e164 = phone(c.code, n);
  await page.goto(ADMIN);
  await page.getByLabel(/Celular con prefijo internacional/i).waitFor();
  await say(
    page,
    label,
    'El panel de administración es una aplicación aparte; también se ingresa con código OTP.',
    2200,
  );
  await page
    .getByLabel(/Celular con prefijo internacional/i)
    .pressSequentially(e164, { delay: 40 });
  const before = await inboxAt(e164);
  await page.getByRole('button', { name: /Solicitar código OTP/i }).click();
  const msg = await otpFor(e164, before);
  await page.getByLabel(/Código de 6 dígitos/i).pressSequentially(msg.code, { delay: 70 });
  await page.getByRole('button', { name: /Entrar al panel/i }).click();
  await page.getByRole('complementary', { name: /Países en tu alcance/i }).waitFor();
  await page.waitForLoadState('networkidle');
}
const ANSWER = 'button[data-option-id], button[data-tf-id]';
async function playGame(page, label, { mechanic, offline, ctx }) {
  const item = page.locator('li', { hasText: mechanic === 'MC' ? 'Trivia' : 'Verdadero / Falso' });
  const btn = item.getByRole('button', { name: /^Jugar / }).first();
  await btn.scrollIntoViewIfNeeded();
  await say(
    page,
    label,
    mechanic === 'MC'
      ? 'Elige una trivia de opción múltiple.'
      : 'Ahora un juego de verdadero o falso.',
    1600,
  );
  await btn.click();
  await page.locator(ANSWER).first().waitFor();
  await say(
    page,
    label,
    '10 preguntas de la marca, con su tema visual. El celular nunca recibe la respuesta correcta.',
    2600,
  );
  const result = page.getByText(/Respuestas correctas:|Aciertos:/);
  let i = 0;
  while (!(await result.isVisible())) {
    i += 1;
    if (offline && i === 4) {
      await ctx.setOffline(true);
      await say(
        page,
        label,
        'Se corta la red a mitad de la partida: puede seguir respondiendo, las respuestas se guardan en el celular.',
        2400,
      );
    }
    if (offline && i === 8) {
      await ctx.setOffline(false);
      await say(page, label, 'Vuelve la red: lo pendiente se envía solo.', 1200);
    }
    await wait(2300); // ritmo de una persona
    const b = page.locator(`${ANSWER}, #retry-finish`).first();
    if (await b.isVisible().catch(() => false)) await b.click();
  }
  await say(
    page,
    label,
    'El servidor calcula el puntaje (aciertos + bono de velocidad medido por el servidor) y respeta los topes diarios.',
    3600,
  );
}
async function bot(c) {
  const n = 9;
  const e164 = phone(c.code, n);
  const before = await inboxAt(e164);
  await fetch(`${PWA}/api/v1/auth/otp/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      app: 'pwa',
      countryCode: c.code,
      identifier: { type: 'phone', value: e164 },
    }),
  });
  const { code } = await otpFor(e164, before);
  const login = await (
    await fetch(`${PWA}/api/v1/auth/otp/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        app: 'pwa',
        countryCode: c.code,
        identifier: { type: 'phone', value: e164 },
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
  const game = cat.games[0];
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
  await fetch(`${PWA}/api/v1/sessions/${s.session.id}/finish`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ token: s.session.token }),
  });
}

// ───────────────────────── Videos por país ─────────────────────────
for (const code of ONLY) {
  const c = COUNTRIES[code];
  const eyebrow = `${c.name} · Juega y aprende`;
  let clerkState;

  await video(
    {
      id: `${code}-1-ingreso`,
      country: code,
      section: 'Dependiente',
      title: 'Entrada única, ingreso y consentimiento',
      summary: `Un dependiente de ${c.name} abre el enlace único, elige su país, ingresa con su celular y el código que le llega por WhatsApp, acepta el consentimiento (${c.law}) y queda con el país fijado a su cuenta.`,
      modules: ['1 Entrada única', '2 Ingreso y cuentas', '3 Términos locales'],
    },
    'phone',
    async (page, ctx) => {
      await page.goto(PWA);
      await titleCard(
        page,
        eyebrow,
        'Ingreso del dependiente',
        'Entrada única, código por WhatsApp y consentimiento por país.',
      );
      await pwaLogin(page, c, 4, 'Dependiente');
      await say(
        page,
        'Dependiente',
        `El país queda fijado a la cuenta: no puede puntuar en otro país. Su farmacia se llama "${c.term}" en ${c.name}.`,
        3600,
      );
      await page.getByRole('region', { name: /Juegos disponibles/i }).scrollIntoViewIfNeeded();
      await say(
        page,
        'Dependiente',
        `Ve solo los juegos de las marcas activas en ${c.name} y cuáles le faltan este periodo.`,
        3000,
      );
      await page.mouse.wheel(0, 500);
      await wait(1200);
      clerkState = await ctx.storageState();
    },
  );

  await video(
    {
      id: `${code}-2-trivia`,
      country: code,
      section: 'Dependiente',
      title: 'Partida de trivia con corte de red',
      summary:
        'Juega una trivia de 10 preguntas con el tema de la marca. A mitad de la partida se corta la red: sigue respondiendo y, al volver la conexión, la partida se cierra con el puntaje calculado por el servidor.',
      modules: ['7 Motor de juegos', 'B Trivia', '8 Juego justo'],
    },
    'phone',
    async (page, ctx) => {
      await ctx.addCookies(clerkState.cookies);
      await page.goto(PWA);
      await titleCard(page, eyebrow, 'Partida de trivia', 'Con un corte de red a mitad del juego.');
      await page.getByRole('region', { name: /Juegos disponibles/i }).waitFor();
      await playGame(page, 'Dependiente', { mechanic: 'MC', offline: true, ctx });
      // La sesión de 90 días rota en cada uso: el siguiente video sigue con la cookie nueva.
      clerkState = await ctx.storageState();
    },
  );

  await video(
    {
      id: `${code}-3-vf-test`,
      country: code,
      section: 'Dependiente',
      title: 'Verdadero/falso y test inicial de marca',
      summary:
        'Juega el segundo molde (verdadero o falso) y responde el test inicial de conocimiento de una marca, que mide lo que sabe antes de jugar.',
      modules: ['B Verdadero/falso', '12 Test inicial'],
    },
    'phone',
    async (page, ctx) => {
      await ctx.addCookies(clerkState.cookies);
      await page.goto(PWA);
      await titleCard(
        page,
        eyebrow,
        'Verdadero o falso y test inicial',
        'El segundo molde de juego y la medición de conocimiento.',
      );
      await page.getByRole('region', { name: /Juegos disponibles/i }).waitFor();
      await playGame(page, 'Dependiente', { mechanic: 'TF', offline: false, ctx });
      await page.getByRole('button', { name: /Volver al catálogo/i }).click();
      const start = page.getByRole('button', { name: /Realizar test inicial/i }).first();
      await start.scrollIntoViewIfNeeded();
      await say(
        page,
        'Dependiente',
        'Test inicial por marca: mide el conocimiento antes de jugar (el test final llega en la siguiente iteración).',
        3000,
      );
      await start.click();
      const groups = page.locator('fieldset');
      await groups.first().waitFor();
      for (let i = 0; i < (await groups.count()); i++) {
        await groups.nth(i).scrollIntoViewIfNeeded();
        await groups.nth(i).locator('input[type=radio]').first().check();
        await wait(500);
      }
      await page.getByRole('button', { name: /Enviar test inicial/i }).click();
      await page.getByText(/Test inicial de .* completado/i).waitFor();
      await page.getByText(/Test inicial de .* completado/i).scrollIntoViewIfNeeded();
      await say(
        page,
        'Dependiente',
        'El resultado queda registrado para comparar con el test final.',
        2600,
      );
      // La sesión de 90 días rota en cada uso: el siguiente video sigue con la cookie nueva.
      clerkState = await ctx.storageState();
    },
  );

  await video(
    {
      id: `${code}-4-ranking`,
      country: code,
      section: 'Dependiente',
      title: 'Rankings del periodo y perfil',
      summary: `Ranking individual, por ${c.term} (promedio por dependiente activo, no suma) y por país, en vivo. Perfil con puntaje, posiciones, partidas del periodo y marcas pendientes.`,
      modules: ['9 Rankings', '11 Perfil'],
    },
    'phone',
    async (page, ctx) => {
      await ctx.addCookies(clerkState.cookies);
      await page.goto(PWA);
      await titleCard(page, eyebrow, 'Rankings y perfil', 'Individual, por farmacia y por país.');
      await page.getByRole('button', { name: /^Rankings$/ }).click();
      const r = page.getByRole('region', { name: /Rankings del periodo/i });
      await r
        .locator('li')
        .or(r.getByText(/Aún no hay puntos/))
        .first()
        .waitFor();
      await r.scrollIntoViewIfNeeded();
      await say(page, 'Dependiente', 'Ranking individual del periodo, en vivo.', 2600);
      await page.getByRole('button', { name: /\(Prom\.\)/ }).click();
      await say(
        page,
        'Dependiente',
        `Ranking por ${c.term}: promedio de puntos por dependiente activo, para que una ${c.term} grande no gane solo por tamaño.`,
        3600,
      );
      await page.getByRole('button', { name: /^País$/ }).click();
      await say(page, 'Dependiente', 'Consolidado del país.', 2000);
      await page.getByRole('button', { name: /Mi Perfil/i }).click();
      await page.getByRole('region', { name: /Perfil del dependiente/i }).scrollIntoViewIfNeeded();
      await say(
        page,
        'Dependiente',
        'Perfil: puntaje, posición individual y de su farmacia, partidas jugadas y marcas pendientes.',
        3600,
      );
      await page.mouse.wheel(0, 600);
      await wait(1500);
      // La sesión de 90 días rota en cada uso: el siguiente video sigue con la cookie nueva.
      clerkState = await ctx.storageState();
    },
  );

  await video(
    {
      id: `${code}-5-gerente`,
      country: code,
      section: 'Gerente de farmacia',
      title: 'Panel del gerente de farmacia',
      summary: `El gerente de una ${c.term} ve en solo lectura el % de su equipo que participó, quién no ha entrado y la posición de su ${c.term}.`,
      modules: ['10 Panel del gerente'],
    },
    'phone',
    async (page) => {
      await page.goto(PWA);
      await titleCard(
        page,
        eyebrow,
        `Gerente de ${c.term}`,
        'Seguimiento de su equipo, en solo lectura.',
      );
      await pwaLogin(page, c, 93, 'Gerente');
      await page.getByRole('button', { name: /Mi Equipo/i }).click();
      await page.getByRole('region', { name: /Panel del gerente/i }).scrollIntoViewIfNeeded();
      await say(
        page,
        'Gerente',
        '% de participación de su equipo en el periodo y posición de su farmacia.',
        3200,
      );
      await page.mouse.wheel(0, 500);
      await say(
        page,
        'Gerente',
        'Quién no ha entrado o no ha jugado, para motivarlos en el punto de venta. Los teléfonos se ven enmascarados.',
        3600,
      );
    },
  );

  await video(
    {
      id: `${code}-6-config`,
      country: code,
      section: 'Administración del país',
      title: 'Configuración del país sin desplegar',
      summary: `El administrador de ${c.name} solo ve su país. Ajusta reglas de puntos, topes y periodo de ranking, revisa las marcas activas y el consentimiento vigente; los cambios aplican sin desplegar.`,
      modules: ['3 Administración de países', '5 Roles y alcance'],
    },
    'desk',
    async (page) => {
      await page.goto(ADMIN);
      await titleCard(
        page,
        eyebrow,
        'Configuración del país',
        'Reglas, periodo, marcas y consentimiento, sin desplegar.',
      );
      await adminLogin(page, c, 91, 'Administrador de país');
      await say(
        page,
        'Administrador de país',
        `Solo ve ${c.name}: el alcance por país lo aplica el servidor.`,
        2800,
      );
      const pts = page.getByLabel('Puntos por respuesta correcta');
      await pts.scrollIntoViewIfNeeded();
      await say(
        page,
        'Administrador de país',
        'Reglas de puntos, topes diarios y tiempos mínimos, por país.',
        2400,
      );
      await pts.fill('12');
      await page.getByRole('button', { name: /Guardar configuración/i }).click();
      await page
        .getByText(/sin desplegar/i)
        .first()
        .waitFor();
      await say(
        page,
        'Administrador de país',
        'Guardado: se aplica en todas las instancias al momento, sin desplegar. (Se vuelve a 10 al final.)',
        3000,
      );
      await page
        .getByRole('heading', { name: new RegExp(`Marcas en ${c.name}`) })
        .scrollIntoViewIfNeeded();
      await say(
        page,
        'Administrador de país',
        `Marcas activas en ${c.name}; se pueden activar o desactivar por país.`,
        3000,
      );
      await page
        .getByRole('heading', { name: /Periodo de Ranking Abierto/i })
        .scrollIntoViewIfNeeded();
      await say(
        page,
        'Administrador de país',
        'Periodo de ranking vigente (1, 2 o 3 meses) y reporte de participación.',
        2600,
      );
      await page.getByRole('heading', { name: /Consentimiento vigente/i }).scrollIntoViewIfNeeded();
      await say(
        page,
        'Administrador de país',
        'Consentimiento versionado: publicar una versión nueva obliga a todos a aceptarla otra vez.',
        3200,
      );
      await pts.scrollIntoViewIfNeeded();
      await pts.fill('10');
      await page.getByRole('button', { name: /Guardar configuración/i }).click();
      await wait(800);
    },
  );

  await video(
    {
      id: `${code}-7-usuarios`,
      country: code,
      section: 'Administración del país',
      title: 'Usuarios y farmacias: carga CSV, traslados y bajas',
      summary: `Carga masiva por CSV con reporte de errores por fila, alta de una ${c.term}, traslado de un dependiente (conserva puntos e historial) y baja/reactivación con cierre de sus sesiones.`,
      modules: ['4 Usuarios y farmacias'],
    },
    'desk',
    async (page) => {
      await page.goto(ADMIN);
      await titleCard(
        page,
        eyebrow,
        'Usuarios y farmacias',
        'Carga CSV, traslados y bajas con historial.',
      );
      await adminLogin(page, c, 91, 'Administrador de país');
      await page.getByRole('button', { name: /^Usuarios y Farmacias$/ }).click();
      await page.getByRole('heading', { name: /Carga masiva de usuarios/i }).waitFor();
      const ph1 = `${c.code}-FAR-001`;
      const csv = [
        'countryCode,pharmacyCode,pharmacyName,city,phone,document,displayName,role',
        `${c.code},${ph1},Farmacia Demo 1,Capital,${phone(c.code, 71)},${c.code}DEMO000071,Nuevo Dependiente Uno,CLERK`,
        `${c.code},${ph1},Farmacia Demo 1,Capital,${phone(c.code, 72)},${c.code}DEMO000072,Nuevo Dependiente Dos,CLERK`,
        `${c.code},${ph1},Farmacia Demo 1,Capital,123,${c.code}DEMO000073,Telefono Invalido,CLERK`,
        `${c.code === 'PE' ? 'CO' : 'PE'},${ph1},Farmacia Demo 1,Capital,${phone(c.code, 74)},${c.code}DEMO000074,Pais Equivocado,CLERK`,
      ].join('\n');
      await say(
        page,
        'Administrador de país',
        'Carga masiva por CSV (formato documentado). Este archivo trae 2 filas válidas y 2 con errores.',
        2600,
      );
      await page.locator('textarea').first().fill(csv);
      await page.getByRole('button', { name: /Importar CSV de usuarios/i }).click();
      await page.waitForLoadState('networkidle');
      const errs = page.getByRole('region', { name: /Errores de importación CSV/i });
      if (await errs.isVisible().catch(() => false)) await errs.scrollIntoViewIfNeeded();
      await say(
        page,
        'Administrador de país',
        'Importa las filas válidas y devuelve el reporte de errores por fila (5.000 usuarios se cargan en segundos).',
        3600,
      );
      await page.getByRole('heading', { name: /Alta de Farmacia/i }).scrollIntoViewIfNeeded();
      const code3 = `${c.code}-FAR-0${String(Date.now()).slice(-2)}`;
      await page.getByPlaceholder(`${c.code}-FAR-010`).fill(code3);
      await page.getByPlaceholder('Botica Central').fill(`Nueva ${c.term} Centro`);
      await page.getByPlaceholder('Lima').fill('Centro');
      await page.getByRole('button', { name: /Crear farmacia/i }).click();
      await page.waitForLoadState('networkidle');
      await say(page, 'Administrador de país', `Alta de una ${c.term}.`, 1800);
      const head = page.getByRole('heading', { name: /Dependientes y Gerentes/i });
      await head.scrollIntoViewIfNeeded();
      const sel = page.getByRole('combobox', { name: /Trasladar a Dependiente/ }).first();
      await say(
        page,
        'Administrador de país',
        'Traslado entre farmacias: el dependiente conserva sus puntos y queda el historial.',
        2600,
      );
      const options = await sel.locator('option:not([disabled])').allTextContents();
      const current = await sel.inputValue();
      const optValues = await sel
        .locator('option:not([disabled])')
        .evaluateAll((os) => os.map((o) => o.value));
      const target = optValues.find((v) => v !== current);
      if (target) await sel.selectOption(target);
      await page.waitForLoadState('networkidle');
      await say(
        page,
        'Administrador de país',
        `Movido a "${options[optValues.indexOf(target)] ?? ''}". El historial de asignaciones suma una entrada.`,
        2800,
      );
      const status = page.getByRole('button', { name: /^ACTIVE$/ }).first();
      await say(
        page,
        'Administrador de país',
        'Baja de un usuario: se cierran sus sesiones al instante. Se reactiva igual de fácil.',
        2400,
      );
      await status.click();
      await page.waitForLoadState('networkidle');
      await wait(1200);
      await page
        .getByRole('button', { name: /^INACTIVE$/ })
        .first()
        .click();
      await page.waitForLoadState('networkidle');
      await wait(1000);
    },
  );

  await video(
    {
      id: `${code}-8-contenido`,
      country: code,
      section: 'Contenido',
      title: 'Banco de preguntas y flujo de aprobación',
      summary:
        'El editor de contenido carga preguntas por CSV (nacen en borrador), las envía a revisión y las publica. Solo las publicadas entran a las partidas; cada cambio queda auditado.',
      modules: ['6 Marcas y contenido'],
    },
    'desk',
    async (page) => {
      await page.goto(ADMIN);
      await titleCard(
        page,
        eyebrow,
        'Contenido: preguntas y aprobación',
        'Borrador → en revisión → publicada, con auditoría.',
      );
      await adminLogin(page, c, 92, 'Editor de contenido');
      await page.getByRole('button', { name: /^Marcas y Preguntas$/ }).click();
      await page
        .getByRole('heading', { name: /Carga masiva de preguntas/i })
        .scrollIntoViewIfNeeded();
      const tag = String(Date.now()).slice(-4);
      const csv = [
        'brandSlug,countryCode,type,prompt,options,correctAnswer,locale',
        `marca-a,${c.code},MULTIPLE_CHOICE,¿Dónde se recomienda exhibir Marca A en la campaña ${tag}?,a:Junto a la caja|b:Bodega interna|c:Estante oculto|d:Pasillo trasero,a,es-${c.code}`,
        `marca-a,${c.code},TRUE_FALSE,Verdadero o falso: la campaña ${tag} de Marca A incluye material para mostrador.,TRUE:Verdadero|FALSE:Falso,TRUE,es-${c.code}`,
      ].join('\n');
      await say(
        page,
        'Editor de contenido',
        'Carga de preguntas por CSV: todas nacen en borrador (DRAFT).',
        2400,
      );
      await page.locator('textarea').last().fill(csv);
      await page.getByRole('button', { name: /Importar CSV de preguntas/i }).click();
      await page.waitForLoadState('networkidle');
      await wait(800);
      await page.getByLabel('Filtrar por estado').selectOption('DRAFT');
      await page.waitForLoadState('networkidle');
      const row = page.locator('li', { hasText: `campaña ${tag}` }).first();
      await row.scrollIntoViewIfNeeded();
      await say(
        page,
        'Editor de contenido',
        'La pregunta nueva aparece en borrador. Se envía a revisión…',
        2400,
      );
      await row.getByRole('button', { name: /Pasar a IN_REVIEW/ }).click();
      await page.waitForLoadState('networkidle');
      await page.getByLabel('Filtrar por estado').selectOption('IN_REVIEW');
      await page.waitForLoadState('networkidle');
      const row2 = page.locator('li', { hasText: `campaña ${tag}` }).first();
      await row2.scrollIntoViewIfNeeded();
      await say(
        page,
        'Editor de contenido',
        '…y, revisada, se publica. Desde ese momento puede salir en una partida.',
        2400,
      );
      await row2.getByRole('button', { name: /Pasar a PUBLISHED/ }).click();
      await page.waitForLoadState('networkidle');
      await page.getByLabel('Filtrar por estado').selectOption('PUBLISHED');
      await page.waitForLoadState('networkidle');
      await page
        .locator('li', { hasText: `campaña ${tag}` })
        .first()
        .scrollIntoViewIfNeeded();
      await say(
        page,
        'Editor de contenido',
        'Publicada. Cada transición queda en el registro de auditoría.',
        2800,
      );
    },
  );

  if (!IDS || IDS.includes(`${code}-9-juego-justo`)) await bot(c);
  await video(
    {
      id: `${code}-9-juego-justo`,
      country: code,
      section: 'Juego justo y cierre',
      title: 'Alertas de juego justo, reportes y cierre de periodo',
      summary:
        'Un script que respondió en ráfaga mintiendo sobre el tiempo quedó en revisión. El administrador confirma la alerta (anulación inversa auditada), exporta el reporte de participación y ve que el periodo solo se puede cerrar cuando termina.',
      modules: ['8 Puntos y juego justo', '9 Cierre de periodo', '12 Reporte de participación'],
    },
    'desk',
    async (page) => {
      await page.goto(ADMIN);
      await titleCard(
        page,
        eyebrow,
        'Juego justo, reportes y cierre',
        'Alertas en revisión, reporte CSV y cierre de periodo.',
      );
      await adminLogin(page, c, 91, 'Administrador de país');
      await page.getByRole('button', { name: /^Anomalías/ }).click();
      await page.getByRole('heading', { name: /Alertas de Anomalías/i }).waitFor();
      await page.waitForLoadState('networkidle');
      await say(
        page,
        'Administrador de país',
        'Un script respondió en ráfaga diciendo que tardaba 5 s: el servidor midió los tiempos reales y lo marcó. Sus puntos no cuentan para ganadores.',
        4200,
      );
      const confirm = page.getByRole('button', { name: /Confirmar y Anular/i }).first();
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.click();
        await page.waitForLoadState('networkidle');
        await say(
          page,
          'Administrador de país',
          'Confirmada: se anula con un movimiento inverso en el libro de puntos, que es inmutable y queda auditado.',
          3400,
        );
      }
      await page.getByRole('button', { name: /Configuración de País/i }).click();
      const exp = page.getByRole('button', { name: /Exportar reporte de participación/i });
      await exp.scrollIntoViewIfNeeded();
      await exp.click();
      await page.getByText(/Reporte de participación .* exportado/i).waitFor();
      await page.locator('pre').last().scrollIntoViewIfNeeded();
      await say(
        page,
        'Administrador de país',
        'Reporte de participación por país, farmacia y marca en CSV (la exportación queda auditada).',
        3200,
      );
      const close = page.getByRole('button', { name: /Cerrar periodo y exportar ganadores/i });
      await close.scrollIntoViewIfNeeded();
      await close.click();
      await page.getByText(/se puede cerrar desde ese momento/i).waitFor();
      await page.getByText(/se puede cerrar desde ese momento/i).scrollIntoViewIfNeeded();
      await say(
        page,
        'Administrador de país',
        'El cierre se habilita al terminar el periodo: toma la foto final, genera ganadores en CSV y abre el siguiente. Cada día a las 23:55 se guarda la foto oficial.',
        4400,
      );
    },
  );
}

// ───────────────────────── Gestión global ─────────────────────────
if (ONLY.includes('PE')) {
  const pe = COUNTRIES.PE;
  await video(
    {
      id: 'G-1-superadmin',
      country: 'GLOBAL',
      section: 'Gestión global',
      title: 'Super administrador: tres países y alta de un país nuevo',
      summary:
        'El super administrador ve Colombia, Ecuador y Perú. Agregar un país es configuración: se da de alta, se publica su consentimiento y se activa, sin desarrollo.',
      modules: ['3 Agregar un país = configuración', '5 Roles'],
    },
    'desk',
    async (page) => {
      await page.goto(ADMIN);
      await titleCard(
        page,
        'Gestión global · Juega y aprende',
        'Super administrador',
        'Los tres países y el alta de uno nuevo por configuración.',
      );
      await adminLogin(page, pe, 90, 'Super administrador');
      const aside = page.getByRole('complementary', { name: /Países en tu alcance/i });
      await say(page, 'Super administrador', 'Ve y administra los tres países del programa.', 2400);
      for (const name of ['Colombia', 'Ecuador', 'Perú']) {
        const b = aside.getByRole('button', { name: new RegExp(name) }).first();
        if (await b.isVisible().catch(() => false)) {
          await b.click();
          await page.waitForLoadState('networkidle');
          await wait(1200);
        }
      }
      await page.getByRole('heading', { name: /Dar de alta país/i }).scrollIntoViewIfNeeded();
      await say(
        page,
        'Super administrador',
        'Agregar un país es configuración, no desarrollo: código, nombre, idioma, zona horaria y prefijo.',
        3000,
      );
      const code = 'BO';
      await page.getByPlaceholder('BO', { exact: true }).fill(code);
      await page.getByPlaceholder('Bolivia').fill('Bolivia (demo)');
      await page.getByLabel('Locale').fill('es-BO');
      await page.getByLabel('Zona horaria').fill('America/La_Paz');
      await page.getByLabel('Prefijo telefónico').fill('+591');
      await page.getByRole('button', { name: /Crear país/i }).click();
      await page.waitForLoadState('networkidle');
      await wait(1000);
      await say(
        page,
        'Super administrador',
        'Nace inactivo. Antes de activarlo hay que publicar su consentimiento de datos.',
        2800,
      );
      const txt = page.getByPlaceholder('Nuevo texto legal con finalidad declarada…');
      await txt.scrollIntoViewIfNeeded();
      await txt.fill(
        'TEXTO DE EJEMPLO para Bolivia: autorizas el tratamiento de tu celular y tu actividad de juego para operar el programa de capacitación.',
      );
      await page.getByRole('button', { name: /Publicar nueva versión/i }).click();
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: /Activar país/i }).scrollIntoViewIfNeeded();
      await page.getByRole('button', { name: /Activar país/i }).click();
      await page.waitForLoadState('networkidle');
      await say(
        page,
        'Super administrador',
        'Activo: aparece en la pantalla de elección de país. Luego se cargan sus farmacias, usuarios y marcas.',
        3400,
      );
    },
  );

  await video(
    {
      id: 'G-2-seguridad',
      country: 'GLOBAL',
      section: 'Gestión global',
      title: 'País fijado y funcionamiento sin conexión',
      summary:
        'Una cuenta de Colombia no puede entrar ni puntuar en otro país. La app instalada abre sin conexión y lo avisa; los datos nunca se sirven desde caché.',
      modules: ['1 País fijado', 'PWA sin conexión'],
    },
    'phone',
    async (page, ctx) => {
      const co = COUNTRIES.CO;
      await page.goto(PWA);
      await titleCard(
        page,
        'Gestión global · Juega y aprende',
        'País fijado y sin conexión',
        'Reglas que protegen la competencia y la experiencia en campo.',
      );
      await page.getByRole('button', { name: 'Perú', exact: true }).click();
      await say(
        page,
        'Seguridad',
        'Una dependiente de Colombia intenta ingresar eligiendo Perú.',
        2400,
      );
      const e164 = phone('CO', 4);
      await page.getByLabel(/Número de celular/i).pressSequentially(e164, { delay: 50 });
      const before = await inboxAt(e164);
      await page.getByRole('button', { name: /Recibir código/i }).click();
      const msg = await otpFor(e164, before);
      await page.getByLabel(/Código de 6 dígitos/i).pressSequentially(msg.code, { delay: 80 });
      await page.getByRole('button', { name: /Ingresar/i }).click();
      await page.getByRole('alert').first().waitFor();
      await say(
        page,
        'Seguridad',
        `Rechazado: su cuenta está fijada a ${co.name}. Nadie puede puntuar en dos países.`,
        3600,
      );
      // Sin conexión (con service worker)
      const ctx2 = await browser.newContext({ ...devices['Pixel 5'], serviceWorkers: 'allow' });
      const p2 = await ctx2.newPage();
      await p2.goto(PWA);
      await p2.evaluate(async () => navigator.serviceWorker.ready);
      await ctx2.close();
      await page.reload();
      await page.evaluate(async () => navigator.serviceWorker?.ready).catch(() => undefined);
      await say(page, 'Sin conexión', 'La app queda instalada en el celular (PWA).', 1800);
      await ctx.setOffline(true);
      await page.reload().catch(() => undefined);
      await say(
        page,
        'Sin conexión',
        'Sin red, la app igual abre y lo avisa. Una partida empezada se puede terminar sin red.',
        3600,
      );
      await ctx.setOffline(false);
    },
  );
}

await browser.close();
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
const bad = manifest.filter((m) => !m.ok);
console.log(`\n${manifest.length - bad.length}/${manifest.length} videos OK · ${OUT}`);
process.exit(bad.length ? 1 : 0);
