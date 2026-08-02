#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${SEQORA_ROOT:-/opt/seqora}"
COMPOSE_FILE="${SEQORA_COMPOSE_FILE:-${ROOT}/compose.demo.yml}"
DEMO_ENV="${SEQORA_DEMO_ENV:-${ROOT}/deploy/demo.env}"
DATA_VOLUME="${SEQORA_DATA_VOLUME:-seqora-demo_seqora_data}"
RUN_MIGRATIONS="${SEQORA_RESTORE_RUN_MIGRATIONS:-true}"
SKIP_SAFETY_BACKUP="${SEQORA_RESTORE_SKIP_SAFETY_BACKUP:-false}"
CONFIRM=false

usage() {
  cat <<'EOF'
Usage: restore-demo.sh --yes BACKUP_DIR

Restores Postgres and JSON history from a backup created by deploy/backup-demo.sh.
The script does not automatically overwrite GCS objects. Use
deploy/restore-gcs-version.sh for specific object generations after validating
the gcs-object-versions manifest.

Safety:
  - Stops API and Worker before restore.
  - Creates a pre-restore backup unless SEQORA_RESTORE_SKIP_SAFETY_BACKUP=true.
  - Requires --yes or SEQORA_RESTORE_CONFIRM=replace-seqora-data.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes)
      CONFIRM=true
      shift
      ;;
    --help | -h)
      usage
      exit 0
      ;;
    --*)
      usage
      exit 64
      ;;
    *)
      break
      ;;
  esac
done

backup_dir="${1:-}"
if [[ -z "$backup_dir" || $# -ne 1 ]]; then
  usage
  exit 64
fi

if [[ "$CONFIRM" != 'true' && "${SEQORA_RESTORE_CONFIRM:-}" != 'replace-seqora-data' ]]; then
  echo 'Refusing to replace data without --yes or SEQORA_RESTORE_CONFIRM=replace-seqora-data.'
  exit 64
fi

[[ -d "$backup_dir" ]] || { echo "Missing backup directory: $backup_dir"; exit 66; }
[[ -f "${backup_dir}/postgres.dump" ]] || { echo "Missing ${backup_dir}/postgres.dump"; exit 66; }
[[ -f "$COMPOSE_FILE" ]] || { echo "Missing compose file: $COMPOSE_FILE"; exit 66; }
[[ -f "$DEMO_ENV" ]] || { echo "Missing env file: $DEMO_ENV"; exit 66; }

compose=(docker compose --env-file "$DEMO_ENV" -f "$COMPOSE_FILE")

"${compose[@]}" up -d postgres redis >/dev/null
for _ in $(seq 1 60); do
  if "${compose[@]}" exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
"${compose[@]}" exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null

"${compose[@]}" stop worker api >/dev/null || true

if [[ "$SKIP_SAFETY_BACKUP" != 'true' ]]; then
  if [[ -x "${ROOT}/deploy/backup-demo.sh" ]]; then
    SEQORA_ROOT="$ROOT" \
      SEQORA_COMPOSE_FILE="$COMPOSE_FILE" \
      SEQORA_DEMO_ENV="$DEMO_ENV" \
      SEQORA_DATA_VOLUME="$DATA_VOLUME" \
      SEQORA_BACKUP_QUIESCE=false \
      SEQORA_BACKUP_DIR="${SEQORA_PRE_RESTORE_BACKUP_DIR:-/opt/seqora-backups/pre-restore}" \
      "${ROOT}/deploy/backup-demo.sh" --online
  else
    echo "Skipping safety backup because ${ROOT}/deploy/backup-demo.sh is not executable."
  fi
fi

"${compose[@]}" exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public AUTHORIZATION \"$POSTGRES_USER\";"'
cat "${backup_dir}/postgres.dump" | "${compose[@]}" exec -T postgres sh -c \
  'pg_restore --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

if [[ -f "${backup_dir}/json/app.json" || -f "${backup_dir}/json/uploads.tgz" ]]; then
  docker run --rm \
    -v "${DATA_VOLUME}:/data" \
    -v "${backup_dir}/json:/backup:ro" \
    alpine:3.21 \
    sh -ec '
      mkdir -p /data
      if [ -f /backup/app.json ]; then
        cp /backup/app.json /data/app.json
      fi
      if [ -f /backup/uploads.tgz ]; then
        rm -rf /data/uploads
        tar -xzf /backup/uploads.tgz -C /data
      fi
    '
fi

if [[ "$RUN_MIGRATIONS" == 'true' ]]; then
  "${compose[@]}" run --rm api node dist/scripts/dbMigrate.js
fi

"${compose[@]}" up -d api worker web

app_domain="$(sed -n 's/^APP_ADDRESS=//p' "$DEMO_ENV" | tail -n 1)"
if [[ -n "$app_domain" ]]; then
  for _ in $(seq 1 60); do
    if curl --fail --silent --show-error --max-time 15 \
      --resolve "${app_domain}:443:127.0.0.1" \
      "https://${app_domain}/api/v1/health" >/dev/null 2>&1; then
      break
    fi
    sleep 3
  done
  curl --fail --silent --show-error --max-time 15 \
    --resolve "${app_domain}:443:127.0.0.1" \
    "https://${app_domain}/api/v1/health" >/dev/null
fi

"${compose[@]}" ps
echo "Postgres and JSON restore completed from: ${backup_dir}"
if [[ -f "${backup_dir}/gcs-object-versions.txt" || -f "${backup_dir}/gcs-live-objects.json" ]]; then
  echo 'GCS object versions were not modified. Restore specific generations with deploy/restore-gcs-version.sh.'
fi
