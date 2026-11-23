// Guía de presentación del MVP para el scrum master o cualquier persona del equipo: guion por
// bloque (qué decir, qué señalar, mensaje clave, preguntas probables), videos con selector de país,
// modo presentación con teclado y cronómetro, y notas de la reunión.
// Usa los MP4 que generó build-entrega.mjs.
// Uso: node infra/staging-local/build-guia.mjs <ENTREGA_DIR> <OUT_DIR>
//   <ENTREGA_DIR>/web/videos/*.mp4 y <VIDEOS_DIR>/manifest.json vía <ENTREGA_DIR>/manifest.json
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ENTREGA = resolve(process.argv[2]);
const OUT = resolve(process.argv[3]);
const VIDEOS = join(ENTREGA, 'web', 'videos');
const MANIFEST = process.argv[4] ? resolve(process.argv[4]) : join(ENTREGA, 'manifest.json');
mkdirSync(join(OUT, 'web', 'videos'), { recursive: true });
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')).filter((m) => m.ok);
const byId = Object.fromEntries(manifest.map((m) => [m.id, m]));
for (const m of manifest) {
  const [w, h] = execFileSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height',
    '-of',
    'csv=p=0',
    join(VIDEOS, `${m.id}.mp4`),
  ])
    .toString()
    .trim()
    .split(',')
    .map(Number);
  m.width = w;
  m.height = h;
  for (const ext of ['mp4', 'jpg']) {
    const dst = join(OUT, 'web', 'videos', `${m.id}.${ext}`);
    if (!existsSync(dst)) copyFileSync(join(VIDEOS, `${m.id}.${ext}`), dst);
  }
}

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

// ───────────────────────── Guion ─────────────────────────
// `videos`: sufijos por país (PE-…, CO-…, EC-…) o ids globales (G-…).
const BLOCKS = [
  {
    id: 'preparacion',
    title: 'Antes de la reunión',
    minutes: 0,
    goal: 'Tener todo listo para que la demo no dependa de la red ni de un servidor.',
    say: [
      'Abre este archivo en el navegador del computador que vas a proyectar. Funciona sin conexión: los videos van dentro.',
      'Ten abierta también la presentación (14 diapositivas) en otra pestaña; los videos se muestran desde esta guía.',
      'Elige el país de la demo con el selector de arriba. Si el cliente es de un país en particular, empieza por ese.',
      'Reparte los bloques: quien presenta el producto (bloques 2 y 3) y quien responde lo técnico (bloque 4).',
      'Activa el modo presentación (botón o tecla P) y usa las flechas ← → para avanzar.',
    ],
    show: ['Prueba que el primer video se reproduce antes de que entren los participantes.'],
    key: 'Todo lo que se muestra usa datos y marcas ficticios (Marca A a Marca I): los nombres reales están bajo confidencialidad.',
    qa: [],
  },
  {
    id: 'objetivo',
    title: 'Objetivo y alcance',
    minutes: 3,
    goal: 'Recordar para qué existe el producto y qué incluye este MVP.',
    say: [
      'El producto refuerza la recordación de las marcas OTC entre los dependientes que las recomiendan en el mostrador, en Colombia, Ecuador y Perú.',
      'Éxito = los dependientes vuelven a jugar y el cliente puede demostrar que mejoró el conocimiento de sus marcas.',
      'Dimensionamiento: 15.000 dependientes el primer año, 9 marcas, celulares de gama baja y red móvil irregular.',
      'El MVP es el piloto funcional para Perú; Colombia y Ecuador se suman por configuración, sin desarrollo.',
      'Incluye: entrada única con código por WhatsApp, juegos de trivia y verdadero/falso, puntos y juego justo, rankings, panel del gerente, perfil, administración por país, contenido con aprobación y test inicial por marca.',
    ],
    show: ['Diapositivas 3 a 5 de la presentación: objetivo, alcance y roles.'],
    key: 'El MVP cubre los 12 módulos del alcance; el test final y los reportes avanzados son la siguiente iteración.',
    qa: [
      [
        '¿Por qué una web y no una app de tienda?',
        'Es una app web instalable (PWA): se instala desde el navegador sin pasar por tiendas, pesa menos y se actualiza sola. Las apps nativas quedaron fuera del alcance.',
      ],
      [
        '¿Qué pasa con los premios?',
        'El sistema genera los ganadores por periodo en CSV; la logística de los premios queda fuera del MVP.',
      ],
    ],
  },
  {
    id: 'dependiente',
    title: 'Demo: la experiencia del dependiente',
    minutes: 8,
    goal: 'Mostrar lo que vive un dependiente en su celular, de principio a fin, con red irregular.',
    videos: ['1-ingreso', '2-trivia', '3-vf-test', '4-ranking', '5-gerente'],
    say: [
      'Un solo enlace y un QR para los tres países: la persona elige su país la primera vez.',
      'Ingresa con su celular y un código que le llega por WhatsApp (con respaldo SMS automático). La sesión dura 90 días.',
      'Antes de jugar acepta el consentimiento de datos de su país. Después, su país queda fijado: no puede puntuar en otro.',
      'Juega partidas de 2 a 3 minutos: 10 preguntas de una marca, con el tema visual de la marca.',
      'Si se corta la red a mitad de partida, sigue respondiendo; al volver, se envía todo y el servidor calcula el puntaje.',
      'Ve el ranking individual, por farmacia y por país, su perfil y las marcas que le faltan. El gerente de su farmacia ve la participación del equipo.',
    ],
    show: [
      'Video 1: el país queda fijado a la cuenta y el término local de la farmacia.',
      'Video 2: el aviso “Sin conexión” arriba y que la partida termina igual.',
      'Video 3: el test inicial por marca al final.',
      'Video 4: el ranking por farmacia es promedio por dependiente activo, no suma.',
      'Video 5: el gerente ve a quién motivar, con teléfonos enmascarados.',
    ],
    key: 'Funciona en un Android de gama baja con red irregular, y el celular nunca recibe la respuesta correcta.',
    qa: [
      [
        '¿Y si no tiene datos móviles?',
        'La app instalada abre sin conexión y una partida empezada se puede terminar sin red. Para ingresar o ver rankings necesita conexión.',
      ],
      [
        '¿Por qué el ranking de farmacia es un promedio?',
        'Para que una farmacia grande no gane solo por tener más dependientes: se divide entre los dependientes que jugaron en el periodo.',
      ],
      [
        '¿Cuántas partidas puede jugar?',
        'Hasta 3 por juego al día; puede seguir practicando al llegar al tope diario de puntos, pero ya no suma. Se configura por país.',
      ],
    ],
  },
  {
    id: 'gestion',
    title: 'Demo: la gestión de un país',
    minutes: 8,
    goal: 'Mostrar que el cliente opera el programa solo, por configuración y sin desarrollo.',
    videos: [
      '6-config',
      '7-usuarios',
      '8-contenido',
      '9-juego-justo',
      'G-1-superadmin',
      'G-2-seguridad',
    ],
    say: [
      'El administrador de un país solo ve su país. Cambia reglas de puntos, topes y periodo de ranking, y se aplica al momento, sin desplegar.',
      'Carga farmacias y usuarios por CSV: importa las filas válidas y devuelve el error de cada fila inválida. Traslados y bajas quedan en el historial.',
      'El editor carga preguntas por CSV: nacen en borrador, pasan a revisión y se publican. Solo las publicadas salen en las partidas.',
      'Juego justo: un bot que respondió en ráfaga diciendo que tardaba 5 s quedó en revisión; sus puntos no cuentan hasta que un administrador decide.',
      'Cada día a las 23:55, hora de cada país, se guarda la foto oficial del ranking. El periodo se cierra cuando termina y genera los ganadores en CSV.',
      'El super administrador ve los tres países y da de alta uno nuevo solo con configuración.',
    ],
    show: [
      'Video 6: el mensaje “sin desplegar” al guardar la configuración.',
      'Video 7: el reporte de errores por fila de la carga CSV.',
      'Video 8: la pregunta pasando de DRAFT a IN_REVIEW a PUBLISHED.',
      'Video 9: la alerta confirmada y el cierre rechazado porque el periodo no ha terminado.',
      'Global 1: Bolivia (solo de demostración) creada y activada sin código.',
      'Global 2: una cuenta de Colombia rechazada al entrar en Perú, y la app abriendo sin red.',
    ],
    key: 'Agregar un país, una marca o una pregunta es configuración; cada acción de administración queda auditada.',
    qa: [
      [
        '¿Un administrador de Perú puede ver Colombia?',
        'No. El alcance lo aplica el servidor y está cubierto por pruebas automáticas; solo el super administrador ve los tres países.',
      ],
      [
        '¿Qué pasa si un dependiente cambia de farmacia?',
        'Conserva sus puntos y su historial. Hoy los puntos ya ganados se quedan en la farmacia donde jugó (es una de las decisiones a confirmar).',
      ],
      [
        '¿Se puede anular un puntaje?',
        'Sí, con un movimiento inverso auditado: el libro de puntos no se borra ni se edita.',
      ],
    ],
  },
  {
    id: 'calidad',
    title: 'Calidad, rendimiento y lo que corregimos',
    minutes: 4,
    goal: 'Dar confianza con evidencia: pruebas, mediciones y transparencia sobre lo corregido.',
    say: [
      '176 pruebas automáticas: 113 unitarias, 57 de integración contra base de datos real y 6 de punta a punta en celular. Corren en cada cambio.',
      'El ranking, con el volumen de Perú (5.000 dependientes y 200.000 partidas), pasó de 3,5 a unas 750 consultas por segundo en una sola instancia, con 105 ms de p95.',
      'La app pesa 94 KB de JavaScript inicial, con un límite de 300 KB para gama baja.',
      'Antes de entregar hicimos una revisión de arquitectura y emulamos el uso con configuración de producción. Encontramos y corregimos 11 problemas, cada uno con su prueba.',
    ],
    show: ['Diapositivas 10 y 11 de la presentación.'],
    key: 'Lo que se vio en la demo es el sistema real con configuración de producción, no un prototipo.',
    qa: [
      [
        '¿Aguanta el pico de uso?',
        'El diseño es para 1.125 solicitudes por segundo. La medición del ranking ya cumple en una instancia; la prueba de carga completa con dos réplicas está en los pendientes antes del piloto.',
      ],
      [
        '¿Qué fue lo más grave que encontraron?',
        'Una partida podía acreditar puntos dos veces si el celular reintentaba, y un cierre de periodo anticipado dejaba partidas fuera. Ambos afectaban a quién gana y ya están corregidos.',
      ],
    ],
  },
  {
    id: 'decisiones',
    title: 'Pendientes y decisiones del cliente',
    minutes: 5,
    goal: 'Salir de la reunión con responsables y fechas para lo que falta.',
    say: [
      'Para salir a producción faltan: infraestructura en la nube, la prueba de carga completa, la mensajería real (plantilla de WhatsApp aprobada por Meta y agregador SMS), métricas y la verificación manual en iPhone.',
      'El trámite de WhatsApp Business depende del cliente y puede tardar: conviene empezarlo ya.',
      'Hay cuatro decisiones que tomamos de forma conservadora y necesitamos confirmar (tabla abajo).',
    ],
    show: ['Diapositivas 12 y 13. Anota abajo cada respuesta con responsable y fecha.'],
    key: 'Pedir una respuesta concreta para cada decisión, con responsable y fecha.',
    decisions: [
      [
        'Traslados',
        'Los puntos cuentan para la farmacia donde la persona jugó; al trasladarse no se los lleva.',
      ],
      [
        'Anti-trampa',
        'Mínimo 800 ms por respuesta y 1,5 s por pregunta, racha de 5 perfectas, 10 partidas por hora; ajustables por país.',
      ],
      [
        'Textos legales',
        'Los consentimientos son de ejemplo: los debe revisar el área legal de cada país.',
      ],
      [
        'Ganadores',
        'Top 10 individual y top 10 por farmacia por periodo; la logística de premios queda fuera del MVP.',
      ],
    ],
    qa: [],
  },
  {
    id: 'preguntas',
    title: 'Preguntas y cierre',
    minutes: 2,
    goal: 'Cerrar con el siguiente paso claro.',
    say: [
      'Siguiente paso: piloto en Perú; Colombia y Ecuador se suman por configuración.',
      'Siguiente iteración: test final por marca y reportes avanzados, para demostrar el aumento de conocimiento.',
      'Todos los videos por país y sección quedan en el archivo de entrega para que el cliente los revise con calma.',
    ],
    show: ['Diapositiva 14.'],
    key: 'El producto ya funciona de punta a punta; lo que falta es salida a producción y decisiones del cliente.',
    qa: [
      [
        '¿Cuándo puede empezar el piloto?',
        'Cuando estén la mensajería real y la infraestructura en la nube; la estimación se acuerda con el equipo según las respuestas de hoy.',
      ],
      [
        '¿Los datos personales están protegidos?',
        'Consentimiento versionado por país, documento guardado cifrado, teléfonos enmascarados en el panel, sin datos personales en los logs, y exportaciones solo para roles autorizados y auditadas.',
      ],
    ],
  },
];

const COUNTRIES = [
  ['PE', 'Perú'],
  ['CO', 'Colombia'],
  ['EC', 'Ecuador'],
];

function videoIds(block) {
  return (block.videos ?? [])
    .map((v) => (v.startsWith('G-') ? [v] : COUNTRIES.map(([c]) => `${c}-${v}`)))
    .flat();
}

function blockHtml(b, i, total) {
  const vids = b.videos ?? [];
  const chips = vids
    .map((v, k) => {
      const sample = byId[v.startsWith('G-') ? v : `PE-${v}`];
      return `<button type="button" class="chip" data-video="${esc(v)}" aria-pressed="${k === 0}">${k + 1}. ${esc(sample?.title ?? v)}</button>`;
    })
    .join('');
  const player = vids.length
    ? `<div class="stage"><div class="chips" role="group" aria-label="Videos del bloque">${chips}</div>
       <div class="player"><video controls playsinline preload="none"></video></div>
       <p class="vcap"></p></div>`
    : '';
  const list = (items) => `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  const decisions = b.decisions
    ? `<div class="box"><h3>Decisiones del cliente</h3><div class="table"><table><thead><tr><th style="width:16%">Tema</th><th style="width:44%">Propuesta actual</th><th style="width:40%">Respuesta del cliente</th></tr></thead><tbody>
      ${b.decisions.map(([t, p], k) => `<tr><td><b>${esc(t)}</b></td><td>${esc(p)}</td><td><textarea id="dec-${k}" class="note" rows="3" placeholder="Respuesta, responsable y fecha"></textarea></td></tr>`).join('')}
      </tbody></table></div></div>`
    : '';
  const qa = b.qa.length
    ? `<div class="box"><h3>Preguntas probables</h3>${b.qa.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>`
    : '';
  return `<section class="block" id="b-${b.id}" data-block="${i}" data-minutes="${b.minutes}" data-videos="${esc(vids.join(','))}">
  <header class="bhead">
    <span class="step">${i === 0 ? 'Preparación' : `Bloque ${i} de ${total - 1}`}${b.minutes ? ` · ${b.minutes} min` : ''}</span>
    <h2>${esc(b.title)}</h2>
    <p class="goal">${esc(b.goal)}</p>
  </header>
  ${player}
  <div class="cols">
    <div class="box say"><h3>Qué decir</h3>${list(b.say)}</div>
    <div class="side">
      <div class="box"><h3>Qué señalar</h3>${list(b.show)}</div>
      <div class="key"><span>Mensaje clave</span><p>${esc(b.key)}</p></div>
    </div>
  </div>
  ${decisions}
  ${qa}
</section>`;
}

function page(mode) {
  const ids = [...new Set(BLOCKS.flatMap(videoIds))].filter((id) => byId[id]);
  const meta = Object.fromEntries(
    ids.map((id) => [
      id,
      { title: byId[id].title, summary: byId[id].summary, w: byId[id].width, h: byId[id].height },
    ]),
  );
  const total = BLOCKS.length;
  const minutes = BLOCKS.reduce((a, b) => a + b.minutes, 0);
  const embedded =
    mode === 'single'
      ? `<script id="embedded-videos" type="application/json">${JSON.stringify(Object.fromEntries(ids.map((id) => [id, readFileSync(join(VIDEOS, `${id}.mp4`)).toString('base64')])))}</script>
<script id="embedded-posters" type="application/json">${JSON.stringify(Object.fromEntries(ids.map((id) => [id, readFileSync(join(VIDEOS, `${id}.jpg`)).toString('base64')])))}</script>`
      : '';
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Guía demo MVP</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap">
<style>
/* Layout: barra superior fija con controles del presentador; índice lateral de bloques; cada bloque = video arriba, guion en dos columnas, preguntas. En modo presentación se ve un bloque a la vez. */
:root {
  --bg: #f5f7fb; --surface: #ffffff; --fg: #131b31; --muted: #55607a; --line: #dde3ef;
  --accent: #1d4ed8; --accent-soft: #e7eeff; --ink: #0f1f4d; --sun: #facc15; --sun-soft: #fff6cc; --warn: #a15500;
  --display: "Space Grotesk", "Segoe UI", system-ui, sans-serif; --body: "Inter", "Segoe UI", system-ui, sans-serif;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0c1120; --surface: #151b2d; --fg: #e8edf7; --muted: #9aa6c0; --line: #283048;
  --accent: #8db0ff; --accent-soft: #1b2648; --ink: #0a1430; --sun: #facc15; --sun-soft: #3a3210; --warn: #f1b75c; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #0c1120; --surface: #151b2d; --fg: #e8edf7; --muted: #9aa6c0; --line: #283048;
  --accent: #8db0ff; --accent-soft: #1b2648; --ink: #0a1430; --sun: #facc15; --sun-soft: #3a3210; --warn: #f1b75c; color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; }
body { background: var(--bg); color: var(--fg); font: 16px/1.55 var(--body); }
h1, h2, h3 { font-family: var(--display); margin: 0; text-wrap: balance; letter-spacing: -0.01em; }
p { margin: 0; }
button { font: inherit; }
.bar { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 10; background: var(--ink); color: #fff;
  padding-block: 10px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
  display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 11; background: var(--ink); }
.bar h1 { font-size: 1.05rem; font-weight: 600; margin-right: auto; }
.bar h1 small { display: block; font: 500 .74rem var(--body); color: #9dbcff; letter-spacing: .06em; text-transform: uppercase; }
.seg { display: inline-flex; background: rgba(255,255,255,.08); border-radius: 10px; padding: 3px; }
.seg button { border: 0; background: transparent; color: #c7d6ff; padding: 8px 12px; border-radius: 8px; cursor: pointer; min-height: 40px; font-weight: 600; }
.seg button[aria-pressed="true"] { background: #fff; color: #0f1f4d; }
.ctl { border: 1px solid rgba(255,255,255,.25); background: transparent; color: #fff; border-radius: 10px; padding: 8px 12px; min-height: 40px; cursor: pointer; font-weight: 600; }
.ctl.primary { background: var(--sun); color: #0f1f4d; border-color: var(--sun); }
.timer { font-variant-numeric: tabular-nums; font-family: var(--display); font-size: 1.15rem; min-width: 7.5ch; text-align: center; }
.timer.over { color: var(--sun); }
.layout { max-width: 1240px; margin: 0 auto; display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 28px;
  padding-block: 24px 64px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
nav.toc { position: sticky; top: 84px; align-self: start; display: grid; gap: 4px; }
nav.toc a { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 10px 12px; border-radius: 10px; color: var(--fg); text-decoration: none; min-height: 44px; align-items: center; }
nav.toc a span { color: var(--muted); font-size: .85rem; font-variant-numeric: tabular-nums; }
nav.toc a[aria-current="true"] { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
nav.toc .total { margin-top: 8px; padding: 10px 12px; color: var(--muted); font-size: .88rem; border-top: 1px solid var(--line); }
main { display: grid; gap: 36px; min-width: 0; }
.block { display: grid; gap: 18px; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 24px; scroll-margin-top: 84px; min-width: 0; }
.step { font: 600 .78rem var(--body); letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
.bhead { display: grid; gap: 6px; }
.bhead h2 { font-size: 1.7rem; }
.goal { color: var(--muted); font-size: 1.05rem; max-width: 70ch; }
.stage { display: grid; gap: 10px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { border: 1px solid var(--line); background: var(--bg); color: var(--fg); border-radius: 999px; padding: 7px 14px; cursor: pointer; min-height: 40px; font-size: .92rem; }
.chip[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
:root[data-theme="dark"] .chip[aria-pressed="true"] { color: #0c1120; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .chip[aria-pressed="true"] { color: #0c1120; } }
.player { background: #0b1022; border-radius: 12px; display: grid; place-items: center; overflow: hidden; }
.player video { display: block; max-width: 100%; max-height: 62vh; width: auto; background: #0b1022; }
.vcap { color: var(--muted); font-size: .94rem; }
.cols { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 18px; }
.side { display: grid; gap: 18px; align-content: start; }
.box { border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; display: grid; gap: 10px; align-content: start; min-width: 0; }
.box h3 { font-size: 1rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-family: var(--body); font-weight: 600; }
.box ul { margin: 0; padding-left: 1.15em; display: grid; gap: 8px; }
.say li { font-size: 1.04rem; }
.key { background: var(--sun-soft); border-left: 5px solid var(--sun); border-radius: 10px; padding: 14px 16px; display: grid; gap: 4px; }
.key span { font: 600 .74rem var(--body); letter-spacing: .08em; text-transform: uppercase; color: var(--warn); }
.key p { font-weight: 600; }
details { border-top: 1px solid var(--line); padding: 10px 0; }
details:first-of-type { border-top: 0; }
summary { cursor: pointer; font-weight: 600; min-height: 32px; }
details p { color: var(--muted); margin-top: 6px; }
.table { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; min-width: 640px; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: .76rem; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
textarea.note { width: 100%; min-height: 44px; border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font: inherit; background: var(--bg); color: var(--fg); resize: vertical; }
.notes { display: grid; gap: 10px; }
.notes textarea { min-height: 120px; }
.notes .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.notes .row button { border: 1px solid var(--line); background: var(--bg); color: var(--fg); border-radius: 8px; padding: 8px 12px; min-height: 40px; cursor: pointer; font-weight: 600; }
.hint { color: var(--muted); font-size: .88rem; }
kbd { font: .8rem/1 ui-monospace, monospace; border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 5px; padding: 2px 6px; background: var(--bg); }
/* Modo presentación: un bloque a la vez, más grande. */
body.present .layout { grid-template-columns: minmax(0, 1fr); max-width: 1320px; }
body.present nav.toc { display: none; }
body.present .block { display: none; font-size: 1.12rem; }
body.present .block.current { display: grid; }
body.present .bhead h2 { font-size: 2.2rem; }
body.present .player video { max-height: 68vh; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (max-width: 900px) {
  .layout { grid-template-columns: minmax(0, 1fr); }
  nav.toc { position: static; grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr)); }
  .cols { grid-template-columns: minmax(0, 1fr); }
  .bar h1 { flex-basis: 100%; }
}
</style>
</head>
<body>
<header class="bar">
  <h1><small>Guía de presentación</small>MVP Juega y aprende</h1>
  <div class="seg" role="group" aria-label="País de los videos">
    ${COUNTRIES.map(([c, n], k) => `<button type="button" data-country="${c}" aria-pressed="${k === 0}">${n}</button>`).join('')}
  </div>
  <button type="button" class="ctl" id="prev" aria-label="Bloque anterior">←</button>
  <button type="button" class="ctl" id="next" aria-label="Bloque siguiente">→</button>
  <span class="timer" id="timer" title="Tiempo en el bloque / planificado">0:00</span>
  <button type="button" class="ctl" id="tplay">Cronómetro</button>
  <button type="button" class="ctl primary" id="mode">Modo presentación</button>
</header>
<div class="layout">
  <nav class="toc" aria-label="Bloques">
    ${BLOCKS.map((b, i) => `<a href="#b-${b.id}" data-goto="${i}"><b>${i === 0 ? 'Preparación' : `${i}. ${esc(b.title)}`}</b><span>${b.minutes ? `${b.minutes} min` : ''}</span></a>`).join('')}
    <p class="total">Total: ${minutes} minutos · <kbd>P</kbd> presentar · <kbd>←</kbd> <kbd>→</kbd> bloques · <kbd>T</kbd> cronómetro</p>
  </nav>
  <main>
    ${BLOCKS.map((b, i) => blockHtml(b, i, total)).join('\n')}
    <section class="block" id="b-notas" data-block="${total}" data-minutes="0">
      <header class="bhead"><span class="step">Después de la reunión</span><h2>Notas de la reunión</h2>
      <p class="goal">Anota acuerdos y pendientes. Se guardan en este navegador; copia el resumen para enviarlo.</p></header>
      <div class="box notes"><textarea id="meeting-notes" class="note" placeholder="Acuerdos, responsables y fechas…"></textarea>
        <div class="row"><button type="button" id="copy">Copiar resumen</button><span class="hint" id="copied" role="status"></span></div></div>
    </section>
  </main>
</div>
${embedded}
<script>
(() => {
  const META = ${JSON.stringify(meta)};
  const SINGLE = ${mode === 'single'};
  const blocks = [...document.querySelectorAll('.block')];
  const toc = [...document.querySelectorAll('nav.toc a')];
  let country = 'PE';
  let current = 0;
  const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

  // ── Videos: por bloque, con selector de país ──
  let blobs = null, posters = null;
  const urlCache = {};
  function srcFor(id) {
    if (!SINGLE) return 'videos/' + id + '.mp4';
    if (urlCache[id]) return urlCache[id];
    blobs ??= JSON.parse(document.getElementById('embedded-videos').textContent);
    const bin = atob(blobs[id]); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return (urlCache[id] = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' })));
  }
  function posterFor(id) {
    if (!SINGLE) return 'videos/' + id + '.jpg';
    posters ??= JSON.parse(document.getElementById('embedded-posters').textContent);
    return 'data:image/jpeg;base64,' + posters[id];
  }
  function resolveId(v) { return v.startsWith('G-') ? v : country + '-' + v; }
  function setVideo(block, v, play) {
    const video = block.querySelector('video'); if (!video) return;
    block.dataset.selected = v;
    block.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.video === v)));
    const id = resolveId(v); const m = META[id]; if (!m) return;
    video.pause();
    video.removeAttribute('src'); video.load();
    video.poster = posterFor(id);
    video.style.aspectRatio = m.w + ' / ' + m.h;
    video.dataset.id = id;
    block.querySelector('.vcap').textContent = m.summary;
    if (play) { video.src = srcFor(id); video.play().catch(() => {}); }
  }
  document.querySelectorAll('.block[data-videos]').forEach((b) => {
    const list = b.dataset.videos.split(',').filter(Boolean);
    if (list.length) setVideo(b, list[0], false);
    b.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => setVideo(b, c.dataset.video, true)));
    const video = b.querySelector('video');
    if (video) video.addEventListener('play', () => { if (!video.getAttribute('src')) { video.src = srcFor(video.dataset.id); video.play().catch(() => {}); } });
  });
  document.addEventListener('play', (e) => document.querySelectorAll('video').forEach((v) => { if (v !== e.target) v.pause(); }), true);
  document.querySelectorAll('[data-country]').forEach((btn) => btn.addEventListener('click', () => {
    country = btn.dataset.country;
    document.querySelectorAll('[data-country]').forEach((x) => x.setAttribute('aria-pressed', String(x === btn)));
    document.querySelectorAll('.block[data-videos]').forEach((b) => { if (b.dataset.selected) setVideo(b, b.dataset.selected, false); });
  }));

  // ── Navegación por bloques (#b-id), modo presentación y cronómetro ──
  let elapsed = 0, running = false, tick = null;
  const timer = document.getElementById('timer');
  const fmt = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  function paint() {
    const plan = Number(blocks[current].dataset.minutes) * 60;
    timer.textContent = fmt(elapsed) + (plan ? ' / ' + fmt(plan) : '');
    timer.classList.toggle('over', plan > 0 && elapsed > plan);
  }
  function go(i, push = true) {
    current = Math.max(0, Math.min(blocks.length - 1, i));
    blocks.forEach((b, k) => b.classList.toggle('current', k === current));
    toc.forEach((a, k) => a.setAttribute('aria-current', String(k === current)));
    document.querySelectorAll('video').forEach((v) => v.pause());
    elapsed = 0; paint();
    if (push) history.replaceState(null, '', '#' + blocks[current].id);
    if (document.body.classList.contains('present')) window.scrollTo({ top: 0 });
    else blocks[current].scrollIntoView({ block: 'start' });
  }
  document.getElementById('prev').addEventListener('click', () => go(current - 1));
  document.getElementById('next').addEventListener('click', () => go(current + 1));
  toc.forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); go(Number(a.dataset.goto)); }));
  const modeBtn = document.getElementById('mode');
  function setMode(on) {
    document.body.classList.toggle('present', on);
    modeBtn.textContent = on ? 'Ver todo' : 'Modo presentación';
    go(current, false);
  }
  modeBtn.addEventListener('click', () => setMode(!document.body.classList.contains('present')));
  const tplay = document.getElementById('tplay');
  function toggleTimer() {
    running = !running; tplay.textContent = running ? 'Pausar' : 'Cronómetro';
    clearInterval(tick); if (running) tick = setInterval(() => { elapsed++; paint(); }, 1000);
  }
  tplay.addEventListener('click', toggleTimer);
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('textarea, input, select')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(current + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(current - 1); }
    else if (e.key === 'p' || e.key === 'P') setMode(!document.body.classList.contains('present'));
    else if (e.key === 't' || e.key === 'T') toggleTimer();
  });
  // Al desplazarse en modo lectura, el índice marca el bloque visible.
  const io = new IntersectionObserver((entries) => {
    if (document.body.classList.contains('present')) return;
    entries.forEach((en) => { if (en.isIntersecting) { current = blocks.indexOf(en.target); toc.forEach((a, k) => a.setAttribute('aria-current', String(k === current))); paint(); } });
  }, { rootMargin: '-40% 0px -55% 0px' });
  blocks.forEach((b) => io.observe(b));
  const start = blocks.findIndex((b) => '#' + b.id === location.hash);
  go(start >= 0 ? start : 0, false);

  // ── Notas (solo en este navegador) ──
  document.querySelectorAll('textarea.note').forEach((t) => {
    const key = 'guia-mvp:' + t.id;
    t.value = safe(() => localStorage.getItem(key) ?? '', '');
    t.addEventListener('input', () => safe(() => localStorage.setItem(key, t.value)));
  });
  document.getElementById('copy').addEventListener('click', () => {
    const rows = [...document.querySelectorAll('[id^="dec-"]')].map((t) => {
      const tr = t.closest('tr'); return '- ' + tr.cells[0].innerText.trim() + ': ' + (t.value.trim() || '(sin respuesta)');
    });
    const text = 'Demo MVP Juega y aprende — acuerdos\\n\\nDecisiones del cliente:\\n' + rows.join('\\n') + '\\n\\nNotas:\\n' + document.getElementById('meeting-notes').value.trim();
    const done = (msg) => { document.getElementById('copied').textContent = msg; };
    navigator.clipboard?.writeText(text).then(() => done('Resumen copiado.'), () => { const n = document.getElementById('meeting-notes'); n.value = text; n.select(); done('Selecciona y copia el texto.'); })
      ?? done('Selecciona y copia el texto.');
  });
})();
</script>
</body>
</html>`;
}

writeFileSync(join(OUT, 'guia-presentacion.html'), page('single'));
writeFileSync(join(OUT, 'web', 'index.html'), page('web'));
console.log('guia-presentacion.html y web/index.html listos');
