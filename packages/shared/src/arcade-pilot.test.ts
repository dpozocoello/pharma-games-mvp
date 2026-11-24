import { describe, expect, it } from 'vitest';
import { pilotVerdict, summarizeArcadePilot, type PilotSessionRow } from './arcade-pilot';
import { startSessionBodySchema } from './arcade';

const TZ = 'America/Lima';
const from = new Date('2026-12-01T05:00:00Z');
const to = new Date('2026-12-15T05:00:00Z'); // 2 semanas
const now = new Date('2026-12-20T00:00:00Z');
const at = (iso: string) => new Date(iso);

function s(
  p: Partial<PilotSessionRow> & Pick<PilotSessionRow, 'userId' | 'experimentGroup' | 'startedAt'>,
): PilotSessionRow {
  return {
    style: p.experimentGroup === 'ARCADE' ? 'PLATFORM' : 'CLASSIC',
    status: 'FINISHED',
    finishedAt: new Date(p.startedAt.getTime() + 180_000),
    expiresAt: new Date(p.startedAt.getTime() + 600_000),
    questionCount: 10,
    correctCount: 7,
    score: 80,
    ...p,
  };
}

describe('indicadores del piloto arcade', () => {
  const rows = [
    // Control: 2 dependientes, 1 vuelve otro día
    s({ userId: 'c1', experimentGroup: 'CONTROL', startedAt: at('2026-12-02T15:00:00Z') }),
    s({ userId: 'c1', experimentGroup: 'CONTROL', startedAt: at('2026-12-04T15:00:00Z') }),
    s({ userId: 'c2', experimentGroup: 'CONTROL', startedAt: at('2026-12-02T16:00:00Z') }),
    // Arcade: 2 dependientes, ambos vuelven; uno usa lanzamiento; una partida abandonada
    s({
      userId: 'a1',
      experimentGroup: 'ARCADE',
      startedAt: at('2026-12-02T15:00:00Z'),
      correctCount: 6,
    }),
    s({
      userId: 'a1',
      experimentGroup: 'ARCADE',
      startedAt: at('2026-12-03T15:00:00Z'),
      correctCount: 6,
    }),
    s({
      userId: 'a1',
      experimentGroup: 'ARCADE',
      startedAt: at('2026-12-05T15:00:00Z'),
      correctCount: 6,
    }),
    s({
      userId: 'a2',
      experimentGroup: 'ARCADE',
      style: 'LAUNCH',
      startedAt: at('2026-12-02T15:00:00Z'),
      correctCount: 6,
    }),
    s({
      userId: 'a2',
      experimentGroup: 'ARCADE',
      style: 'LAUNCH',
      startedAt: at('2026-12-08T15:00:00Z'),
      correctCount: 6,
    }),
    s({
      userId: 'a2',
      experimentGroup: 'ARCADE',
      status: 'EXPIRED',
      finishedAt: null,
      startedAt: at('2026-12-09T15:00:00Z'),
    }),
    // Fuera de la ventana: no cuenta
    s({ userId: 'c2', experimentGroup: 'CONTROL', startedAt: at('2026-12-16T15:00:00Z') }),
    // En curso y aún vigente: no cuenta como abandono
    s({
      userId: 'c2',
      experimentGroup: 'CONTROL',
      status: 'IN_PROGRESS',
      finishedAt: null,
      startedAt: at('2026-12-14T15:00:00Z'),
      expiresAt: at('2026-12-30T00:00:00Z'),
    }),
  ];
  const out = summarizeArcadePilot(rows, { from, to }, TZ, now);
  const ctl = out.find((r) => r.group === 'CONTROL' && r.style === 'ALL')!;
  const arc = out.find((r) => r.group === 'ARCADE' && r.style === 'ALL')!;

  it('cuenta activos, partidas por activo por semana y aciertos', () => {
    expect(ctl).toMatchObject({
      activeClerks: 2,
      sessionsStarted: 4,
      sessionsFinished: 3,
      accuracyPct: 70,
    });
    expect(ctl.sessionsPerActivePerWeek).toBe(0.75); // 3 ÷ 2 ÷ 2 semanas
    expect(arc).toMatchObject({ activeClerks: 2, sessionsFinished: 5, accuracyPct: 60 });
    expect(arc.sessionsPerActivePerWeek).toBe(1.25);
  });

  it('abandono solo con partidas resueltas; retorno a 7 días por día local', () => {
    expect(ctl.abandonPct).toBe(0);
    expect(arc.abandonPct).toBe(16.67); // 1 de 6
    expect(ctl.return7dPct).toBe(50);
    expect(arc.return7dPct).toBe(100);
    expect(arc.avgSessionSeconds).toBe(180);
  });

  it('desglosa por estilo dentro de cada grupo', () => {
    expect(out.find((r) => r.group === 'ARCADE' && r.style === 'LAUNCH')).toMatchObject({
      sessionsFinished: 2,
    });
    expect(out.find((r) => r.group === 'ARCADE' && r.style === 'PLATFORM')).toMatchObject({
      sessionsFinished: 3,
    });
    expect(out.some((r) => r.group === 'CONTROL' && r.style === 'PLATFORM')).toBe(false);
  });

  it('veredicto: compara con los criterios del documento de aprobación', () => {
    const v = pilotVerdict(out)!;
    expect(v.sessionsLiftPct).toBe(66.67);
    expect(v.accuracyDeltaPts).toBe(-10);
    expect(v.meetsCriteria).toBe(false); // aciertos caen más de 3 puntos y abandono ≥ 15 %
    expect(pilotVerdict([])).toBeNull();
  });

  it('una partida el mismo día local no cuenta como retorno', () => {
    const sameDay = summarizeArcadePilot(
      [
        s({ userId: 'x', experimentGroup: 'CONTROL', startedAt: at('2026-12-02T14:00:00Z') }),
        s({ userId: 'x', experimentGroup: 'CONTROL', startedAt: at('2026-12-03T04:00:00Z') }), // 23:00 en Lima
      ],
      { from, to },
      TZ,
      now,
    );
    expect(sameDay[0]!.return7dPct).toBe(0);
  });
});

describe('cuerpo de inicio de partida', () => {
  it('vacío equivale a sin estilo (el servidor elige el de la persona)', () => {
    expect(startSessionBodySchema.parse(undefined)).toEqual({});
    expect(startSessionBodySchema.parse('')).toEqual({});
  });
});
