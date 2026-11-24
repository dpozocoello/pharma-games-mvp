/**
 * Demo jugable de los estilos arcade (ADR-033), SIN servidor. Solo para mostrar la experiencia:
 * aquí un «transporte simulado» del navegador corrige con una clave de demostración. En la
 * aplicación real las preguntas llegan sin la respuesta correcta y el servidor puntúa.
 * Marca y preguntas ficticias (CLAUDE.md §4.7).
 */
import { createGameContext, type GameModule, type GameResult } from '@pharma/game-sdk';
import launchGame from '@pharma/game-launch';
import platformGame from '@pharma/game-platform';
import triviaGame from '@pharma/game-trivia';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mc = (n: number, prompt: string, opts: string[]) => ({
  id: uid(n),
  type: 'MULTIPLE_CHOICE' as const,
  prompt,
  options: opts.map((text, i) => ({ id: 'abcd'[i]!, text })),
});
const tf = (n: number, prompt: string) => ({
  id: uid(n),
  type: 'TRUE_FALSE' as const,
  prompt,
  options: [
    { id: 'true', text: 'Verdadero' },
    { id: 'false', text: 'Falso' },
  ],
});

const QUESTIONS = [
  mc(1, '¿Qué presentación tiene la Marca A de la demo?', [
    'Jarabe de 120 ml',
    'Tabletas x 10',
    'Gel de 30 g',
    'Gotas de 15 ml',
  ]),
  tf(2, 'La Marca A de la demo se recomienda con el empaque cerrado y en lugar fresco.'),
  mc(3, '¿Cuál es el color del empaque de la Marca A (demo)?', [
    'Azul',
    'Verde',
    'Naranja',
    'Morado',
  ]),
  tf(4, 'La Marca A (demo) viene en sobres individuales.'),
  mc(5, '¿Qué frase acompaña a la Marca A en la demo?', [
    '«Siempre a la mano»',
    '«Fuerza total»',
    '«Noche tranquila»',
  ]),
];
/** Clave SOLO de la demo; en producción nunca llega al celular. */
const DEMO_KEY: Record<string, string> = {
  [uid(1)]: 'b',
  [uid(2)]: 'true',
  [uid(3)]: 'c',
  [uid(4)]: 'false',
  [uid(5)]: 'a',
};

const GAMES: Record<string, GameModule> = {
  classic: triviaGame,
  platform: platformGame,
  launch: launchGame,
};
const theme = {
  primary: '#c2410c',
  secondary: '#0e7490',
  logoUrl: '',
  brandName: 'Marca A (demo)',
};

let handle: { unmount(): void } | null = null;
let ctxRef: { dispose(): void } | null = null;

function start(style: string) {
  handle?.unmount();
  ctxRef?.dispose();
  const answers = new Map<string, string>();
  const host = document.getElementById('game')!;
  host.innerHTML = '';
  const ctx = createGameContext({
    session: {
      id: `demo-${Date.now()}`,
      token: 'demo',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    },
    questions: QUESTIONS,
    theme,
    locale: 'es-PE',
    terms: {},
    limits: { secondsPerQuestion: 30, totalSeconds: 180 },
    transport: {
      submitAnswersBatch: async (_s, _t, batch) => {
        for (const a of batch) answers.set(a.questionId, a.answer);
      },
      finishSession: async (): Promise<GameResult> => {
        const correct = QUESTIONS.filter((q) => answers.get(q.id) === DEMO_KEY[q.id]).length;
        return { score: correct * 10, correct, total: QUESTIONS.length, dailyCapReached: false };
      },
    },
  });
  ctxRef = ctx;
  handle = GAMES[style]!.mount(host, ctx);
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-style]'))
    b.setAttribute('aria-pressed', String(b.dataset.style === style));
}

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-style]'))
  b.addEventListener('click', () => start(b.dataset.style!));
start(new URLSearchParams(location.search).get('style') ?? 'platform');
