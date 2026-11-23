# Configuración de PRODUCCIÓN del staging local (se carga desde start.sh y replica.sh).
HERE="${HERE:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
RUN="$HERE/.run"
mkdir -p "$RUN"
: "${STAGING_DATABASE_URL:=postgresql://pharma:pharma_dev_only@localhost:55432/pharma_staging?schema=public}"
: "${STAGING_REDIS_URL:=redis://localhost:6379/2}"

# Secretos de staging: aleatorios, solo en .run/ (ignorado por git), nunca en el repositorio.
if [ ! -f "$RUN/secrets.env" ]; then
  {
    echo "DOCUMENT_HASH_SECRET=$(openssl rand -hex 32)"
    echo "SESSION_TOKEN_SECRET=$(openssl rand -hex 32)"
    echo "AUTH_TOKEN_SECRET=$(openssl rand -hex 32)"
  } > "$RUN/secrets.env"
fi
set -a; . "$RUN/secrets.env"; set +a

export NODE_ENV=production
export DATABASE_URL="$STAGING_DATABASE_URL" REDIS_URL="$STAGING_REDIS_URL"
export COOKIE_SECURE=true TRUST_PROXY_HOPS=1 LOG_LEVEL=info
export CORS_ORIGINS="http://localhost:8080,http://localhost:8081"
export MESSAGING_PROVIDER=whatsapp
export WHATSAPP_API_URL=http://127.0.0.1:4010/v21.0 WHATSAPP_PHONE_NUMBER_ID=staging WHATSAPP_TOKEN=staging-token
export SMS_API_URL=http://127.0.0.1:4010/sms SMS_API_TOKEN=staging-token

