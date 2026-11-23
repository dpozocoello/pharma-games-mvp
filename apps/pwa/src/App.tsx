import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createGameContext, type GameHandle, type GameModule } from '@pharma/game-sdk';
import {
  t,
  type Identifier,
  type MeResponse,
  type PendingKnowledgeTest,
  type PublicCountry,
  type RankingQueryScope,
  type StartedGameSessionResponse,
} from '@pharma/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  acceptConsent,
  ApiHttpError,
  fetchCountries,
  fetchGamesCatalog,
  fetchManagerPharmacySummary,
  fetchMyRankingAndProfile,
  fetchPendingTests,
  fetchRankings,
  finishGameSession,
  logoutSession,
  onSessionTokenChange,
  refreshSession,
  setSessionToken,
  requestOtp,
  startGameSession,
  submitKnowledgeTest,
  submitSessionAnswersBatch,
  verifyOtp,
} from './api';
import { readChosenCountry, saveChosenCountry } from './country';
import { setGameInProgress } from './pwa';
import styles from './App.module.css';

const storage = typeof window !== 'undefined' ? window.localStorage : undefined;

export function App() {
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState<string | null>(() => readChosenCountry(storage));
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);

  // El token vive en api.ts (se renueva solo ante un 401); aquí solo se refleja si hay sesión.
  useEffect(
    () =>
      onSessionTokenChange((token) => {
        setAccessToken(token);
        if (!token) {
          // La sesión de 90 días terminó (o se revocó): volver al ingreso con un aviso.
          setMe((prev) => {
            if (prev) setSessionEnded(true);
            return null;
          });
        }
      }),
    [],
  );
  const [restoring, setRestoring] = useState(true);

  // Estado del formulario OTP
  const [idType, setIdType] = useState<'phone' | 'document'>('phone');
  const [idValue, setIdValue] = useState('');
  const [step, setStep] = useState<'identify' | 'verify'>('identify');
  const [otpCode, setOtpCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // Estado de juego activo (Iteración 3), navegación PWA (Iteración 5) y test inicial (Iteración 6)
  const [activeSession, setActiveSession] = useState<StartedGameSessionResponse | null>(null);
  // Mientras hay partida no se ofrece actualizar la app (recargaría a mitad del juego).
  useEffect(() => setGameInProgress(activeSession !== null), [activeSession]);
  const [activeTest, setActiveTest] = useState<PendingKnowledgeTest | null>(null);
  const [testAnswers, setTestAnswers] = useState<Record<string, string>>({});
  const [pwaSection, setPwaSection] = useState<'games' | 'rankings' | 'profile' | 'manager'>(
    'games',
  );
  const [rankingScope, setRankingScope] = useState<RankingQueryScope>('individual');
  const gameContainerRef = useRef<HTMLDivElement | null>(null);

  const countries = useQuery({ queryKey: ['countries'], queryFn: fetchCountries });

  const canPlay = Boolean(accessToken && me && (!me.consent.required || me.consent.accepted));
  const catalog = useQuery({
    queryKey: ['games-catalog', me?.id],
    queryFn: () => fetchGamesCatalog(),
    enabled: canPlay,
  });
  const pendingTestsQuery = useQuery({
    queryKey: ['pending-tests', me?.id],
    queryFn: () => fetchPendingTests(),
    enabled: canPlay,
  });
  const rankingsQuery = useQuery({
    queryKey: ['rankings', me?.id, rankingScope],
    queryFn: () => fetchRankings(rankingScope),
    enabled: canPlay && pwaSection === 'rankings',
  });
  const myProfileQuery = useQuery({
    queryKey: ['my-profile-ranking', me?.id],
    queryFn: () => fetchMyRankingAndProfile(),
    enabled: canPlay && (pwaSection === 'profile' || pwaSection === 'games'),
  });
  const managerQuery = useQuery({
    queryKey: ['manager-summary', me?.id],
    queryFn: () => fetchManagerPharmacySummary(),
    enabled: canPlay && me?.role === 'PHARMACY_MANAGER' && pwaSection === 'manager',
  });

  // Al abrir la app, intenta restaurar la sesión de 90 días vía cookie HttpOnly.
  useEffect(() => {
    let active = true;
    refreshSession()
      .then((res) => {
        if (!active || !res) return;
        setSessionToken(res.accessToken);
        setMe(res.me);
        if (res.me.country?.code) {
          saveChosenCountry(storage, res.me.country.code);
          setChosen(res.me.country.code);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setRestoring(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Montaje dinámico del módulo de juego cuando hay una sesión activa
  useEffect(() => {
    if (!activeSession || !gameContainerRef.current) return;
    const container = gameContainerRef.current;
    let handle: GameHandle | null = null;
    let cancelled = false;

    const ctx = createGameContext({
      session: activeSession.session,
      questions: activeSession.questions,
      theme: activeSession.theme,
      locale: activeSession.locale,
      terms: activeSession.terms,
      limits: activeSession.limits,
      transport: {
        submitAnswersBatch: async (sessionId, token, answers) => {
          await submitSessionAnswersBatch(sessionId, token, answers);
        },
        finishSession: async (sessionId, token) => {
          const res = await finishGameSession(sessionId, token);
          await queryClient.invalidateQueries({ queryKey: ['games-catalog'] });
          return res;
        },
      },
    });

    const loadModule = async (): Promise<GameModule> => {
      if (activeSession.game.mechanic === 'MULTIPLE_CHOICE') {
        const mod = await import('@pharma/game-trivia');
        return mod.default;
      }
      const mod = await import('@pharma/game-true-false');
      return mod.default;
    };

    void loadModule().then((mod) => {
      if (cancelled) return;
      handle = mod.mount(container, ctx);
    });

    return () => {
      cancelled = true;
      handle?.unmount();
      ctx.dispose();
    };
    // Sin `accessToken` en las dependencias: renovar el token no debe desmontar una partida en curso.
  }, [activeSession, queryClient]);

  const currentCountry: PublicCountry | undefined = countries.data?.find(
    (c) => c.code === (me?.country?.code ?? chosen),
  );
  const terms = me?.country?.terms ?? {};

  async function handleRequestOtp(e: FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setBusy(true);
    try {
      const identifier: Identifier = { type: idType, value: idValue.trim() };
      await requestOtp(chosen, identifier);
      setStep('verify');
      setInfoMsg('Te enviamos un código de 6 dígitos por WhatsApp (o SMS de respaldo).');
    } catch (err) {
      setErrorMsg(err instanceof ApiHttpError ? err.message : 'No pudimos enviar el código.');
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp(e: FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      const identifier: Identifier = { type: idType, value: idValue.trim() };
      const res = await verifyOtp(chosen, identifier, otpCode.trim());
      setSessionToken(res.accessToken);
      setSessionEnded(false);
      setMe(res.me);
      if (res.me.country?.code) {
        saveChosenCountry(storage, res.me.country.code);
        setChosen(res.me.country.code);
      }
      setOtpCode('');
      setStep('identify');
    } catch (err) {
      if (err instanceof ApiHttpError && err.problem.code === 'COUNTRY_LOCKED') {
        const locked = err.problem.lockedCountry;
        setErrorMsg(
          locked
            ? `Tu cuenta pertenece a ${locked.name} (${locked.code}) y no puede usarse en otro país.`
            : err.message,
        );
      } else {
        setErrorMsg(err instanceof ApiHttpError ? err.message : 'Código inválido.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleAcceptConsent() {
    if (!accessToken || !me?.consent.current) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      const updated = await acceptConsent({
        consentVersionId: me.consent.current.id,
      });
      setMe(updated);
      await queryClient.invalidateQueries();
    } catch (err) {
      setErrorMsg(
        err instanceof ApiHttpError ? err.message : 'No se pudo registrar el consentimiento.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleStartGame(gameId: string) {
    if (!accessToken) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      const started = await startGameSession(gameId);
      setActiveSession(started);
    } catch (err) {
      setErrorMsg(err instanceof ApiHttpError ? err.message : 'No se pudo iniciar la partida.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitKnowledgeTest(e: FormEvent) {
    e.preventDefault();
    if (!accessToken || !activeTest) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      const answers = activeTest.questions.map((q) => ({
        questionId: q.id,
        answer: testAnswers[q.id] ?? '',
      }));
      const res = await submitKnowledgeTest(activeTest.id, answers);
      setInfoMsg(
        `Test inicial de ${activeTest.brandName} completado: ${res.score}/${res.total} respuestas registradas.`,
      );
      setActiveTest(null);
      setTestAnswers({});
      await queryClient.invalidateQueries({ queryKey: ['pending-tests'] });
    } catch (err) {
      setErrorMsg(err instanceof ApiHttpError ? err.message : 'No se pudo enviar el test.');
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    try {
      await logoutSession();
    } finally {
      setActiveSession(null);
      setSessionToken(null);
      setMe(null);
      setStep('identify');
      setOtpCode('');
      setErrorMsg(null);
      setInfoMsg(null);
      setBusy(false);
    }
  }

  if (restoring) {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>{t('app.title')}</h1>
        <p className={styles.muted}>Verificando sesión…</p>
      </main>
    );
  }

  // 1) Sesión iniciada: verificar si requiere consentimiento vigente del país
  if (me && accessToken) {
    if (me.consent.required && !me.consent.accepted) {
      return (
        <main className={styles.page}>
          <h1 className={styles.title}>Consentimiento de datos</h1>
          <section className={styles.card} aria-labelledby="consent-heading">
            <h2 id="consent-heading" className={styles.subtitle}>
              {me.country?.name ?? 'Tu país'} — Versión {me.consent.current?.version ?? 1}
            </h2>
            <p className={styles.consentBox}>
              {me.consent.current?.text ??
                'Para participar necesitas aceptar el tratamiento de datos personales.'}
            </p>
            {errorMsg && (
              <p role="alert" className={styles.alert}>
                {errorMsg}
              </p>
            )}
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                disabled={busy || !me.consent.current}
                onClick={handleAcceptConsent}
              >
                {busy ? 'Guardando…' : 'Acepto y continuar'}
              </button>
              <button
                type="button"
                className={styles.secondary}
                disabled={busy}
                onClick={handleLogout}
              >
                Salir
              </button>
            </div>
          </section>
        </main>
      );
    }

    // 2) Si hay una partida activa, renderizar el contenedor del SDK
    if (activeSession) {
      return (
        <main className={styles.page}>
          <header className={styles.headerRow}>
            <h1 className={styles.title}>{activeSession.theme.brandName}</h1>
            <button type="button" className={styles.linkBtn} onClick={() => setActiveSession(null)}>
              Volver al catálogo
            </button>
          </header>
          <div ref={gameContainerRef} aria-live="polite" />
        </main>
      );
    }

    // 3) Pantalla de inicio del dependiente / gerente con catálogo de juegos y marcas pendientes
    return (
      <main className={styles.page}>
        <header className={styles.headerRow}>
          <h1 className={styles.title}>{t('app.title', terms)}</h1>
          <span className={styles.badge} title="País fijado a tu cuenta">
            {me.country?.name ?? me.country?.code} (fijo)
          </span>
        </header>

        <section
          className={styles.card}
          aria-label="Resumen de cuenta"
          style={{ marginBottom: 16 }}
        >
          <h2 className={styles.subtitle}>Hola, {me.displayName}</h2>
          <dl className={styles.metaList}>
            <div>
              <dt>Rol</dt>
              <dd>{me.role === 'PHARMACY_MANAGER' ? 'Gerente' : t('term.clerk', terms)}</dd>
            </div>
            <div>
              <dt>Celular</dt>
              <dd>{me.phoneMasked}</dd>
            </div>
            {me.pharmacy && (
              <div>
                <dt>{t('term.pharmacy', terms)}</dt>
                <dd>{me.pharmacy.name}</dd>
              </div>
            )}
            <div>
              <dt>País de puntuación</dt>
              <dd>
                {me.country?.name} ({me.country?.code}) — fijado a tu cuenta
              </dd>
            </div>
          </dl>

          <nav
            aria-label="Secciones de la PWA"
            style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}
          >
            <button
              type="button"
              className={pwaSection === 'games' ? styles.tabActive : styles.tab}
              style={{ flex: 1, minWidth: 90 }}
              onClick={() => setPwaSection('games')}
            >
              Juegos
            </button>
            <button
              type="button"
              className={pwaSection === 'rankings' ? styles.tabActive : styles.tab}
              style={{ flex: 1, minWidth: 90 }}
              onClick={() => setPwaSection('rankings')}
            >
              Rankings
            </button>
            <button
              type="button"
              className={pwaSection === 'profile' ? styles.tabActive : styles.tab}
              style={{ flex: 1, minWidth: 90 }}
              onClick={() => setPwaSection('profile')}
            >
              Mi Perfil
            </button>
            {me.role === 'PHARMACY_MANAGER' && (
              <button
                type="button"
                className={pwaSection === 'manager' ? styles.tabActive : styles.tab}
                style={{ flex: 1, minWidth: 90 }}
                onClick={() => setPwaSection('manager')}
              >
                Mi Equipo
              </button>
            )}
          </nav>

          <button type="button" className={styles.secondary} disabled={busy} onClick={handleLogout}>
            Cerrar sesión
          </button>
        </section>

        {errorMsg && (
          <p role="alert" className={styles.alert}>
            {errorMsg}
          </p>
        )}

        {infoMsg && (
          <p role="status" className={styles.info}>
            {infoMsg}
          </p>
        )}

        {pwaSection === 'games' && (
          <section className={styles.card} aria-label="Juegos disponibles">
            {activeTest ? (
              <form onSubmit={handleSubmitKnowledgeTest} style={{ marginBottom: 16 }}>
                <h2 className={styles.subtitle}>
                  Test inicial de conocimiento — {activeTest.brandName}
                </h2>
                <p className={styles.muted}>
                  Responde todas las preguntas para registrar tu línea base de conocimiento.
                </p>
                {activeTest.questions.map((q, idx) => (
                  <fieldset
                    key={q.id}
                    style={{
                      border: '1px solid #cbd5e1',
                      borderRadius: 8,
                      padding: 12,
                      marginBottom: 10,
                    }}
                  >
                    <legend style={{ fontWeight: 600 }}>
                      {idx + 1}. {q.prompt}
                    </legend>
                    <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                      {q.options.map((opt) => (
                        <label
                          key={opt.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            minHeight: 44,
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="radio"
                            name={`q-${q.id}`}
                            value={opt.id}
                            checked={testAnswers[q.id] === opt.id}
                            onChange={() => setTestAnswers((prev) => ({ ...prev, [q.id]: opt.id }))}
                            required
                          />
                          <span>{opt.text}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
                <div className={styles.actions}>
                  <button
                    type="submit"
                    className={styles.primary}
                    disabled={busy || activeTest.questions.some((q) => !testAnswers[q.id])}
                  >
                    {busy ? 'Enviando…' : 'Enviar test inicial'}
                  </button>
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={busy}
                    onClick={() => {
                      setActiveTest(null);
                      setTestAnswers({});
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            ) : (
              pendingTestsQuery.data &&
              pendingTestsQuery.data.tests.length > 0 && (
                <div
                  style={{
                    backgroundColor: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 16,
                  }}
                >
                  <h3 className={styles.subtitle} style={{ marginTop: 0 }}>
                    Tests iniciales pendientes ({pendingTestsQuery.data.tests.length})
                  </h3>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {pendingTestsQuery.data.tests.map((test) => (
                      <button
                        key={test.id}
                        type="button"
                        className={styles.secondary}
                        onClick={() => {
                          setTestAnswers({});
                          setActiveTest(test);
                        }}
                      >
                        Realizar test inicial: {test.brandName}
                      </button>
                    ))}
                  </div>
                </div>
              )
            )}

            <h2 className={styles.subtitle}>Juegos por marca</h2>
            {catalog.data && catalog.data.pendingBrands.length > 0 && (
              <p className={styles.muted}>
                Marcas pendientes en este periodo:{' '}
                <strong>{catalog.data.pendingBrands.map((b) => b.brandName).join(', ')}</strong>
              </p>
            )}
            <ul className={styles.list}>
              {catalog.data?.games.map((g) => {
                const limitReached = g.sessionsToday >= g.maxSessionsPerDay;
                return (
                  <li
                    key={g.id}
                    style={{
                      borderLeft: `5px solid ${g.theme.primary}`,
                      paddingLeft: 12,
                      display: 'grid',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <strong>{g.brandName}</strong>
                      <span className={styles.muted} style={{ fontSize: '0.85rem' }}>
                        {g.mechanic === 'MULTIPLE_CHOICE' ? 'Trivia' : 'Verdadero / Falso'} · Hoy:{' '}
                        {g.sessionsToday}/{g.maxSessionsPerDay}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={styles.primary}
                      style={{ backgroundColor: g.theme.primary }}
                      disabled={busy || limitReached}
                      onClick={() => handleStartGame(g.id)}
                    >
                      {limitReached ? 'Intentos diarios completados' : `Jugar ${g.brandName}`}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {pwaSection === 'rankings' && (
          <section className={styles.card} aria-label="Rankings del periodo">
            <h2 className={styles.subtitle}>Ranking del periodo actual</h2>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button
                type="button"
                className={rankingScope === 'individual' ? styles.tabActive : styles.tab}
                style={{ flex: 1 }}
                onClick={() => setRankingScope('individual')}
              >
                Individual
              </button>
              <button
                type="button"
                className={rankingScope === 'pharmacy' ? styles.tabActive : styles.tab}
                style={{ flex: 1 }}
                onClick={() => setRankingScope('pharmacy')}
              >
                {t('term.pharmacy', terms)} (Prom.)
              </button>
              <button
                type="button"
                className={rankingScope === 'country' ? styles.tabActive : styles.tab}
                style={{ flex: 1 }}
                onClick={() => setRankingScope('country')}
              >
                País
              </button>
            </div>
            <ul className={styles.list}>
              {rankingsQuery.data?.rows.map((r) => (
                <li
                  key={r.entityId}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    borderBottom: '1px solid #e2e8f0',
                    paddingBottom: 8,
                  }}
                >
                  <span>
                    <strong>#{r.position}</strong> {r.displayName}{' '}
                    {r.subtitle ? <small className={styles.muted}>({r.subtitle})</small> : null}
                  </span>
                  <strong>{r.points} pts</strong>
                </li>
              ))}
            </ul>
            {(() => {
              // Mi posición, aunque esté fuera del top que viaja al celular.
              const data = rankingsQuery.data;
              const me = data?.me;
              if (!data || !me || data.rows.some((r) => r.entityId === me.entityId)) return null;
              return (
                <p className={styles.muted} style={{ marginTop: 12 }}>
                  <strong>
                    Tu posición: #{me.position} de {data.totalRows}
                  </strong>{' '}
                  · {me.points} pts
                </p>
              );
            })()}
          </section>
        )}

        {pwaSection === 'profile' && myProfileQuery.data && (
          <section className={styles.card} aria-label="Perfil del dependiente">
            <h2 className={styles.subtitle}>Mi Perfil y Progreso</h2>
            <dl className={styles.metaList}>
              <div>
                <dt>Puntaje en el periodo</dt>
                <dd>{myProfileQuery.data.totalPoints} pts</dd>
              </div>
              <div>
                <dt>Posición individual</dt>
                <dd>#{myProfileQuery.data.individualPosition ?? '—'}</dd>
              </div>
              <div>
                <dt>Posición de mi {t('term.pharmacy', terms)}</dt>
                <dd>
                  #{myProfileQuery.data.pharmacy?.position ?? '—'} (Prom.{' '}
                  {myProfileQuery.data.pharmacy?.averagePoints ?? 0} pts)
                </dd>
              </div>
              <div>
                <dt>Partidas jugadas</dt>
                <dd>{myProfileQuery.data.sessionsPlayedInPeriod}</dd>
              </div>
              <div>
                <dt>Marcas pendientes</dt>
                <dd>
                  {myProfileQuery.data.pendingBrands.length > 0
                    ? myProfileQuery.data.pendingBrands.map((b) => b.brandName).join(', ')
                    : '¡Completaste todas las marcas!'}
                </dd>
              </div>
            </dl>
          </section>
        )}

        {pwaSection === 'manager' && managerQuery.data && (
          <section className={styles.card} aria-label="Panel del gerente de farmacia">
            <h2 className={styles.subtitle}>
              Equipo de {managerQuery.data.pharmacy.name} (Solo lectura)
            </h2>
            <dl className={styles.metaList}>
              <div>
                <dt>% de participación del equipo</dt>
                <dd>
                  <strong>{managerQuery.data.participationPercentage}%</strong> (
                  {managerQuery.data.activeClerksCount}/{managerQuery.data.teamTotalClerks})
                </dd>
              </div>
              <div>
                <dt>Posición de la {t('term.pharmacy', terms)}</dt>
                <dd>
                  #{managerQuery.data.pharmacyRankPosition ?? '—'} (Promedio:{' '}
                  {managerQuery.data.pharmacyAveragePoints ?? 0} pts)
                </dd>
              </div>
            </dl>
            <h3>
              Quién no ha entrado / sin partidas ({managerQuery.data.notEnteredMembers.length})
            </h3>
            <ul className={styles.list}>
              {managerQuery.data.notEnteredMembers.map((m) => (
                <li key={m.userId}>
                  <strong>{m.displayName}</strong> ({m.phoneMasked}) —{' '}
                  <span className={styles.muted}>
                    {m.lastLoginAt ? 'Sin partidas en el periodo' : 'No ha ingresado'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    );
  }

  // 4) Sin sesión y sin país elegido: Pantalla 1 (Selección de país)
  if (!chosen) {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>{t('app.title')}</h1>
        <section className={styles.card} aria-labelledby="choose">
          <h2 id="choose" className={styles.subtitle}>
            {t('country.choose')}
          </h2>
          {countries.isPending && <p className={styles.muted}>Cargando…</p>}
          {countries.isError && (
            <p role="alert" className={styles.alert}>
              No pudimos cargar los países. Revisa tu conexión e inténtalo de nuevo.
            </p>
          )}
          <ul className={styles.list}>
            {countries.data?.map((c) => (
              <li key={c.code}>
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => {
                    saveChosenCountry(storage, c.code);
                    setChosen(c.code);
                    setErrorMsg(null);
                  }}
                >
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </main>
    );
  }

  // 5) País elegido: Ingreso con celular o documento + OTP
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{t('app.title')}</h1>
      <section className={styles.card}>
        <div className={styles.countryBar}>
          <span>
            País: <strong>{currentCountry?.name ?? chosen}</strong>
          </span>
          <button
            type="button"
            className={styles.linkBtn}
            onClick={() => {
              setChosen(null);
              setStep('identify');
              setErrorMsg(null);
              setInfoMsg(null);
            }}
          >
            Cambiar país
          </button>
        </div>

        {step === 'identify' ? (
          <form onSubmit={handleRequestOtp} className={styles.form}>
            <div className={styles.tabs} role="tablist" aria-label="Método de ingreso">
              <button
                type="button"
                role="tab"
                aria-selected={idType === 'phone'}
                className={idType === 'phone' ? styles.tabActive : styles.tab}
                onClick={() => {
                  setIdType('phone');
                  setIdValue('');
                  setErrorMsg(null);
                }}
              >
                Celular
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={idType === 'document'}
                className={idType === 'document' ? styles.tabActive : styles.tab}
                onClick={() => {
                  setIdType('document');
                  setIdValue('');
                  setErrorMsg(null);
                }}
              >
                Documento
              </button>
            </div>

            <label className={styles.label} htmlFor="identifier-input">
              {idType === 'phone'
                ? `Número de celular (${currentCountry?.phonePrefix ?? ''})`
                : 'Documento de identidad'}
            </label>
            <input
              id="identifier-input"
              className={styles.input}
              type={idType === 'phone' ? 'tel' : 'text'}
              inputMode={idType === 'phone' ? 'tel' : 'text'}
              autoComplete={idType === 'phone' ? 'tel' : 'off'}
              placeholder={
                idType === 'phone'
                  ? `${currentCountry?.phonePrefix ?? '+51'} 900 000 001`
                  : 'Tu número de documento'
              }
              value={idValue}
              onChange={(e) => setIdValue(e.target.value)}
              required
            />

            {sessionEnded && !errorMsg && (
              <p role="status" className={styles.muted}>
                Tu sesión terminó. Ingresa de nuevo para seguir jugando.
              </p>
            )}
            {errorMsg && (
              <p role="alert" className={styles.alert}>
                {errorMsg}
              </p>
            )}

            <button type="submit" className={styles.primary} disabled={busy || !idValue.trim()}>
              {busy ? 'Enviando…' : 'Recibir código'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className={styles.form}>
            {infoMsg && <p className={styles.muted}>{infoMsg}</p>}
            <label className={styles.label} htmlFor="otp-input">
              Código de 6 dígitos
            </label>
            <input
              id="otp-input"
              className={styles.input}
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              autoComplete="one-time-code"
              placeholder="000000"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
              required
            />

            {errorMsg && (
              <p role="alert" className={styles.alert}>
                {errorMsg}
              </p>
            )}

            <button
              type="submit"
              className={styles.primary}
              disabled={busy || otpCode.length !== 6}
            >
              {busy ? 'Verificando…' : 'Ingresar'}
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={busy}
              onClick={() => {
                setStep('identify');
                setOtpCode('');
                setErrorMsg(null);
              }}
            >
              Usar otro número o reenviar
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
