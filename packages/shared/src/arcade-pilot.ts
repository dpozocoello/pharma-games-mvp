import type { ExperimentGroup, GameStyle } from './arcade';
import { localDay } from './time';

/**
 * Indicadores del piloto arcade (ADR-034, criterios del documento de aprobación). Función pura:
 * la API le pasa las partidas del periodo y devuelve una fila por grupo y estilo, más el total
 * de cada grupo (`style = 'ALL'`).
 */
export interface PilotSessionRow {
  userId: string;
  style: GameStyle;
  experimentGroup: ExperimentGroup;
  status: 'IN_PROGRESS' | 'FINISHED' | 'EXPIRED';
  startedAt: Date;
  finishedAt: Date | null;
  expiresAt: Date;
  questionCount: number;
  correctCount: number;
  score: number | null;
}

export interface PilotSummaryRow {
  group: ExperimentGroup;
  style: GameStyle | 'ALL';
  /** Dependientes con al menos una partida terminada en la ventana. */
  activeClerks: number;
  sessionsStarted: number;
  sessionsFinished: number;
  /** Partidas que vencieron sin terminar ÷ partidas ya resueltas (sin contar las que siguen en curso). */
  abandonPct: number;
  sessionsPerActivePerWeek: number;
  /** Respuestas correctas ÷ preguntas de partidas terminadas. */
  accuracyPct: number;
  /** De quienes jugaron, % que volvió otro día dentro de los 7 días siguientes a su primera partida. */
  return7dPct: number;
  avgSessionSeconds: number;
  pointsAwarded: number;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function summarizeArcadePilot(
  sessions: readonly PilotSessionRow[],
  window: { from: Date; to: Date },
  timezone: string,
  now: Date = new Date(),
): PilotSummaryRow[] {
  const weeks = Math.max(1, (window.to.getTime() - window.from.getTime()) / (7 * 86_400_000));
  const inWindow = sessions.filter((s) => s.startedAt >= window.from && s.startedAt < window.to);
  const out: PilotSummaryRow[] = [];

  const summarize = (group: ExperimentGroup, style: GameStyle | 'ALL', rows: PilotSessionRow[]) => {
    const finished = rows.filter((s) => s.status === 'FINISHED');
    const abandoned = rows.filter(
      (s) => s.status === 'EXPIRED' || (s.status === 'IN_PROGRESS' && s.expiresAt <= now),
    );
    const resolved = finished.length + abandoned.length;
    const active = new Set(finished.map((s) => s.userId));
    const questions = finished.reduce((a, s) => a + s.questionCount, 0);
    const correct = finished.reduce((a, s) => a + s.correctCount, 0);
    const seconds = finished.reduce(
      (a, s) => a + ((s.finishedAt ?? s.startedAt).getTime() - s.startedAt.getTime()) / 1000,
      0,
    );

    // Retorno a 7 días: otra partida terminada en un día local distinto, dentro de 7 días.
    const byUser = new Map<string, Date[]>();
    for (const s of finished) byUser.set(s.userId, [...(byUser.get(s.userId) ?? []), s.startedAt]);
    let returned = 0;
    for (const dates of byUser.values()) {
      const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
      const first = sorted[0]!;
      const firstDay = localDay(first, timezone);
      const limit = first.getTime() + 7 * 86_400_000;
      if (sorted.some((d) => d.getTime() <= limit && localDay(d, timezone) !== firstDay))
        returned++;
    }

    out.push({
      group,
      style,
      activeClerks: active.size,
      sessionsStarted: rows.length,
      sessionsFinished: finished.length,
      abandonPct: resolved ? round((abandoned.length / resolved) * 100) : 0,
      sessionsPerActivePerWeek: active.size ? round(finished.length / active.size / weeks) : 0,
      accuracyPct: questions ? round((correct / questions) * 100) : 0,
      return7dPct: active.size ? round((returned / active.size) * 100) : 0,
      avgSessionSeconds: finished.length ? round(seconds / finished.length, 1) : 0,
      pointsAwarded: finished.reduce((a, s) => a + (s.score ?? 0), 0),
    });
  };

  for (const group of ['CONTROL', 'ARCADE'] as const) {
    const rows = inWindow.filter((s) => s.experimentGroup === group);
    summarize(group, 'ALL', rows);
    for (const style of ['CLASSIC', 'PLATFORM', 'LAUNCH'] as const) {
      const byStyle = rows.filter((s) => s.style === style);
      if (byStyle.length) summarize(group, style, byStyle);
    }
  }
  return out;
}

/** Diferencias del grupo arcade contra el control, para los criterios de decisión. */
export function pilotVerdict(rows: readonly PilotSummaryRow[]) {
  const ctl = rows.find((r) => r.group === 'CONTROL' && r.style === 'ALL');
  const arc = rows.find((r) => r.group === 'ARCADE' && r.style === 'ALL');
  if (!ctl || !arc || !ctl.activeClerks || !arc.activeClerks) return null;
  const sessionsLiftPct = ctl.sessionsPerActivePerWeek
    ? round(
        ((arc.sessionsPerActivePerWeek - ctl.sessionsPerActivePerWeek) /
          ctl.sessionsPerActivePerWeek) *
          100,
      )
    : 0;
  const accuracyDeltaPts = round(arc.accuracyPct - ctl.accuracyPct);
  const return7dDeltaPts = round(arc.return7dPct - ctl.return7dPct);
  return {
    sessionsLiftPct,
    accuracyDeltaPts,
    return7dDeltaPts,
    arcadeAbandonPct: arc.abandonPct,
    meetsCriteria: sessionsLiftPct >= 20 && accuracyDeltaPts >= -3 && arc.abandonPct < 15,
  };
}
