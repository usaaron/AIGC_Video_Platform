#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${SEQORA_ROOT:-/opt/seqora}"
COMPOSE_FILE="${ROOT}/compose.demo.yml"
DEMO_ENV="${ROOT}/deploy/demo.env"
RELEASE_ENV="${ROOT}/deploy/release.env"
STATE_DIR="/var/lib/seqora-release"
BACKUP_DIR="/opt/seqora-backups/releases"
LOCK_FILE="/var/lock/seqora-release.lock"

usage() {
  echo 'Usage: update-release.sh <api IMAGE | web IMAGE | all API_IMAGE WEB_IMAGE>'
  exit 64
}

component="${1:-}"
case "$component" in
  api | web)
    [[ $# -eq 2 ]] || usage
    ;;
  all)
    [[ $# -eq 3 ]] || usage
    ;;
  *) usage ;;
esac

validate_image() {
  [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,511}$ ]] || {
    echo "Invalid image reference: $1"
    exit 64
  }
}

if [[ "$component" == 'api' ]]; then
  validate_image "$2"
elif [[ "$component" == 'web' ]]; then
  validate_image "$2"
else
  validate_image "$2"
  validate_image "$3"
fi

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo 'Another Seqora release is already running.'
  exit 75
fi

[[ -f "$COMPOSE_FILE" ]] || { echo "Missing $COMPOSE_FILE"; exit 66; }
[[ -f "$DEMO_ENV" ]] || { echo "Missing $DEMO_ENV"; exit 66; }
mkdir -p "$STATE_DIR" "$BACKUP_DIR" "$(dirname "$RELEASE_ENV")"

running_image() {
  docker inspect --format '{{.Config.Image}}' "$1" 2>/dev/null || true
}

if [[ ! -f "$RELEASE_ENV" ]]; then
  current_api="$(running_image seqora-demo-api-1)"
  current_web="$(running_image seqora-demo-web-1)"
  printf 'API_IMAGE=%s\nWEB_IMAGE=%s\n' \
    "${current_api:-seqora-api:local}" \
    "${current_web:-seqora-web:local}" > "$RELEASE_ENV"
  chmod 600 "$RELEASE_ENV"
fi

env_value() {
  sed -n "s/^${1}=//p" "$RELEASE_ENV" | tail -n 1
}

previous_api="$(env_value API_IMAGE)"
previous_web="$(env_value WEB_IMAGE)"
[[ -n "$previous_api" && -n "$previous_web" ]] || {
  echo 'release.env must define API_IMAGE and WEB_IMAGE.'
  exit 65
}

next_api="$previous_api"
next_web="$previous_web"
services=()
case "$component" in
  api)
    next_api="$2"
    services=(api worker)
    ;;
  web)
    next_web="$2"
    services=(web)
    ;;
  all)
    next_api="$2"
    next_web="$3"
    services=(api worker web)
    ;;
esac

metadata_token() {
  curl --fail --silent --show-error \
    -H 'Metadata-Flavor: Google' \
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token' \
    | sed -E 's/.*"access_token"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'
}

pull_image() {
  local image="$1"
  local registry="${image%%/*}"
  if [[ "$registry" == *-docker.pkg.dev ]]; then
    metadata_token | docker login -u oauth2accesstoken --password-stdin "$registry" >/dev/null
  fi
  docker pull "$image"
  if [[ "$registry" == *-docker.pkg.dev ]]; then
    docker logout "$registry" >/dev/null 2>&1 || true
  fi
}

if [[ "$component" == 'api' || "$component" == 'all' ]]; then
  pull_image "$next_api"
fi
if [[ "$component" == 'web' || "$component" == 'all' ]]; then
  pull_image "$next_web"
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
release_backup="${BACKUP_DIR}/release-env-${timestamp}"
cp "$RELEASE_ENV" "$release_backup"
chmod 600 "$release_backup"

docker run --rm \
  -v seqora-demo_seqora_data:/data:ro \
  -v "${BACKUP_DIR}:/backup" \
  alpine:3.21 \
  sh -c "if [ -f /data/app.json ]; then cp /data/app.json /backup/app-${timestamp}.json; fi"

compose=(docker compose --env-file "$DEMO_ENV" --env-file "$RELEASE_ENV" -f "$COMPOSE_FILE")
changed=0

rollback() {
  local exit_code="$1"
  trap - ERR
  if [[ "$changed" -eq 1 ]]; then
    echo 'Release health check failed. Restoring previous image manifest.'
    cp "$release_backup" "$RELEASE_ENV"
    chmod 600 "$RELEASE_ENV"
    "${compose[@]}" up -d --no-build --force-recreate "${services[@]}" || true
  fi
  exit "$exit_code"
}
trap 'rollback $?' ERR

temporary_env="${RELEASE_ENV}.tmp"
printf 'API_IMAGE=%s\nWEB_IMAGE=%s\n' "$next_api" "$next_web" > "$temporary_env"
chmod 600 "$temporary_env"
mv "$temporary_env" "$RELEASE_ENV"
changed=1

"${compose[@]}" config --quiet
if [[ "$component" == 'api' || "$component" == 'all' ]]; then
  "${compose[@]}" run --rm --no-deps api node dist/scripts/dbMigrate.js
fi
"${compose[@]}" up -d --no-build --force-recreate "${services[@]}"

app_domain="$(sed -n 's/^APP_ADDRESS=//p' "$DEMO_ENV" | tail -n 1)"
[[ -n "$app_domain" ]] || { echo 'APP_ADDRESS is missing from demo.env.'; false; }
for _ in $(seq 1 60); do
  if curl --fail --silent --show-error --max-time 15 \
    --resolve "${app_domain}:443:127.0.0.1" \
    "https://${app_domain}/api/v1/health" >/dev/null; then
    break
  fi
  sleep 3
done
curl --fail --silent --show-error --max-time 15 \
  --resolve "${app_domain}:443:127.0.0.1" \
  "https://${app_domain}/api/v1/health" >/dev/null

"${compose[@]}" ps
cat > "${STATE_DIR}/current.json" <<EOF
{"deployedAt":"$(date -u -Iseconds)","component":"${component}","apiImage":"${next_api}","webImage":"${next_web}"}
EOF
chmod 600 "${STATE_DIR}/current.json"
docker image prune --force >/dev/null
changed=0
trap - ERR
echo "Seqora ${component} release completed."
