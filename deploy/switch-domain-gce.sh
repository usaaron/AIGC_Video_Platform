#!/usr/bin/env bash
set -Eeuo pipefail

DOMAIN="zjh.ai"
ENV_FILE="/opt/seqora/deploy/demo.env"
LOG_FILE="/var/log/seqora-domain-switch.log"
MARKER="/var/lib/seqora-bootstrap/domain-zjh-ai-completed"

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

sed -i \
  -e "s|^APP_ADDRESS=.*|APP_ADDRESS=${DOMAIN}|" \
  -e "s|^WEB_ORIGIN=.*|WEB_ORIGIN=https://${DOMAIN}|" \
  -e "s|^PUBLIC_API_BASE_URL=.*|PUBLIC_API_BASE_URL=https://${DOMAIN}|" \
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
echo "Domain switch for ${DOMAIN} completed."
