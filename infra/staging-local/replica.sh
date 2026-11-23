#!/usr/bin/env bash
# Levanta una réplica de la API con la configuración de producción del staging.
# Uso: replica.sh <número> <puerto> <workers: true|false>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
. "$HERE/env.sh"
API_PORT="$2" OTP_WORKER_ENABLED="$3" JOBS_WORKER_ENABLED="$3" \
  nohup node "$ROOT/apps/api/dist/main.js" > "$RUN/api-$1.log" 2>&1 &
echo $! > "$RUN/api-$1.pid"
