#!/usr/bin/env bash
set -Eeuo pipefail

DOMAIN="${1:-${SEQORA_DOMAIN:-}}"
ENV_FILE="/opt/seqora/deploy/demo.env"
LOG_FILE="/var/log/seqora-domain-switch.log"

if [[ ! "${DOMAIN}" =~ ^[A-Za-z0-9.-]+$ ]] || [[ "${DOMAIN}" != *.* ]]; then
  echo "Usage: $0 example.com"
  echo "Or set SEQORA_DOMAIN before invoking the script."
  exit 2
fi

MARKER="/var/lib/seqora-bootstrap/domain-${DOMAIN//./-}-completed"

mkdir -p "$(dirname "$MARKER")"
touch "$LOG_FILE"
chmod 600 "$LOG_FILE"
exec > >(tee -a "$LOG_FILE") 2>&1

if [[ -f "$MARKER" ]]; then
  echo "Domain switch for ${DOMAIN} is already completed."
  exit 0
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE}."
  exit 1
fi

CURRENT_DOMAIN="$(sed -n 's/^APP_ADDRESS=//p' "$ENV_FILE" | tail -n 1)"

sed -i \
  -e "s|^APP_ADDRESS=.*|APP_ADDRESS=${DOMAIN}|" \
  -e "s|^WEB_ORIGIN=.*|WEB_ORIGIN=https://${DOMAIN}|" \
  -e "s|^PUBLIC_API_BASE_URL=.*|PUBLIC_API_BASE_URL=https://${DOMAIN}|" \
  -e "s|^AUTH_PASSWORD_RESET_URL=.*|AUTH_PASSWORD_RESET_URL=https://${DOMAIN}/reset-password|" \
  -e "s|^AUTH_EMAIL_VERIFICATION_URL=.*|AUTH_EMAIL_VERIFICATION_URL=https://${DOMAIN}/verify-email|" \
  -e "s|^AUTH_INVITATION_URL=.*|AUTH_INVITATION_URL=https://${DOMAIN}/register|" \
  -e "s|^BILLING_SUCCESS_URL=.*|BILLING_SUCCESS_URL=https://${DOMAIN}/billing/success|" \
  -e "s|^BILLING_CANCEL_URL=.*|BILLING_CANCEL_URL=https://${DOMAIN}/billing/cancelled|" \
  "$ENV_FILE"
chmod 600 "$ENV_FILE"

cd /opt/seqora
docker compose --env-file deploy/demo.env -f compose.demo.yml config --quiet
docker compose --env-file deploy/demo.env -f compose.demo.yml up -d --force-recreate

for _ in $(seq 1 120); do
  if curl --fail --silent --show-error \
    --resolve "${DOMAIN}:443:127.0.0.1" \
    "https://${DOMAIN}/api/v1/health" >/dev/null; then
    break
  fi
  sleep 5
done

curl --fail --silent --show-error \
  --resolve "${DOMAIN}:443:127.0.0.1" \
  "https://${DOMAIN}/api/v1/health" >/dev/null

if ! curl --fail --silent --show-error --max-time 15 \
  --resolve "${DOMAIN}:80:127.0.0.1" \
  -D - -o /dev/null "http://${DOMAIN}/" | grep -q '^Location: https://'; then
  echo "HTTP to HTTPS redirect check failed."
  exit 1
fi

docker compose --env-file deploy/demo.env -f compose.demo.yml ps
touch "$MARKER"
echo "Domain switch from ${CURRENT_DOMAIN:-unknown} to ${DOMAIN} completed."
