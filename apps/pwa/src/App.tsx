import { useQuery } from '@tanstack/react-query';
import { t, type PublicCountry } from '@pharma/shared';
import { useState } from 'react';
import { readChosenCountry, saveChosenCountry } from './country';
import styles from './App.module.css';

async function fetchCountries(): Promise<PublicCountry[]> {
  const res = await fetch('/api/v1/countries');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as PublicCountry[];
}

const storage = typeof window !== 'undefined' ? window.localStorage : undefined;

export function App() {
  const [chosen, setChosen] = useState(() => readChosenCountry(storage));
  const countries = useQuery({ queryKey: ['countries'], queryFn: fetchCountries });

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{t('app.title')}</h1>

      {chosen ? (
        <section className={styles.card}>
          <p>
            País elegido:{' '}
            <strong>{countries.data?.find((c) => c.code === chosen)?.name ?? chosen}</strong>
          </p>
          <p className={styles.muted}>
            El ingreso con código por WhatsApp llega en la Iteración 1.
          </p>
          <button className={styles.secondary} onClick={() => setChosen(null)}>
            Cambiar país
          </button>
        </section>
      ) : (
        <section className={styles.card} aria-labelledby="choose">
          <h2 id="choose" className={styles.subtitle}>
            {t('country.choose')}
          </h2>
          {countries.isPending && <p className={styles.muted}>Cargando…</p>}
          {countries.isError && (
            <p role="alert">
              No pudimos cargar los países. Revisa tu conexión e inténtalo de nuevo.
            </p>
          )}
          <ul className={styles.list}>
            {countries.data?.map((c) => (
              <li key={c.code}>
                <button
                  className={styles.primary}
                  onClick={() => {
                    saveChosenCountry(storage, c.code);
                    setChosen(c.code);
                  }}
                >
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
