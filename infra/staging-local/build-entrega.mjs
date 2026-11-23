// Arma la entrega del MVP a partir de los videos de record-demo.mjs:
// - OUT/entrega-mvp.html: un solo archivo autocontenido (videos MP4 incrustados), para enviar.
// - OUT/web/index.html + OUT/web/videos/*.mp4: la misma página con los videos aparte, para publicar.
// Uso: node infra/staging-local/build-entrega.mjs <VIDEOS_DIR> <OUT_DIR>
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const VIDEOS = resolve(process.argv[2]);
const OUT = resolve(process.argv[3]);
const WEB = join(OUT, 'web');
mkdirSync(join(WEB, 'videos'), { recursive: true });

const manifest = JSON.parse(readFileSync(join(VIDEOS, 'manifest.json'), 'utf8')).filter(
  (m) => m.ok,
);
const commit = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: resolve(import.meta.dirname, '../..'),
    })
      .toString()
      .trim();
  } catch {
    return '';
  }
})();

// ── Transcodificar a MP4 H.264 (se reproduce en Android, iPhone y escritorio) + póster ──
for (const m of manifest) {
  const src = join(VIDEOS, m.file);
  const mp4 = join(WEB, 'videos', `${m.id}.mp4`);
  const jpg = join(WEB, 'videos', `${m.id}.jpg`);
  if (!existsSync(mp4)) {
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      src,
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      m.kind === 'phone' ? '30' : '31',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-an',
      mp4,
    ]);
  }
  if (!existsSync(jpg)) {
    // Póster: la portada del video (título y descripción).
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-ss',
      '2.2',
      '-i',
      mp4,
      '-frames:v',
      '1',
      '-vf',
      'scale=640:-2',
      '-q:v',
      '5',
      jpg,
    ]);
  }
  m.mp4Bytes = statSync(mp4).size;
  const [w, h] = execFileSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height',
    '-of',
    'csv=p=0',
    mp4,
  ])
    .toString()
    .trim()
    .split(',')
    .map(Number);
  m.width = w;
  m.height = h;
}

// ── Contenido ──
const COUNTRY = {
  PE: { name: 'Perú', term: 'botica', law: 'Ley 29733', brands: 4, tz: 'America/Lima' },
  CO: {
    name: 'Colombia',
    term: 'droguería',
    law: 'Ley 1581 de 2012',
    brands: 5,
    tz: 'America/Bogota',
  },
  EC: { name: 'Ecuador', term: 'farmacia', law: 'LOPDP', brands: 5, tz: 'America/Guayaquil' },
};
const SECTIONS = [
  'Dependiente',
  'Gerente de farmacia',
  'Administración del país',
  'Contenido',
  'Juego justo y cierre',
];
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch],
  );
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function card(m, mode) {
  const poster =
    mode === 'single'
      ? `data:image/jpeg;base64,${readFileSync(join(WEB, 'videos', `${m.id}.jpg`)).toString('base64')}`
      : `videos/${m.id}.jpg`;
  const src = mode === 'single' ? '' : `videos/${m.id}.mp4`;
  return `<article class="card ${m.kind}" id="v-${m.id}">
  <div class="player"><video controls playsinline preload="none" poster="${poster}" style="aspect-ratio: ${m.width} / ${m.height}" ${src ? `src="${src}"` : `data-embed="${m.id}"`} aria-label="${esc(m.title)}"></video></div>
  <div class="meta">
    <div class="row"><span class="who">${esc(m.section)}</span><span class="dur">${mmss(m.seconds)}</span></div>
    <h4>${esc(m.title)}</h4>
    <p>${esc(m.summary)}</p>
    <div class="mods">${m.modules.map((x) => `<span>${esc(x)}</span>`).join('')}</div>
  </div>
</article>`;
}

function countryPanel(code, mode) {
  const c = COUNTRY[code];
  const vids = manifest.filter((m) => m.country === code);
  if (!vids.length) return '';
  const groups = SECTIONS.map((s) => {
    const list = vids.filter((m) => m.section === s);
    if (!list.length) return '';
    return `<div class="group"><h3>${esc(s)}</h3><div class="cards">${list.map((m) => card(m, mode)).join('')}</div></div>`;
  }).join('');
  return `<section class="panel" id="p-${code.toLowerCase()}" data-tab="${code.toLowerCase()}">
  <header class="panel-head">
    <h2>${esc(c.name)}</h2>
    <dl class="facts">
      <div><dt>Marcas activas</dt><dd>${c.brands}</dd></div>
      <div><dt>Término local</dt><dd>${esc(c.term)}</dd></div>
      <div><dt>Datos personales</dt><dd>${esc(c.law)}</dd></div>
      <div><dt>Zona horaria</dt><dd>${esc(c.tz)}</dd></div>
    </dl>
    <p class="lead">Recorrido completo en ${esc(c.name)}: el dependiente de principio a fin, el gerente de su ${esc(c.term)}, la administración del país, el contenido y el juego justo. Los datos son ficticios.</p>
  </header>
  ${groups}
</section>`;
}

const globalVids = manifest.filter((m) => m.country === 'GLOBAL');
const link = (id, text) =>
  manifest.some((m) => m.id === id) ? `<a href="#v-${id}" data-goto="${id}">${text}</a>` : text;

const CYCLE = [
  [
    'Alta y configuración del país',
    'El super administrador da de alta el país, publica su consentimiento y lo activa. El administrador del país fija reglas de puntos, topes y periodo de ranking.',
    ['G-1-superadmin', 'PE-6-config'],
  ],
  [
    'Farmacias y usuarios',
    'Carga masiva por CSV con reporte de errores por fila; altas, bajas y traslados con historial.',
    ['PE-7-usuarios'],
  ],
  [
    'Marcas y preguntas',
    'El editor carga preguntas por CSV; pasan de borrador a revisión y a publicadas. Solo las publicadas salen en las partidas.',
    ['PE-8-contenido'],
  ],
  [
    'Lanzamiento',
    'Un solo enlace y un QR para los tres países. Cada persona elige su país la primera vez; queda fijado a su cuenta.',
    ['PE-1-ingreso', 'G-2-seguridad'],
  ],
  [
    'Juego diario',
    'Partidas de 2–3 minutos, trivia y verdadero/falso, que funcionan con red irregular. El servidor calcula el puntaje y aplica los topes diarios.',
    ['PE-2-trivia', 'PE-3-vf-test'],
  ],
  [
    'Juego justo',
    'Respuestas imposiblemente rápidas, partidas demasiado cortas o rachas improbables generan alertas; esos puntos no cuentan para ganadores hasta que un administrador resuelve.',
    ['PE-9-juego-justo'],
  ],
  [
    'Ranking en vivo y foto diaria',
    'Rankings individual, por farmacia (promedio por dependiente activo) y por país. Cada día a las 23:55, hora de cada país, se guarda la foto oficial.',
    ['PE-4-ranking'],
  ],
  [
    'Seguimiento en el punto de venta',
    'El gerente ve la participación de su equipo y a quién motivar.',
    ['PE-5-gerente'],
  ],
  [
    'Cierre de periodo y ganadores',
    'Al terminar el periodo (1, 2 o 3 meses) se cierra: foto final, ganadores en CSV y apertura del periodo siguiente.',
    ['PE-9-juego-justo'],
  ],
  [
    'Medición',
    'Test inicial por marca y reporte de participación por país, farmacia y marca. El test final llega en la siguiente iteración.',
    ['PE-3-vf-test', 'PE-9-juego-justo'],
  ],
];

const ROLES = [
  ['Dependiente', 'PWA', 'Juega, ve rankings y su perfil, responde el test inicial.'],
  [
    'Gerente de farmacia',
    'PWA',
    'Ve en solo lectura la participación de su equipo y la posición de su farmacia. También puede jugar.',
  ],
  ['Editor de contenido', 'Panel', 'Carga y edita preguntas y las lleva de borrador a publicadas.'],
  [
    'Administrador de país',
    'Panel',
    'Configura su país, gestiona farmacias y usuarios, resuelve alertas, exporta reportes y cierra periodos. Solo ve su país.',
  ],
  [
    'Super administrador',
    'Panel',
    'Todo lo anterior en los tres países y el alta de países nuevos.',
  ],
];

const DONE = [
  'Entrada única, ingreso por WhatsApp con respaldo SMS, sesión de 90 días y país fijado (módulos 1 y 2).',
  'Configuración por país sin desplegar y roles con alcance por país (módulos 3 y 5).',
  'Usuarios y farmacias por CSV, traslados y bajas (módulo 4); marcas y preguntas con flujo de aprobación (módulo 6).',
  'Motor de juegos, trivia y verdadero/falso, sin la respuesta correcta en el celular y con red irregular (módulo 7 y parte B).',
  'Libro de puntos inmutable, topes por zona horaria y detección de anomalías con tiempos del servidor (módulo 8).',
  'Rankings en vivo, foto oficial diaria y cierre de periodo con ganadores en CSV (módulo 9); panel del gerente y perfil (módulos 10 y 11).',
  'Test inicial por marca y reporte de participación (módulo 12, parcial). PWA instalable que abre sin conexión.',
];
const PENDING = [
  'Test final por marca y reportes avanzados (siguiente iteración, fuera del alcance del MVP).',
  'Infraestructura en la nube: imagen Docker y Terraform de referencia.',
  'Prueba de carga completa a 1.125 solicitudes/s con 2 réplicas y su informe.',
  'Plantilla de WhatsApp aprobada por Meta y agregador SMS reales (en estos videos están simulados).',
  'Métricas y trazas (Prometheus, OpenTelemetry).',
  'Verificación manual en iPhone/Safari de la app sin conexión (la integración continua ya prueba iPhone 12 en WebKit).',
];
const DECIDE = [
  [
    'Traslados',
    'Hoy los puntos cuentan para la farmacia donde la persona jugó; al trasladarse no se los lleva. ¿Se mantiene o deben seguir al dependiente?',
  ],
  [
    'Umbrales de juego justo',
    'Tiempo mínimo por respuesta (800 ms) y por partida (1,5 s por pregunta), racha perfecta (5) y partidas por hora (10). Ajustables por país.',
  ],
  [
    'Textos legales',
    'Los consentimientos son de ejemplo y requieren revisión del área legal del cliente en cada país.',
  ],
  [
    'Premios',
    'Cuántos ganadores por periodo (hoy: top 10 individual y top 10 por farmacia) y la logística de premios (fuera del MVP).',
  ],
];

function page(mode) {
  const total = manifest.length;
  const minutes = Math.round(manifest.reduce((a, m) => a + m.seconds, 0) / 60);
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Entrega MVP Juega y aprende</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap">
<style>
/* Layout: cabecera con navegación por pestañas (Resumen, países, global, ciclo, estado); cada país es una galería de videos agrupada por sección. */
:root {
  --bg: #f5f7fb; --surface: #ffffff; --fg: #121a2f; --muted: #556079; --line: #dde3ef;
  --accent: #1d4ed8; --accent-soft: #e7eeff; --ink: #0f1f4d; --ok: #0d7a49; --ok-soft: #e2f5eb; --warn: #9a5800; --warn-soft: #fff1db;
  --display: "Space Grotesk", "Segoe UI", system-ui, sans-serif; --body: "Inter", "Segoe UI", system-ui, sans-serif;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0c1120; --surface: #151b2d; --fg: #e8edf7; --muted: #9aa6c0; --line: #283048;
  --accent: #8db0ff; --accent-soft: #1b2648; --ink: #0a1430; --ok: #5ed39b; --ok-soft: #11301f; --warn: #f1b75c; --warn-soft: #382910; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #0c1120; --surface: #151b2d; --fg: #e8edf7; --muted: #9aa6c0; --line: #283048;
  --accent: #8db0ff; --accent-soft: #1b2648; --ink: #0a1430; --ok: #5ed39b; --ok-soft: #11301f; --warn: #f1b75c; --warn-soft: #382910; color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; }
body { background: var(--bg); color: var(--fg); font: 16px/1.55 var(--body); }
.wrap { max-width: 1120px; margin: 0 auto; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
h1, h2, h3, h4 { font-family: var(--display); margin: 0; text-wrap: balance; letter-spacing: -0.01em; }
p { margin: 0; }
a { color: var(--accent); }
.hero { background: var(--ink); color: #fff; padding-block: 40px 26px; }
.hero .eyebrow { font: 600 .78rem/1 var(--body); letter-spacing: .1em; text-transform: uppercase; color: #9dbcff; }
.hero h1 { font-size: clamp(1.9rem, 4.6vw, 2.8rem); line-height: 1.08; margin-top: 12px; }
.hero p { color: #d6e2ff; max-width: 62ch; margin-top: 12px; font-size: 1.05rem; }
.stats { display: flex; flex-wrap: wrap; gap: 8px 22px; margin-top: 18px; color: #c7d6ff; font-size: .92rem; }
.stats b { color: #fff; font-family: var(--display); font-size: 1.15rem; margin-right: 4px; }
nav.tabs { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; background: var(--ink); box-shadow: 0 1px 0 rgba(255,255,255,.08); }
nav.tabs .wrap { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; }
nav.tabs a { color: #c7d6ff; text-decoration: none; padding: 12px 14px; font-weight: 600; font-size: .95rem; white-space: nowrap; border-bottom: 3px solid transparent; min-height: 44px; display: inline-flex; align-items: center; }
nav.tabs a[aria-current="page"] { color: #fff; border-bottom-color: #facc15; }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--ink); }
main { padding-block: 32px 64px; }
.panel { display: grid; gap: 30px; }
.panel[hidden] { display: none !important; }
.panel-head { display: grid; gap: 14px; }
.panel-head h2 { font-size: 1.9rem; }
.lead { color: var(--muted); max-width: 70ch; }
.facts { display: flex; flex-wrap: wrap; gap: 10px; margin: 0; }
.facts div { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 8px 12px; }
.facts dt { font-size: .74rem; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.facts dd { margin: 0; font-weight: 600; }
.group { display: grid; gap: 14px; }
.group h3 { font-size: 1.15rem; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 250px), 1fr)); gap: 18px; align-items: start; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; display: grid; min-width: 0; }
.card.desk { grid-column: 1 / -1; grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr); }
.card .player { background: #0b1022; display: grid; place-items: center; }
.card video { display: block; width: 100%; height: auto; max-height: 560px; background: #0b1022; }
.card.phone video { max-height: 560px; width: auto; max-width: 100%; }
.meta { padding: 14px 16px 16px; display: grid; gap: 8px; align-content: start; min-width: 0; }
.meta .row { display: flex; justify-content: space-between; gap: 8px; font-size: .78rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.meta h4 { font-size: 1.05rem; }
.meta p { color: var(--muted); font-size: .94rem; }
.mods { display: flex; flex-wrap: wrap; gap: 6px; }
.mods span { font-size: .75rem; background: var(--accent-soft); color: var(--accent); border-radius: 999px; padding: 2px 9px; font-weight: 500; }
.dur { font-variant-numeric: tabular-nums; }
.intro-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 16px; }
.box { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 18px; display: grid; gap: 10px; align-content: start; min-width: 0; }
.box h3 { font-size: 1.08rem; }
.box p, .box li { color: var(--muted); }
.box ul { margin: 0; padding-left: 1.1em; display: grid; gap: 6px; }
.country-links { display: flex; flex-wrap: wrap; gap: 10px; }
.country-links a { text-decoration: none; background: var(--accent); color: #fff; padding: 10px 16px; border-radius: 10px; font-weight: 600; min-height: 44px; display: inline-flex; align-items: center; }
:root[data-theme="dark"] .country-links a { color: #0c1120; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .country-links a { color: #0c1120; } }
.table { overflow-x: auto; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
table { border-collapse: collapse; width: 100%; min-width: 560px; }
th, td { text-align: left; padding: 11px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: .78rem; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
tr:last-child td { border-bottom: 0; }
td.app { white-space: nowrap; font-weight: 600; }
ol.cycle { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; counter-reset: step; }
ol.cycle li { counter-increment: step; display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 14px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
ol.cycle li::before { content: counter(step); width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); font: 700 1rem var(--display); }
ol.cycle h4 { font-size: 1.02rem; }
ol.cycle p { color: var(--muted); font-size: .94rem; margin-top: 4px; }
ol.cycle .see { font-size: .88rem; margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px 12px; }
.status { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 16px; }
.pill { display: inline-block; font-size: .74rem; font-weight: 600; border-radius: 6px; padding: 2px 8px; }
.pill.ok { background: var(--ok-soft); color: var(--ok); } .pill.warn { background: var(--warn-soft); color: var(--warn); }
footer { color: var(--muted); font-size: .85rem; padding-block: 0 40px; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (max-width: 760px) { .card.desk { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
</style>
</head>
<body>
<header class="hero">
  <div class="wrap">
    <span class="eyebrow">MVP 1 · Piloto funcional · Entrega al product owner y al cliente</span>
    <h1>Juega y aprende: así funciona una vez desplegado</h1>
    <p>Videos del producto funcionando en un despliegue con configuración de producción, para cada país y cada sección: lo que vive el dependiente en su celular, lo que ve el gerente y cómo se administra todo, de la carga de usuarios al cierre del periodo.</p>
    <div class="stats"><span><b>${total}</b>videos</span><span><b>${minutes}</b>minutos</span><span><b>3</b>países</span><span><b>5</b>roles</span></div>
  </div>
</header>
<nav class="tabs" aria-label="Secciones de la entrega"><div class="wrap">
    <a href="#resumen" data-tab="resumen">Resumen</a>
    <a href="#pe" data-tab="pe">Perú</a>
    <a href="#co" data-tab="co">Colombia</a>
    <a href="#ec" data-tab="ec">Ecuador</a>
    <a href="#global" data-tab="global">Gestión global</a>
    <a href="#ciclo" data-tab="ciclo">Ciclo de gestión</a>
    <a href="#estado" data-tab="estado">Estado y pendientes</a>
</div></nav>

<main class="wrap">
<section class="panel" id="p-resumen" data-tab="resumen">
  <div class="intro-grid">
    <div class="box"><h3>Qué es</h3><p>Una web móvil instalable para que los dependientes de farmacia de Colombia, Ecuador y Perú refuercen el conocimiento de las marcas OTC con juegos de 2–3 minutos, puntos, rankings por periodo y un test de conocimiento por marca.</p></div>
    <div class="box"><h3>Cómo se grabaron</h3><p>Sobre el sistema completo con configuración de producción: dos réplicas de la API, la app y el panel compilados, y base de datos con datos ficticios (Marcas A–I). WhatsApp y SMS están simulados; cada video es una interacción real, sin edición.</p></div>
    <div class="box"><h3>Cómo verlos</h3><p>Cada país tiene su recorrido completo, agrupado por sección. Los videos del celular se ven en formato vertical; los del panel, en horizontal. Los subtítulos de cada video explican lo que pasa.</p>
      <div class="country-links"><a href="#pe" data-tab="pe">Perú</a><a href="#co" data-tab="co">Colombia</a><a href="#ec" data-tab="ec">Ecuador</a></div></div>
  </div>
  <div class="group"><h3>Quién hace qué</h3>
    <div class="table"><table><thead><tr><th>Rol</th><th>Dónde</th><th>Qué hace</th></tr></thead><tbody>
    ${ROLES.map(([r, a, d]) => `<tr><td><b>${esc(r)}</b></td><td class="app">${esc(a)}</td><td>${esc(d)}</td></tr>`).join('')}
    </tbody></table></div>
  </div>
</section>

${['PE', 'CO', 'EC'].map((c) => countryPanel(c, mode)).join('\n')}

<section class="panel" id="p-global" data-tab="global">
  <header class="panel-head"><h2>Gestión global</h2>
    <p class="lead">Lo que se administra para todos los países a la vez y las reglas que protegen la competencia.</p></header>
  <div class="group"><div class="cards">${globalVids.map((m) => card(m, mode)).join('')}</div></div>
</section>

<section class="panel" id="p-ciclo" data-tab="ciclo">
  <header class="panel-head"><h2>Ciclo de gestión del programa</h2>
    <p class="lead">El orden en que se opera el programa en cada país, con el video que muestra cada paso (en Perú; Colombia y Ecuador funcionan igual).</p></header>
  <ol class="cycle">
    ${CYCLE.map(([t, d, ids]) => `<li><div><h4>${esc(t)}</h4><p>${esc(d)}</p><div class="see">${ids.map((id) => link(id, `Ver: ${esc(manifest.find((m) => m.id === id)?.title ?? id)}`)).join('')}</div></div></li>`).join('')}
  </ol>
</section>

<section class="panel" id="p-estado" data-tab="estado">
  <header class="panel-head"><h2>Estado y pendientes</h2>
    <p class="lead">Qué incluye esta entrega, qué falta para el lanzamiento y qué decisiones necesitamos del cliente.</p></header>
  <div class="status">
    <div class="box"><h3><span class="pill ok">Listo</span> Incluido en el MVP</h3><ul>${DONE.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
    <div class="box"><h3><span class="pill warn">Pendiente</span> Antes del lanzamiento</h3><ul>${PENDING.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
  </div>
  <div class="group"><h3>Decisiones que necesitamos del cliente</h3>
    <div class="table"><table><thead><tr><th>Tema</th><th>Situación</th></tr></thead><tbody>
    ${DECIDE.map(([t, d]) => `<tr><td><b>${esc(t)}</b></td><td>${esc(d)}</td></tr>`).join('')}
    </tbody></table></div>
  </div>
</section>
</main>
<footer class="wrap">Grabado sobre el staging con configuración de producción${commit ? ` · versión ${commit}` : ''} · ${new Date().toISOString().slice(0, 10)} · Datos y marcas ficticios.</footer>

${mode === 'single' ? `<script id="embedded-videos" type="application/json">${JSON.stringify(Object.fromEntries(manifest.map((m) => [m.id, readFileSync(join(WEB, 'videos', `${m.id}.mp4`)).toString('base64')])))}</script>` : ''}
<script>
(() => {
  // Pestañas por #hash (#pe, #co, #ec…). Un enlace a un video (#v-ID) abre su pestaña.
  const tabs = [...document.querySelectorAll('nav.tabs a')];
  const panels = [...document.querySelectorAll('.panel')];
  function show(tab, scrollTo) {
    if (!panels.some((p) => p.dataset.tab === tab)) tab = 'resumen';
    panels.forEach((p) => { p.hidden = p.dataset.tab !== tab; });
    tabs.forEach((a) => {
      if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    document.querySelectorAll('video').forEach((v) => { if (v.closest('.panel').hidden) v.pause(); });
    if (scrollTo) scrollTo.scrollIntoView({ block: 'start' }); else window.scrollTo({ top: 0 });
  }
  function route() {
    const h = location.hash.slice(1);
    if (h.startsWith('v-')) { const el = document.getElementById(h); if (el) return show(el.closest('.panel').dataset.tab, el); }
    show(h || 'resumen');
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-tab], a[data-goto]');
    if (!a) return;
    e.preventDefault();
    const target = a.dataset.goto ? 'v-' + a.dataset.goto : a.dataset.tab;
    if (location.hash.slice(1) === target) route(); else location.hash = target;
  });
  window.addEventListener('hashchange', route);
  route();

  // Un solo video a la vez.
  document.addEventListener('play', (e) => {
    document.querySelectorAll('video').forEach((v) => { if (v !== e.target) v.pause(); });
  }, true);

  // Archivo único: los videos van incrustados y se cargan recién al pedir reproducirlos.
  const data = document.getElementById('embedded-videos');
  if (data) {
    let all = null;
    document.querySelectorAll('video[data-embed]').forEach((v) => {
      const load = () => {
        if (v.src) return;
        all ??= JSON.parse(data.textContent);
        const bin = atob(all[v.dataset.embed]);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        v.src = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
        v.play().catch(() => {});
      };
      v.addEventListener('play', load, { once: true });
      v.addEventListener('click', load, { once: true });
    });
  }
})();
</script>
</body>
</html>`;
}

writeFileSync(join(WEB, 'index.html'), page('web'));
writeFileSync(join(OUT, 'entrega-mvp.html'), page('single'));
const mb = (f) => (statSync(f).size / 1e6).toFixed(1);
console.log(
  `web/index.html + ${manifest.length} videos (${(manifest.reduce((a, m) => a + m.mp4Bytes, 0) / 1e6).toFixed(1)} MB)`,
);
console.log(`entrega-mvp.html: ${mb(join(OUT, 'entrega-mvp.html'))} MB`);
