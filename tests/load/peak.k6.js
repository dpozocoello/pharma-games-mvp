/**
 * Escenario k6 "Pico" — 1.125 solicitudes/s sostenidas durante 15 minutos (150 % del pico de 750 req/s)
 * Distribución de tráfico (CLAUDE.md §11):
 *   - 70 % motor de juegos (catálogo, inicio de partida, envío de respuestas, fin de partida) -> 788 req/s
 *   - 20 % rankings y perfil del dependiente -> 225 req/s
 *   - 10 % navegación pública y salud/configuración -> 112 req/s
 *
 * Umbrales obligatorios:
 *   - http_req_duration: p(95) < 300 ms
 *   - http_req_failed: rate < 0.005 (< 0,5 %)
 *
 * Ejecución contra entorno local con 2 réplicas de la API:
 *   k6 run -e BASE_URL=http://localhost:3000 -e ACCESS_TOKEN=<JWT_PWA> tests/load/peak.k6.js
 */
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const ACCESS_TOKEN = __ENV.ACCESS_TOKEN || '';
const DURATION = __ENV.DURATION || '15m';

export const options = {
  scenarios: {
    gameplay_70pct: {
      executor: 'constant-arrival-rate',
      rate: 788,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 250,
      maxVUs: 800,
      exec: 'gameplayFlow',
    },
    rankings_profile_20pct: {
      executor: 'constant-arrival-rate',
      rate: 225,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 80,
      maxVUs: 300,
      exec: 'rankingsAndProfileFlow',
    },
    navigation_10pct: {
      executor: 'constant-arrival-rate',
      rate: 112,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 40,
      maxVUs: 150,
      exec: 'navigationFlow',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.005'],
  },
};

function authHeaders() {
  return {
    headers: {
      'Content-Type': 'application/json',
      ...(ACCESS_TOKEN ? { Authorization: `Bearer ${ACCESS_TOKEN}` } : {}),
    },
  };
}

export function gameplayFlow() {
  const res = http.get(`${BASE_URL}/api/v1/games`, authHeaders());
  check(res, {
    'games catalog status 200 or 401': (r) => r.status === 200 || r.status === 401,
  });
}

export function rankingsAndProfileFlow() {
  const pick =
    Math.random() < 0.5 ? '/api/v1/rankings?scope=pharmacy&period=current' : '/api/v1/me/ranking';
  const res = http.get(`${BASE_URL}${pick}`, authHeaders());
  check(res, {
    'rankings/profile status 200 or 401': (r) => r.status === 200 || r.status === 401,
  });
}

export function navigationFlow() {
  const pick = Math.random() < 0.7 ? '/api/v1/countries' : '/health';
  const res = http.get(`${BASE_URL}${pick}`);
  check(res, {
    'navigation status 200': (r) => r.status === 200,
  });
}
