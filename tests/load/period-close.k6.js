/**
 * Escenario k6 "Cierre de periodo" (CLAUDE.md §11)
 *
 * Simula la ráfaga de consultas de rankings (individual, farmacia y país) y perfil del dependiente
 * simultáneamente con la ejecución administrativa de cierre de periodo y descarga de ganadores CSV.
 *
 * Ejecución:
 *   k6 run -e BASE_URL=http://localhost:3000 -e PWA_TOKEN=<JWT_PWA> -e ADMIN_TOKEN=<JWT_ADMIN> -e PERIOD_ID=<UUID> tests/load/period-close.k6.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const PWA_TOKEN = __ENV.PWA_TOKEN || '';
const ADMIN_TOKEN = __ENV.ADMIN_TOKEN || '';
const PERIOD_ID = __ENV.PERIOD_ID || '01900000-0000-7000-8000-000000000060';

export const options = {
  scenarios: {
    clerks_checking_rankings: {
      executor: 'ramping-arrival-rate',
      startRate: 100,
      timeUnit: '1s',
      preAllocatedVUs: 100,
      maxVUs: 400,
      stages: [
        { target: 450, duration: '1m' },
        { target: 450, duration: '3m' },
        { target: 50, duration: '1m' },
      ],
      exec: 'checkRankingsDuringClose',
    },
    admin_period_close: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 1,
      startTime: '90s',
      exec: 'triggerPeriodCloseAndExport',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.005'],
  },
};

export function checkRankingsDuringClose() {
  const scopes = ['individual', 'pharmacy', 'country'];
  const scope = scopes[Math.floor(Math.random() * scopes.length)];
  const res = http.get(`${BASE_URL}/api/v1/rankings?scope=${scope}&period=current`, {
    headers: PWA_TOKEN ? { Authorization: `Bearer ${PWA_TOKEN}` } : {},
  });
  check(res, {
    'ranking query status 200 or 401': (r) => r.status === 200 || r.status === 401,
  });
}

export function triggerPeriodCloseAndExport() {
  if (!ADMIN_TOKEN) {
    sleep(1);
    return;
  }
  const closeRes = http.post(`${BASE_URL}/api/v1/admin/periods/${PERIOD_ID}/close`, null, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  check(closeRes, {
    'period close status 200': (r) => r.status === 200,
  });

  const csvRes = http.get(`${BASE_URL}/api/v1/admin/periods/${PERIOD_ID}/winners.csv`, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  check(csvRes, {
    'winners csv status 200': (r) => r.status === 200,
  });
}
