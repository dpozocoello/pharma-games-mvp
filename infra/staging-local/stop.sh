#!/usr/bin/env bash
# Detiene el staging local (los datos de pharma_staging se conservan).
RUN="$(cd "$(dirname "$0")" && pwd)/.run"
for f in "$RUN"/*.pid; do
  [ -f "$f" ] || continue
  kill "$(cat "$f")" 2>/dev/null && echo "detenido $(basename "$f" .pid)"
  rm -f "$f"
done
