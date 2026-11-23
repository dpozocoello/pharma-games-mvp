#!/usr/bin/env bash
# Staging local con configuración de PRODUCCIÓN (NODE_ENV=production): build, base de datos propia,
# 2 réplicas de la API detrás del gateway y mensajería simulada. Requiere PostgreSQL 16 y Redis 7
# (p. ej. `pnpm infra:up`). Uso: infra/staging-local/start.sh   ·   detener: infra/staging-local/stop.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
RUN="$HERE/.run"
mkdir -p "$RUN"

. "$HERE/env.sh"

echo "› Build"
(cd "$ROOT" && pnpm build > "$RUN/build.log" 2>&1)

echo "› Base de datos (migraciones + semillas)"
(cd "$ROOT/apps/api" && pnpm exec prisma migrate deploy > "$RUN/migrate.log" 2>&1 \
  && pnpm exec tsx prisma/seed.ts > "$RUN/seed.log" 2>&1)

start() { # nombre, comando...
  local name="$1"; shift
  nohup "$@" > "$RUN/$name.log" 2>&1 &
  echo $! > "$RUN/$name.pid"
}

echo "› Mensajería simulada, 2 réplicas de la API y gateway"
start messaging node "$HERE/mock-messaging.mjs"
# Solo la réplica 1 corre los workers (OTP y foto diaria); ambas atienden tráfico.
"$HERE/replica.sh" 1 3001 true
"$HERE/replica.sh" 2 3002 false
start gateway node "$HERE/gateway.mjs"

for i in $(seq 1 60); do
  if curl -sf localhost:3001/ready >/dev/null && curl -sf localhost:3002/ready >/dev/null \
    && curl -sf localhost:8080/health >/dev/null; then
    echo "✓ Listo"
    echo "  PWA (dependiente/gerente): http://localhost:8080"
    echo "  Panel de administración:   http://localhost:8081"
    echo "  Bandeja de mensajes OTP:   http://localhost:4010/__inbox?to=+51900000001"
    exit 0
  fi
  sleep 1
done
echo "✗ No arrancó: revisa $RUN/*.log" >&2
exit 1
