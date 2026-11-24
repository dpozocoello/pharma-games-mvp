import {
  DEFAULT_ARCADE_RULES,
  QUESTION_STATUS_TRANSITIONS,
  ROLES,
  type ArcadeRules,
  type AdminCountrySummary,
  type AnomalyAlertView,
  type CountryConfigView,
  type ImportJobView,
  type MeResponse,
  type QuestionStatus,
} from '@pharma/shared';
import { StrictMode, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AdminApiError,
  closeRankingPeriod,
  createBrand,
  createCountry,
  createPharmacy,
  downloadParticipationCsv,
  downloadWinnersCsv,
  getCountryConfig,
  importQuestionsCsv,
  importUsersCsv,
  listAdminCountries,
  listAnomalies,
  listBrands,
  listPharmacies,
  listQuestions,
  listUsers,
  logoutAdminSession,
  patchCountry,
  publishConsentVersion,
  refreshAdminSession,
  requestAdminOtp,
  resolveAnomaly,
  setCountryBrandActive,
  transferUserPharmacy,
  updateCountryConfig,
  updateQuestionStatus,
  updateUserStatus,
  verifyAdminOtp,
  type AdminBrand,
  type AdminPharmacy,
  type AdminQuestion,
  type AdminUser,
  downloadArcadePilotCsv,
  getArcadePilotReport,
  type ArcadePilotReportView,
} from './api';
import styles from './AdminApp.module.css';
import './global.css';

type AdminTab = 'config' | 'users' | 'content' | 'anomalies';

export function AdminApp() {
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [activeTab, setActiveTab] = useState<AdminTab>('config');

  // Ingreso OTP
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [code, setCode] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Países y configuración
  const [countries, setCountries] = useState<AdminCountrySummary[]>([]);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [configView, setConfigView] = useState<CountryConfigView | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  // Campos editables de configuración
  const [periodMonths, setPeriodMonths] = useState<1 | 2 | 3>(1);
  const [pointsPerCorrect, setPointsPerCorrect] = useState(10);
  const [speedBonusMax, setSpeedBonusMax] = useState(5);
  const [questionsPerSession, setQuestionsPerSession] = useState(10);
  const [secondsPerQuestion, setSecondsPerQuestion] = useState(20);
  const [maxSessionsPerGamePerDay, setMaxSessionsPerGamePerDay] = useState(3);
  const [dailyCapPerUser, setDailyCapPerUser] = useState(300);
  const [dailyCapPerBrand, setDailyCapPerBrand] = useState(120);
  const [minAnswerMs, setMinAnswerMs] = useState(800);
  // Piloto arcade (ADR-034): null = el país no tiene reglas arcade.
  const [arcade, setArcade] = useState<ArcadeRules | null>(null);
  const [pilotReport, setPilotReport] = useState<ArcadePilotReportView | null>(null);
  const [termsJson, setTermsJson] = useState('{}');
  const [newConsentText, setNewConsentText] = useState('');

  // Alta de nuevo país (SUPER_ADMIN)
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newLocale, setNewLocale] = useState('es-BO');
  const [newTimezone, setNewTimezone] = useState('America/La_Paz');
  const [newPrefix, setNewPrefix] = useState('+591');

  // Iteración 2: Usuarios y Farmacias
  const [pharmacies, setPharmacies] = useState<AdminPharmacy[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [phCode, setPhCode] = useState('');
  const [phName, setPhName] = useState('');
  const [phCity, setPhCity] = useState('');
  const [usersCsvText, setUsersCsvText] = useState('');
  const [lastImportJob, setLastImportJob] = useState<ImportJobView | null>(null);

  // Iteración 2: Contenido (Marcas y Preguntas)
  const [brands, setBrands] = useState<AdminBrand[]>([]);
  const [questions, setQuestions] = useState<AdminQuestion[]>([]);
  const [filterBrandSlug, setFilterBrandSlug] = useState('');
  const [filterQStatus, setFilterQStatus] = useState<QuestionStatus | ''>('');
  const [questionsCsvText, setQuestionsCsvText] = useState('');
  const [newBrandSlug, setNewBrandSlug] = useState('');
  const [newBrandName, setNewBrandName] = useState('');
  const [newBrandPrimary, setNewBrandPrimary] = useState('#1D4ED8');
  const [newBrandSecondary, setNewBrandSecondary] = useState('#DBEAFE');

  // Iteración 4: Anomalías
  const [anomalies, setAnomalies] = useState<AnomalyAlertView[]>([]);
  const [exportedWinnersCsv, setExportedWinnersCsv] = useState<string | null>(null);
  const [exportedParticipationCsv, setExportedParticipationCsv] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    refreshAdminSession()
      .then((res) => {
        if (!active || !res) return;
        setToken(res.accessToken);
        setMe(res.me);
        if (res.me.role === 'CONTENT_EDITOR') setActiveTab('content');
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setRestoring(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    listAdminCountries(token)
      .then((list) => {
        setCountries(list);
        if (list.length > 0 && !selectedCode) {
          setSelectedCode(list[0]!.code);
        }
      })
      .catch((err) => {
        setConfigError(err instanceof AdminApiError ? err.message : 'Error al cargar países');
      });
  }, [token, selectedCode]);

  useEffect(() => {
    if (!token || !selectedCode) return;
    setConfigError(null);

    if (activeTab === 'config' && me?.role !== 'CONTENT_EDITOR') {
      getCountryConfig(token, selectedCode)
        .then((view) => applyConfigView(view))
        .catch((err) =>
          setConfigError(
            err instanceof AdminApiError ? err.message : 'No se pudo cargar la configuración',
          ),
        );
    } else if (activeTab === 'users' && me?.role !== 'CONTENT_EDITOR') {
      Promise.all([listPharmacies(token, selectedCode), listUsers(token, selectedCode)])
        .then(([phs, usrs]) => {
          setPharmacies(phs);
          setUsers(usrs);
        })
        .catch((err) =>
          setConfigError(err instanceof AdminApiError ? err.message : 'Error al cargar usuarios'),
        );
    } else if (activeTab === 'content') {
      Promise.all([
        listBrands(token),
        listQuestions(
          token,
          filterBrandSlug || undefined,
          (filterQStatus || undefined) as QuestionStatus | undefined,
        ),
      ])
        .then(([bList, qList]) => {
          setBrands(bList);
          setQuestions(qList);
        })
        .catch((err) =>
          setConfigError(err instanceof AdminApiError ? err.message : 'Error al cargar contenido'),
        );
    } else if (activeTab === 'anomalies' && me?.role !== 'CONTENT_EDITOR') {
      listAnomalies(token, selectedCode)
        .then((list) => setAnomalies(list))
        .catch((err) =>
          setConfigError(err instanceof AdminApiError ? err.message : 'Error al cargar anomalías'),
        );
    }
  }, [token, selectedCode, activeTab, me?.role, filterBrandSlug, filterQStatus]);

  function applyConfigView(view: CountryConfigView) {
    setConfigView(view);
    setPeriodMonths(view.rankingPeriodMonths);
    setPointsPerCorrect(view.pointsRules.pointsPerCorrect);
    setSpeedBonusMax(view.pointsRules.speedBonusMax);
    setQuestionsPerSession(view.pointsRules.questionsPerSession);
    setSecondsPerQuestion(view.pointsRules.secondsPerQuestion);
    setMaxSessionsPerGamePerDay(view.pointsRules.maxSessionsPerGamePerDay);
    setDailyCapPerUser(view.pointsRules.dailyCapPerUser);
    setDailyCapPerBrand(view.pointsRules.dailyCapPerBrand);
    setMinAnswerMs(view.pointsRules.minAnswerMs);
    setArcade(view.pointsRules.arcade ?? null);
    setPilotReport(null);
    setTermsJson(JSON.stringify(view.terms, null, 2));
  }

  async function handleRequestOtp(e: FormEvent) {
    e.preventDefault();
    setAuthError(null);
    setBusy(true);
    try {
      await requestAdminOtp(phone);
      setStep('code');
    } catch (err) {
      setAuthError(err instanceof AdminApiError ? err.message : 'No se pudo enviar el código');
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp(e: FormEvent) {
    e.preventDefault();
    setAuthError(null);
    setBusy(true);
    try {
      const res = await verifyAdminOtp(phone, code);
      setToken(res.accessToken);
      setMe(res.me);
      if (res.me.role === 'CONTENT_EDITOR') setActiveTab('content');
      setCode('');
      setStep('phone');
    } catch (err) {
      setAuthError(err instanceof AdminApiError ? err.message : 'Código incorrecto');
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    await logoutAdminSession();
    setToken(null);
    setMe(null);
    setCountries([]);
    setSelectedCode(null);
    setConfigView(null);
  }

  async function handleSaveConfig(e: FormEvent) {
    e.preventDefault();
    if (!token || !selectedCode || !configView) return;
    setFeedback(null);
    setConfigError(null);
    setBusy(true);
    try {
      const parsedTerms = JSON.parse(termsJson) as Record<string, string>;
      const updated = await updateCountryConfig(token, selectedCode, {
        terms: parsedTerms,
        rankingPeriodMonths: periodMonths,
        pointsRules: {
          ...configView.pointsRules,
          pointsPerCorrect,
          speedBonusMax,
          questionsPerSession,
          secondsPerQuestion,
          maxSessionsPerGamePerDay,
          dailyCapPerUser,
          dailyCapPerBrand,
          minAnswerMs,
          ...(arcade ? { arcade } : {}),
        },
      });
      applyConfigView(updated);
      setFeedback('Configuración actualizada y caché invalidada sin desplegar.');
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : 'Error al guardar configuración');
    } finally {
      setBusy(false);
    }
  }

  async function handlePublishConsent(e: FormEvent) {
    e.preventDefault();
    if (!token || !selectedCode) return;
    setFeedback(null);
    setConfigError(null);
    setBusy(true);
    try {
      const updated = await publishConsentVersion(token, selectedCode, newConsentText);
      applyConfigView(updated);
      setNewConsentText('');
      setFeedback(`Versión ${updated.consent?.version} de consentimiento publicada.`);
    } catch (err) {
      setConfigError(
        err instanceof AdminApiError ? err.message : 'Error al publicar consentimiento',
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleBrand(brandId: string, active: boolean) {
    if (!token || !selectedCode) return;
    setFeedback(null);
    setConfigError(null);
    setBusy(true);
    try {
      const updated = await setCountryBrandActive(token, selectedCode, brandId, active);
      applyConfigView(updated);
      setFeedback('Estado de marca actualizado.');
    } catch (err) {
      setConfigError(err instanceof AdminApiError ? err.message : 'Error al actualizar marca');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleCountryActive(active: boolean) {
    if (!token || !selectedCode) return;
    setFeedback(null);
    setConfigError(null);
    setBusy(true);
    try {
      const updated = await patchCountry(token, selectedCode, { active });
      applyConfigView(updated);
      const list = await listAdminCountries(token);
      setCountries(list);
      setFeedback(active ? 'País activado.' : 'País desactivado.');
    } catch (err) {
      setConfigError(
        err instanceof AdminApiError ? err.message : 'No se pudo cambiar estado del país',
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateCountry(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setFeedback(null);
    setConfigError(null);
    setBusy(true);
    try {
      const created = await createCountry(token, {
        code: newCode.toUpperCase().trim(),
        name: newName.trim(),
        locale: newLocale.trim(),
        timezone: newTimezone.trim(),
        phonePrefix: newPrefix.trim(),
      });
      const list = await listAdminCountries(token);
      setCountries(list);
      setSelectedCode(created.country.code);
      applyConfigView(created);
      setNewCode('');
      setNewName('');
      setFeedback(
        `País ${created.country.name} (${created.country.code}) creado por configuración.`,
      );
    } catch (err) {
      setConfigError(err instanceof AdminApiError ? err.message : 'Error al crear país');
    } finally {
      setBusy(false);
    }
  }

  // Handlers Iteración 2
  async function handleCreatePharmacy(e: FormEvent) {
    e.preventDefault();
    if (!token || !selectedCode) return;
    setFeedback(null);
    setConfigError(null);
    setBusy(true);
    try {
      await createPharmacy(token, {
        countryCode: selectedCode,
        externalCode: phCode.trim(),
        name: phName.trim(),
        city: phCity.trim(),
      });
      setPhCode('');
      setPhName('');
      setPhCity('');
      setPharmacies(await listPharmacies(token, selectedCode));
      setFeedback('Farmacia creada correctamente.');
    } catch (err) {
      setConfigError(err instanceof AdminApiError ? err.message : 'Error al crear farmacia');
    } finally {
      setBusy(false);
    }
  }

  async function handleImportUsersCsv(e: FormEvent) {
    e.preventDefault();
    if (!token || !selectedCode || !usersCsvText.trim()) return;
    setFeedback(null);
    setConfigError(null);
    setBusy(true);
    try {
      const job = await importUsersCsv(token, {
        countryCode: selectedCode,
        fileName: 'usuarios-panel.csv',
        csv: usersCsvText,
      });
      setLastImportJob(job);
      const [phs, usrs] = await Promise.all([
        listPharmacies(token, selectedCode),
        listUsers(token, selectedCode),
      ]);
      setPharmacies(phs);
      setUsers(usrs);
      setFeedback(
        `Importación completada: ${job.validRows}/${job.totalRows} filas válidas (${job.errors.length} errores).`,
      );
    } catch (err) {
      setConfigError(err instanceof AdminApiError ? err.message : 'Error al importar CSV');
    } finally {
      setBusy(false);
    }
  }

  async function handleTransferUser(userId: string, pharmacyId: string) {
    if (!token || !selectedCode || !pharmacyId) return;
    setFeedback(null);
    setConfigError(null);
    setBusy(true);
    try {
      const updated = await transferUserPharmacy(token, userId, pharmacyId);
      setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
      setPharmacies(await listPharmacies(token, selectedCode));
      setFeedback(
        `Usuario trasladado a ${updated.currentPharmacy?.name}. Puntos (${updated.totalPoints}) e historial conservados.`,
      );
    } catch (err) {
      setConfigError(err instanceof AdminApiError ? err.message : 'Error al trasladar usuario');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleUserStatus(user: AdminUser) {
    if (!token) return;
    const nextStatus = user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    setFeedback(null);
    setConfigError(null);
    setBusy(true);
    try {
      const updated = await updateUserStatus(token, user.id, nextStatus);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? updated : u)));
      setFeedback(`Estado de ${updated.displayName} actualizado a ${updated.status}.`);
    } catch (err) {
      setConfigError(err instanceof AdminApiError ? err.message : 'Error al cambiar estado');
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateBrand(e: FormEvent) {
    e.preventDefault();
    if (!token || !selectedCode) return;
    setFeedback(null);
    setConfigError(null);
    setBusy(true);
    try {
      await createBrand(token, {
        slug: newBrandSlug.trim().toLowerCase(),
        name: newBrandName.trim(),
        theme: {
          primary: newBrandPrimary,
          secondary: newBrandSecondary,
          logoUrl: `/brands/${newBrandSlug.trim().toLowerCase()}.svg`,
        },
        countryCodes: [selectedCode],
      });
      setNewBrandSlug('');
      setNewBrandName('');
      setBrands(await listBrands(token));
      setFeedback('Marca creada y habilitada en el país.');
    } catch (err) {
      setConfigError(err instanceof AdminApiError ? err.message : 'Error al crear marca');
    } finally {
      setBusy(false);
    }
  }

  async function handleImportQuestionsCsv(e: FormEvent) {
    e.preventDefault();
    if (!token || !selectedCode || !questionsCsvText.trim()) return;
    setFeedback(null);
    setConfigError(null);
    setBusy(true);
    try {
      const job = await importQuestionsCsv(token, {
        countryCode: selectedCode,
        fileName: 'preguntas-panel.csv',
        csv: questionsCsvText,
      });
      setLastImportJob(job);
      const [bList, qList] = await Promise.all([
        listBrands(token),
        listQuestions(
          token,
          filterBrandSlug || undefined,
          (filterQStatus || undefined) as QuestionStatus | undefined,
        ),
      ]);
      setBrands(bList);
      setQuestions(qList);
      setFeedback(
        `Preguntas importadas en DRAFT: ${job.validRows}/${job.totalRows} válidas (${job.errors.length} errores).`,
      );
    } catch (err) {
      setConfigError(err instanceof AdminApiError ? err.message : 'Error al importar preguntas');
    } finally {
      setBusy(false);
    }
  }

  async function handleTransitionQuestion(q: AdminQuestion, nextStatus: QuestionStatus) {
    if (!token) return;
    setFeedback(null);
    setConfigError(null);
    setBusy(true);
    try {
      const updated = await updateQuestionStatus(token, q.id, nextStatus);
      setQuestions((prev) => prev.map((item) => (item.id === q.id ? updated : item)));
      setBrands(await listBrands(token));
      setFeedback(`Pregunta pasada de ${q.status} a ${updated.status} (auditado).`);
    } catch (err) {
      setConfigError(
        err instanceof AdminApiError ? err.message : 'No se pudo cambiar estado de la pregunta',
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleResolveAnomaly(alertId: string, status: 'CONFIRMED' | 'DISMISSED') {
    if (!token || !selectedCode) return;
    setFeedback(null);
    setConfigError(null);
    setBusy(true);
    try {
      const updated = await resolveAnomaly(token, alertId, status);
      setAnomalies((prev) => prev.map((a) => (a.id === alertId ? updated : a)));
      setFeedback(
        status === 'CONFIRMED'
          ? 'Anomalía confirmada y movimiento REVERSAL registrado en PointsLedger.'
          : 'Anomalía descartada; los puntos quedan habilitados.',
      );
    } catch (err) {
      setConfigError(err instanceof AdminApiError ? err.message : 'Error al resolver anomalía');
    } finally {
      setBusy(false);
    }
  }

  async function handleClosePeriod(periodId: string) {
    if (!token || !selectedCode) return;
    setFeedback(null);
    setConfigError(null);
    setBusy(true);
    try {
      const closed = await closeRankingPeriod(token, periodId);
      const csv = await downloadWinnersCsv(token, periodId);
      setExportedWinnersCsv(csv);
      const updated = await getCountryConfig(token, selectedCode);
      applyConfigView(updated);
      setFeedback(
        `Periodo cerrado (${closed.winnersCount} ganadores generados y exportados en CSV).`,
      );
    } catch (err) {
      setConfigError(err instanceof AdminApiError ? err.message : 'Error al cerrar periodo');
    } finally {
      setBusy(false);
    }
  }

  async function handleLoadPilot(exportCsv: boolean) {
    if (!token || !configView) return;
    setFeedback(null);
    setConfigError(null);
    setBusy(true);
    try {
      const code = configView.country.code;
      setPilotReport(await getArcadePilotReport(token, code));
      if (exportCsv) {
        const csv = await downloadArcadePilotCsv(token, code);
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `piloto-arcade-${code}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        setFeedback('Indicadores del piloto exportados en CSV (registrado en auditoría).');
      }
    } catch (err) {
      setConfigError(err instanceof AdminApiError ? err.message : 'Error al leer el piloto');
    } finally {
      setBusy(false);
    }
  }

  async function handleExportParticipationCsv() {
    if (!token || !configView) return;
    setFeedback(null);
    setConfigError(null);
    setBusy(true);
    try {
      const csv = await downloadParticipationCsv(token, configView.country.code);
      setExportedParticipationCsv(csv);
      setFeedback('Reporte de participación por país, farmacia y marca exportado en CSV.');
    } catch (err) {
      setConfigError(
        err instanceof AdminApiError ? err.message : 'Error al exportar reporte de participación',
      );
    } finally {
      setBusy(false);
    }
  }

  if (restoring) {
    return (
      <main className={styles.page}>
        <h1>Administración</h1>
        <p>Cargando sesión…</p>
      </main>
    );
  }

  if (!token || !me) {
    return (
      <main className={styles.loginPage}>
        <section className={styles.card}>
          <h1>Administración</h1>
          <p className={styles.muted}>
            Ingreso exclusivo para roles:{' '}
            {ROLES.filter((r) => r !== 'CLERK' && r !== 'PHARMACY_MANAGER').join(', ')}
          </p>

          {step === 'phone' ? (
            <form onSubmit={handleRequestOtp} className={styles.form}>
              <label htmlFor="admin-phone" className={styles.label}>
                Celular con prefijo internacional (ej. +51900000091)
              </label>
              <input
                id="admin-phone"
                className={styles.input}
                type="tel"
                placeholder="+51900000091"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
              {authError && (
                <p role="alert" className={styles.alert}>
                  {authError}
                </p>
              )}
              <button type="submit" className={styles.primary} disabled={busy || !phone.trim()}>
                {busy ? 'Enviando…' : 'Solicitar código OTP'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className={styles.form}>
              <label htmlFor="admin-code" className={styles.label}>
                Código de 6 dígitos
              </label>
              <input
                id="admin-code"
                className={styles.input}
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                required
              />
              {authError && (
                <p role="alert" className={styles.alert}>
                  {authError}
                </p>
              )}
              <button type="submit" className={styles.primary} disabled={busy || code.length !== 6}>
                {busy ? 'Verificando…' : 'Entrar al panel'}
              </button>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => {
                  setStep('phone');
                  setCode('');
                }}
              >
                Cambiar número
              </button>
            </form>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.topBar}>
        <div>
          <h1 className={styles.title}>Panel de Administración</h1>
          <p className={styles.muted}>
            {me.displayName} · <code>{me.role}</code> ·{' '}
            {me.country ? `Alcance: ${me.country.name} (${me.country.code})` : 'Alcance: Global'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {me.role !== 'CONTENT_EDITOR' && (
            <>
              <button
                type="button"
                className={activeTab === 'config' ? styles.primary : styles.secondarySmall}
                onClick={() => setActiveTab('config')}
              >
                Configuración de País
              </button>
              <button
                type="button"
                className={activeTab === 'users' ? styles.primary : styles.secondarySmall}
                onClick={() => setActiveTab('users')}
              >
                Usuarios y Farmacias
              </button>
              <button
                type="button"
                className={activeTab === 'anomalies' ? styles.primary : styles.secondarySmall}
                onClick={() => setActiveTab('anomalies')}
              >
                Anomalías ({anomalies.filter((a) => a.status === 'OPEN').length})
              </button>
            </>
          )}
          <button
            type="button"
            className={activeTab === 'content' ? styles.primary : styles.secondarySmall}
            onClick={() => setActiveTab('content')}
          >
            Marcas y Preguntas
          </button>
          <button type="button" className={styles.secondarySmall} onClick={handleLogout}>
            Cerrar sesión
          </button>
        </div>
      </header>

      {feedback && (
        <p role="status" className={styles.success}>
          {feedback}
        </p>
      )}
      {configError && (
        <p role="alert" className={styles.alert}>
          {configError}
        </p>
      )}

      {lastImportJob && lastImportJob.errors.length > 0 && (
        <section
          className={styles.card}
          style={{ marginBottom: 16 }}
          aria-label="Errores de importación CSV"
        >
          <h3>
            Reporte de errores por fila ({lastImportJob.fileName}: {lastImportJob.validRows}/
            {lastImportJob.totalRows} válidas)
          </h3>
          <ul>
            {lastImportJob.errors.slice(0, 20).map((err, i) => (
              <li key={i}>
                Fila <strong>{err.row}</strong> (<code>{err.field}</code>): {err.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className={styles.grid}>
        <aside className={styles.card} aria-label="Países en tu alcance">
          <h2>Países</h2>
          <ul className={styles.countryList}>
            {countries.map((c) => (
              <li key={c.code}>
                <button
                  type="button"
                  className={c.code === selectedCode ? styles.countryActive : styles.countryBtn}
                  onClick={() => setSelectedCode(c.code)}
                >
                  <span>
                    {c.name} ({c.code})
                  </span>
                  <span className={c.active ? styles.tagOn : styles.tagOff}>
                    {c.active ? 'Activo' : 'Inactivo'}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {me.role === 'SUPER_ADMIN' && activeTab === 'config' && (
            <form onSubmit={handleCreateCountry} className={styles.form} style={{ marginTop: 20 }}>
              <h3>Dar de alta país</h3>
              <label className={styles.label}>
                Código ISO (2 letras)
                <input
                  className={styles.input}
                  maxLength={2}
                  placeholder="BO"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  required
                />
              </label>
              <label className={styles.label}>
                Nombre
                <input
                  className={styles.input}
                  placeholder="Bolivia"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  required
                />
              </label>
              <label className={styles.label}>
                Locale
                <input
                  className={styles.input}
                  value={newLocale}
                  onChange={(e) => setNewLocale(e.target.value)}
                  required
                />
              </label>
              <label className={styles.label}>
                Zona horaria
                <input
                  className={styles.input}
                  value={newTimezone}
                  onChange={(e) => setNewTimezone(e.target.value)}
                  required
                />
              </label>
              <label className={styles.label}>
                Prefijo telefónico
                <input
                  className={styles.input}
                  value={newPrefix}
                  onChange={(e) => setNewPrefix(e.target.value)}
                  required
                />
              </label>
              <button type="submit" className={styles.primary} disabled={busy}>
                Crear país
              </button>
            </form>
          )}
        </aside>

        <section className={styles.card}>
          {activeTab === 'config' && configView && (
            <div className={styles.configSections}>
              <div className={styles.sectionHeader}>
                <h2>
                  Configuración de {configView.country.name} ({configView.country.code})
                </h2>
                {me.role === 'SUPER_ADMIN' && (
                  <button
                    type="button"
                    className={styles.secondarySmall}
                    disabled={busy}
                    onClick={() => handleToggleCountryActive(!configView.country.active)}
                  >
                    {configView.country.active ? 'Desactivar país' : 'Activar país'}
                  </button>
                )}
              </div>

              <form onSubmit={handleSaveConfig} className={styles.form}>
                <h3>Reglas de puntos y periodo de ranking</h3>
                <div className={styles.twoCol}>
                  <label className={styles.label}>
                    Periodo de ranking (meses)
                    <select
                      aria-label="Periodo de ranking (meses)"
                      className={styles.input}
                      value={periodMonths}
                      onChange={(e) => setPeriodMonths(Number(e.target.value) as 1 | 2 | 3)}
                    >
                      <option value={1}>1 mes</option>
                      <option value={2}>2 meses</option>
                      <option value={3}>3 meses</option>
                    </select>
                  </label>

                  <label className={styles.label}>
                    Puntos por respuesta correcta
                    <input
                      aria-label="Puntos por respuesta correcta"
                      className={styles.input}
                      type="number"
                      value={pointsPerCorrect}
                      onChange={(e) => setPointsPerCorrect(Number(e.target.value))}
                    />
                  </label>

                  <label className={styles.label}>
                    Bono máximo de velocidad
                    <input
                      className={styles.input}
                      type="number"
                      value={speedBonusMax}
                      onChange={(e) => setSpeedBonusMax(Number(e.target.value))}
                    />
                  </label>

                  <label className={styles.label}>
                    Preguntas por partida
                    <input
                      className={styles.input}
                      type="number"
                      value={questionsPerSession}
                      onChange={(e) => setQuestionsPerSession(Number(e.target.value))}
                    />
                  </label>

                  <label className={styles.label}>
                    Segundos por pregunta
                    <input
                      className={styles.input}
                      type="number"
                      value={secondsPerQuestion}
                      onChange={(e) => setSecondsPerQuestion(Number(e.target.value))}
                    />
                  </label>

                  <label className={styles.label}>
                    Máx. partidas por juego/día
                    <input
                      className={styles.input}
                      type="number"
                      value={maxSessionsPerGamePerDay}
                      onChange={(e) => setMaxSessionsPerGamePerDay(Number(e.target.value))}
                    />
                  </label>

                  <label className={styles.label}>
                    Tope diario por usuario
                    <input
                      className={styles.input}
                      type="number"
                      value={dailyCapPerUser}
                      onChange={(e) => setDailyCapPerUser(Number(e.target.value))}
                    />
                  </label>

                  <label className={styles.label}>
                    Tope diario por marca
                    <input
                      className={styles.input}
                      type="number"
                      value={dailyCapPerBrand}
                      onChange={(e) => setDailyCapPerBrand(Number(e.target.value))}
                    />
                  </label>

                  <label className={styles.label}>
                    Tiempo mínimo respuesta (ms)
                    <input
                      className={styles.input}
                      type="number"
                      value={minAnswerMs}
                      onChange={(e) => setMinAnswerMs(Number(e.target.value))}
                    />
                  </label>
                </div>

                <fieldset
                  className={styles.form}
                  style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: 12 }}
                >
                  <legend>Juegos arcade y piloto A/B</legend>
                  <label
                    className={styles.label}
                    style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}
                  >
                    <input
                      type="checkbox"
                      checked={arcade?.enabled ?? false}
                      onChange={(e) =>
                        setArcade({
                          ...(arcade ?? DEFAULT_ARCADE_RULES),
                          enabled: e.target.checked,
                        })
                      }
                    />
                    Estilos arcade activos
                  </label>
                  {arcade && (
                    <div className={styles.grid}>
                      <label className={styles.label}>
                        Segundos por pregunta en arcade
                        <input
                          className={styles.input}
                          type="number"
                          min={5}
                          max={300}
                          value={arcade.secondsPerQuestion}
                          onChange={(e) =>
                            setArcade({ ...arcade, secondsPerQuestion: Number(e.target.value) })
                          }
                        />
                      </label>
                      <label
                        className={styles.label}
                        style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}
                      >
                        <input
                          type="checkbox"
                          checked={arcade.abTest.enabled}
                          onChange={(e) =>
                            setArcade({
                              ...arcade,
                              abTest: { ...arcade.abTest, enabled: e.target.checked },
                            })
                          }
                        />
                        Piloto A/B por farmacia
                      </label>
                      <label className={styles.label}>
                        % de farmacias en grupo arcade
                        <input
                          className={styles.input}
                          type="number"
                          min={0}
                          max={100}
                          value={arcade.abTest.arcadeSharePct}
                          onChange={(e) =>
                            setArcade({
                              ...arcade,
                              abTest: { ...arcade.abTest, arcadeSharePct: Number(e.target.value) },
                            })
                          }
                        />
                      </label>
                      <label className={styles.label}>
                        Semilla de asignación (no cambiar durante un piloto)
                        <input className={styles.input} value={arcade.abTest.salt} readOnly />
                      </label>
                    </div>
                  )}
                </fieldset>

                <label className={styles.label}>
                  Términos locales (JSON)
                  <textarea
                    className={styles.textarea}
                    rows={4}
                    value={termsJson}
                    onChange={(e) => setTermsJson(e.target.value)}
                  />
                </label>

                <button type="submit" className={styles.primary} disabled={busy}>
                  Guardar configuración
                </button>
              </form>

              <hr className={styles.divider} />

              <div>
                <h3>Marcas en {configView.country.name}</h3>
                <ul className={styles.brandList}>
                  {configView.brands.map((b) => (
                    <li key={b.brandId} className={styles.brandItem}>
                      <span>
                        <strong>{b.name}</strong> (<code>{b.slug}</code>)
                      </span>
                      <button
                        type="button"
                        className={b.active ? styles.tagOn : styles.tagOff}
                        disabled={busy}
                        onClick={() => handleToggleBrand(b.brandId, !b.active)}
                      >
                        {b.active ? 'Activa (desactivar)' : 'Inactiva (activar)'}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              {configView.currentPeriod && (
                <>
                  <hr className={styles.divider} />
                  <div>
                    <h3>Periodo de Ranking Abierto</h3>
                    <p className={styles.muted}>
                      Desde {configView.currentPeriod.startsAt.slice(0, 10)} hasta{' '}
                      {configView.currentPeriod.endsAt.slice(0, 10)}
                    </p>
                    <button
                      type="button"
                      className={styles.secondary}
                      style={{ marginTop: 8 }}
                      disabled={busy}
                      onClick={() => handleClosePeriod(configView.currentPeriod!.id)}
                    >
                      Cerrar periodo y exportar ganadores CSV
                    </button>
                    {exportedWinnersCsv && (
                      <pre className={styles.consentPreview} style={{ marginTop: 10 }}>
                        {exportedWinnersCsv}
                      </pre>
                    )}
                  </div>
                </>
              )}

              <hr className={styles.divider} />

              <div>
                <h3>Piloto arcade: indicadores</h3>
                <p className={styles.muted}>
                  Grupo arcade frente a control en el periodo abierto. Criterios: partidas por
                  activo +20 %, aciertos sin caer más de 3 puntos y abandono menor a 15 %.
                </p>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={busy}
                    onClick={() => handleLoadPilot(false)}
                  >
                    Ver indicadores
                  </button>
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={busy}
                    onClick={() => handleLoadPilot(true)}
                  >
                    Exportar CSV
                  </button>
                </div>
                {pilotReport && (
                  <div style={{ marginTop: 10, overflowX: 'auto' }}>
                    <p className={styles.muted}>
                      {pilotReport.from.slice(0, 10)} a {pilotReport.to.slice(0, 10)} · arcade:{' '}
                      {pilotReport.groups.ARCADE.pharmacies} farmacias (participación{' '}
                      {pilotReport.groups.ARCADE.participationPct ?? '—'} %), control:{' '}
                      {pilotReport.groups.CONTROL.pharmacies} farmacias (participación{' '}
                      {pilotReport.groups.CONTROL.participationPct ?? '—'} %)
                    </p>
                    <table
                      style={{ borderCollapse: 'collapse', fontSize: '0.85rem', minWidth: 560 }}
                    >
                      <thead>
                        <tr>
                          {[
                            'Grupo',
                            'Estilo',
                            'Activos',
                            'Partidas',
                            'Por activo/sem',
                            'Aciertos %',
                            'Abandono %',
                            'Retorno 7 d %',
                          ].map((hd) => (
                            <th
                              key={hd}
                              style={{
                                textAlign: 'left',
                                padding: '4px 8px',
                                borderBottom: '1px solid #cbd5e1',
                              }}
                            >
                              {hd}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pilotReport.rows.map((r) => (
                          <tr
                            key={`${r.group}-${r.style}`}
                            style={{ fontWeight: r.style === 'ALL' ? 700 : 400 }}
                          >
                            <td style={{ padding: '4px 8px' }}>
                              {r.group === 'ARCADE' ? 'Arcade' : 'Control'}
                            </td>
                            <td style={{ padding: '4px 8px' }}>
                              {r.style === 'ALL' ? 'Total' : r.style}
                            </td>
                            <td style={{ padding: '4px 8px' }}>{r.activeClerks}</td>
                            <td style={{ padding: '4px 8px' }}>{r.sessionsFinished}</td>
                            <td style={{ padding: '4px 8px' }}>{r.sessionsPerActivePerWeek}</td>
                            <td style={{ padding: '4px 8px' }}>{r.accuracyPct}</td>
                            <td style={{ padding: '4px 8px' }}>{r.abandonPct}</td>
                            <td style={{ padding: '4px 8px' }}>{r.return7dPct}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p style={{ marginTop: 8 }}>
                      {pilotReport.verdict
                        ? `Partidas por activo ${pilotReport.verdict.sessionsLiftPct >= 0 ? '+' : ''}${pilotReport.verdict.sessionsLiftPct} %, aciertos ${pilotReport.verdict.accuracyDeltaPts} pts, abandono arcade ${pilotReport.verdict.arcadeAbandonPct} %: ${pilotReport.verdict.meetsCriteria ? 'cumple los criterios' : 'aún no cumple los criterios'}.`
                        : 'Aún no hay datos de ambos grupos para comparar.'}
                    </p>
                  </div>
                )}
              </div>

              <hr className={styles.divider} />

              <div>
                <h3>Reporte de Participación y Medición (CSV)</h3>
                <p className={styles.muted}>
                  Exporta participación y tests iniciales por país, farmacia y marca.
                </p>
                <button
                  type="button"
                  className={styles.secondary}
                  style={{ marginTop: 8 }}
                  disabled={busy}
                  onClick={handleExportParticipationCsv}
                >
                  Exportar reporte de participación CSV
                </button>
                {exportedParticipationCsv && (
                  <pre className={styles.consentPreview} style={{ marginTop: 10 }}>
                    {exportedParticipationCsv}
                  </pre>
                )}
              </div>

              <hr className={styles.divider} />

              <form onSubmit={handlePublishConsent} className={styles.form}>
                <h3>
                  Consentimiento vigente:{' '}
                  {configView.consent ? `Versión ${configView.consent.version}` : 'Sin publicar'}
                </h3>
                {configView.consent && (
                  <p className={styles.consentPreview}>{configView.consent.text}</p>
                )}
                <label className={styles.label}>
                  Publicar nueva versión de consentimiento (mínimo 50 caracteres)
                  <textarea
                    className={styles.textarea}
                    rows={3}
                    placeholder="Nuevo texto legal con finalidad declarada…"
                    value={newConsentText}
                    onChange={(e) => setNewConsentText(e.target.value)}
                    required
                  />
                </label>
                <button
                  type="submit"
                  className={styles.secondary}
                  disabled={busy || newConsentText.trim().length < 50}
                >
                  Publicar nueva versión
                </button>
              </form>
            </div>
          )}

          {activeTab === 'users' && selectedCode && (
            <div className={styles.configSections}>
              <h2>Usuarios y Farmacias ({selectedCode})</h2>

              <form onSubmit={handleImportUsersCsv} className={styles.form}>
                <h3>Carga masiva de usuarios y farmacias por CSV</h3>
                <label className={styles.label}>
                  Contenido CSV
                  (countryCode,pharmacyCode,pharmacyName,city,phone,document,displayName,role)
                  <textarea
                    className={styles.textarea}
                    rows={4}
                    placeholder="countryCode,pharmacyCode,pharmacyName,city,phone,document,displayName,role"
                    value={usersCsvText}
                    onChange={(e) => setUsersCsvText(e.target.value)}
                  />
                </label>
                <button
                  type="submit"
                  className={styles.primary}
                  disabled={busy || !usersCsvText.trim()}
                >
                  Importar CSV de usuarios
                </button>
              </form>

              <hr className={styles.divider} />

              <form onSubmit={handleCreatePharmacy} className={styles.form}>
                <h3>Alta de Farmacia ({selectedCode})</h3>
                <div className={styles.twoCol}>
                  <label className={styles.label}>
                    Código externo
                    <input
                      className={styles.input}
                      placeholder={`${selectedCode}-FAR-010`}
                      value={phCode}
                      onChange={(e) => setPhCode(e.target.value)}
                      required
                    />
                  </label>
                  <label className={styles.label}>
                    Nombre comercial
                    <input
                      className={styles.input}
                      placeholder="Botica Central"
                      value={phName}
                      onChange={(e) => setPhName(e.target.value)}
                      required
                    />
                  </label>
                  <label className={styles.label}>
                    Ciudad
                    <input
                      className={styles.input}
                      placeholder="Lima"
                      value={phCity}
                      onChange={(e) => setPhCity(e.target.value)}
                      required
                    />
                  </label>
                </div>
                <button type="submit" className={styles.secondary} disabled={busy}>
                  Crear farmacia
                </button>
              </form>

              <ul className={styles.brandList} style={{ marginTop: 12 }}>
                {pharmacies.map((ph) => (
                  <li key={ph.id} className={styles.brandItem}>
                    <span>
                      <strong>{ph.name}</strong> ({ph.city}) · <code>{ph.externalCode}</code>
                    </span>
                    <span className={styles.tagOn}>{ph.activeClerksCount} asignados</span>
                  </li>
                ))}
              </ul>

              <hr className={styles.divider} />

              <h3>Dependientes y Gerentes ({users.length})</h3>
              <ul className={styles.brandList}>
                {users.slice(0, 40).map((u) => (
                  <li key={u.id} className={styles.brandItem} style={{ flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <strong>{u.displayName}</strong> ({u.phoneMasked}) · <code>{u.role}</code> ·{' '}
                      Puntos: <strong>{u.totalPoints}</strong>
                      <div className={styles.muted} style={{ fontSize: '0.85rem' }}>
                        Farmacia actual: {u.currentPharmacy?.name ?? 'Sin asignar'} (Historial:{' '}
                        {u.assignmentHistory.length})
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <select
                        aria-label={`Trasladar a ${u.displayName}`}
                        className={styles.input}
                        style={{ width: 'auto', minHeight: 38 }}
                        value={u.currentPharmacy?.id ?? ''}
                        onChange={(e) => handleTransferUser(u.id, e.target.value)}
                      >
                        <option value="" disabled>
                          Trasladar a…
                        </option>
                        {pharmacies.map((ph) => (
                          <option key={ph.id} value={ph.id}>
                            {ph.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className={u.status === 'ACTIVE' ? styles.tagOn : styles.tagOff}
                        onClick={() => handleToggleUserStatus(u)}
                      >
                        {u.status}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {activeTab === 'content' && selectedCode && (
            <div className={styles.configSections}>
              <h2>Catálogo de Marcas y Banco de Preguntas</h2>

              {me.role !== 'CONTENT_EDITOR' && (
                <>
                  <form onSubmit={handleCreateBrand} className={styles.form}>
                    <h3>Nueva Marca</h3>
                    <div className={styles.twoCol}>
                      <label className={styles.label}>
                        Slug
                        <input
                          className={styles.input}
                          placeholder="marca-j"
                          value={newBrandSlug}
                          onChange={(e) => setNewBrandSlug(e.target.value)}
                          required
                        />
                      </label>
                      <label className={styles.label}>
                        Nombre
                        <input
                          className={styles.input}
                          placeholder="Marca J"
                          value={newBrandName}
                          onChange={(e) => setNewBrandName(e.target.value)}
                          required
                        />
                      </label>
                      <label className={styles.label}>
                        Color primario
                        <input
                          className={styles.input}
                          value={newBrandPrimary}
                          onChange={(e) => setNewBrandPrimary(e.target.value)}
                          required
                        />
                      </label>
                      <label className={styles.label}>
                        Color secundario
                        <input
                          className={styles.input}
                          value={newBrandSecondary}
                          onChange={(e) => setNewBrandSecondary(e.target.value)}
                          required
                        />
                      </label>
                    </div>
                    <button type="submit" className={styles.secondary} disabled={busy}>
                      Crear marca en {selectedCode}
                    </button>
                  </form>
                  <hr className={styles.divider} />
                </>
              )}

              <h3>Marcas disponibles ({brands.length})</h3>
              <ul className={styles.brandList}>
                {brands.map((b) => (
                  <li key={b.id} className={styles.brandItem}>
                    <span>
                      <strong>{b.name}</strong> (<code>{b.slug}</code>) · Países:{' '}
                      {b.countries.map((c) => c.code).join(', ')}
                    </span>
                    <span className={styles.tagOn}>
                      {b.publishedQuestionsCount} PUBLISHED / {b.totalQuestionsCount} total
                    </span>
                  </li>
                ))}
              </ul>

              <hr className={styles.divider} />

              <form onSubmit={handleImportQuestionsCsv} className={styles.form}>
                <h3>Carga masiva de preguntas por CSV (nacen en DRAFT)</h3>
                <label className={styles.label}>
                  Contenido CSV (brandSlug,countryCode,type,prompt,options,correctAnswer,locale)
                  <textarea
                    className={styles.textarea}
                    rows={4}
                    placeholder="brandSlug,countryCode,type,prompt,options,correctAnswer,locale"
                    value={questionsCsvText}
                    onChange={(e) => setQuestionsCsvText(e.target.value)}
                  />
                </label>
                <button
                  type="submit"
                  className={styles.primary}
                  disabled={busy || !questionsCsvText.trim()}
                >
                  Importar CSV de preguntas
                </button>
              </form>

              <hr className={styles.divider} />

              <div className={styles.sectionHeader}>
                <h3>Banco de preguntas y flujo editorial (DRAFT → IN_REVIEW → PUBLISHED)</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select
                    aria-label="Filtrar por marca"
                    className={styles.input}
                    style={{ width: 'auto' }}
                    value={filterBrandSlug}
                    onChange={(e) => setFilterBrandSlug(e.target.value)}
                  >
                    <option value="">Todas las marcas</option>
                    {brands.map((b) => (
                      <option key={b.id} value={b.slug}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Filtrar por estado"
                    className={styles.input}
                    style={{ width: 'auto' }}
                    value={filterQStatus}
                    onChange={(e) => setFilterQStatus(e.target.value as QuestionStatus | '')}
                  >
                    <option value="">Todos los estados</option>
                    <option value="DRAFT">DRAFT</option>
                    <option value="IN_REVIEW">IN_REVIEW</option>
                    <option value="PUBLISHED">PUBLISHED</option>
                    <option value="ARCHIVED">ARCHIVED</option>
                  </select>
                </div>
              </div>

              <ul className={styles.brandList}>
                {questions.slice(0, 30).map((q) => {
                  const nextStates = QUESTION_STATUS_TRANSITIONS[q.status];
                  return (
                    <li
                      key={q.id}
                      className={styles.brandItem}
                      style={{ flexWrap: 'wrap', gap: 8 }}
                    >
                      <div>
                        <strong>[{q.brandName}]</strong> {q.prompt}
                        <div className={styles.muted} style={{ fontSize: '0.85rem' }}>
                          Tipo: <code>{q.type}</code> · País: {q.countryCode ?? 'Compartida'} ·
                          Estado actual: <strong>{q.status}</strong>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {nextStates.map((ns) => (
                          <button
                            key={ns}
                            type="button"
                            className={ns === 'PUBLISHED' ? styles.tagOn : styles.secondarySmall}
                            disabled={busy}
                            onClick={() => handleTransitionQuestion(q, ns)}
                          >
                            Pasar a {ns}
                          </button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {activeTab === 'anomalies' && selectedCode && (
            <div className={styles.configSections}>
              <h2>Alertas de Anomalías y Juego Justo ({selectedCode})</h2>
              <p className={styles.muted}>
                Los puntos de sesiones con alertas en estado <code>OPEN</code> quedan en revisión y
                no cuentan para ganadores hasta que se resuelvan. Confirmar una alerta emite un
                movimiento inverso <code>REVERSAL</code> inmutable.
              </p>
              <ul className={styles.brandList} style={{ marginTop: 12 }}>
                {anomalies.map((a) => (
                  <li key={a.id} className={styles.brandItem} style={{ flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <strong>[{a.rule}]</strong> {a.userDisplayName} · {a.brandName} · Puntaje
                      sesión: <strong>{a.sessionScore}</strong>
                      <div className={styles.muted} style={{ fontSize: '0.85rem' }}>
                        Estado: <code>{a.status}</code> · Detalles: {JSON.stringify(a.details)}
                      </div>
                    </div>
                    {a.status === 'OPEN' && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          className={styles.primary}
                          disabled={busy}
                          onClick={() => handleResolveAnomaly(a.id, 'CONFIRMED')}
                        >
                          Confirmar y Anular (REVERSAL)
                        </button>
                        <button
                          type="button"
                          className={styles.secondarySmall}
                          disabled={busy}
                          onClick={() => handleResolveAnomaly(a.id, 'DISMISSED')}
                        >
                          Descartar
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <AdminApp />
    </StrictMode>,
  );
}
