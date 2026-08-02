#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${SEQORA_ROOT:-/opt/seqora}"
DEMO_ENV="${ROOT}/deploy/demo.env"

[[ -f "$DEMO_ENV" ]] || {
  echo "Missing ${DEMO_ENV}"
  exit 66
}

app_domain="$(sed -n 's/^APP_ADDRESS=//p' "$DEMO_ENV" | tail -n 1)"
email="$(sed -n 's/^BOOTSTRAP_MEMBER_EMAIL=//p' "$DEMO_ENV" | tail -n 1)"
password="$(sed -n 's/^BOOTSTRAP_MEMBER_PASSWORD=//p' "$DEMO_ENV" | tail -n 1)"

[[ -n "$app_domain" && -n "$email" && -n "$password" ]] || {
  echo 'Synthetic probe env is incomplete.'
  exit 65
}

docker run --rm \
  -e SYNTHETIC_BASE_URL="https://${app_domain}" \
  -e SYNTHETIC_EMAIL="$email" \
  -e SYNTHETIC_PASSWORD="$password" \
  -e SYNTHETIC_TIMEOUT_MS="${SYNTHETIC_TIMEOUT_MS:-10000}" \
  -e SYNTHETIC_ALERT_WEBHOOK_URL="${SYNTHETIC_ALERT_WEBHOOK_URL:-}" \
  -v "${ROOT}:/work" \
  -w /work \
  node:22-bookworm-slim \
  node scripts/monitoring/synthetic-probe.mjs
