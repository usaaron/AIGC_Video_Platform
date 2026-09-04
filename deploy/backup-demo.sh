#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${SEQORA_ROOT:-/opt/seqora}"
COMPOSE_FILE="${SEQORA_COMPOSE_FILE:-${ROOT}/compose.demo.yml}"
DEMO_ENV="${SEQORA_DEMO_ENV:-${ROOT}/deploy/demo.env}"
RELEASE_ENV="${SEQORA_RELEASE_ENV:-${ROOT}/deploy/release.env}"
BACKUP_ROOT="${SEQORA_BACKUP_DIR:-/opt/seqora-backups/manual}"
DATA_VOLUME="${SEQORA_DATA_VOLUME:-seqora-demo_seqora_data}"
QUIESCE="${SEQORA_BACKUP_QUIESCE:-true}"

usage() {
  cat <<'EOF'
Usage: backup-demo.sh [--online]

Creates a backup directory containing:
  postgres.dump              Postgres custom-format dump
  schema_migrations.csv      Applied migration records
  table_counts.csv           Approximate Postgres table counts
  json/app.json              JSON compatibility/history store
  json/uploads.tgz           Local uploads snapshot when present
  gcs-bucket.json            GCS bucket metadata when configured
  gcs-object-versions.txt    GCS live and noncurrent object generation URLs
  gcs-live-objects.json      GCS live object metadata when configured
  manifest.json              Non-secret backup metadata

Options:
  --online   Do not stop API/Worker while backing up. Use only for low-risk drills.
EOF
}

if [[ "${1:-}" == '--help' || "${1:-}" == '-h' ]]; then
  usage
  exit 0
fi

if [[ "${1:-}" == '--online' ]]; then
  QUIESCE=false
  shift
fi

if [[ $# -ne 0 ]]; then
  usage
  exit 64
fi

[[ -f "$COMPOSE_FILE" ]] || { echo "Missing compose file: $COMPOSE_FILE"; exit 66; }
[[ -f "$DEMO_ENV" ]] || { echo "Missing env file: $DEMO_ENV"; exit 66; }
mkdir -p "$BACKUP_ROOT"

compose=(docker compose --env-file "$DEMO_ENV")
if [[ -f "$RELEASE_ENV" ]]; then
  compose+=(--env-file "$RELEASE_ENV")
fi
compose+=(-f "$COMPOSE_FILE")
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${BACKUP_ROOT}/${timestamp}"
mkdir -p "${backup_dir}/json"
warnings_file="${backup_dir}/warnings.log"
touch "$warnings_file"

warn() {
  echo "WARN: $*" | tee -a "$warnings_file" >&2
}

env_value() {
  sed -n "s/^${1}=//p" "$DEMO_ENV" | tail -n 1
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

running_services() {
  "${compose[@]}" ps --status running --services 2>/dev/null || true
}

was_api_running=false
was_worker_running=false
services_to_restore=()
if running_services | grep -qx 'api'; then
  was_api_running=true
  services_to_restore+=(api)
fi
if running_services | grep -qx 'worker'; then
  was_worker_running=true
  services_to_restore+=(worker)
fi

restore_quiesced_services() {
  local exit_code="$1"
  trap - EXIT
  if [[ "$QUIESCE" == 'true' ]]; then
    if [[ "${#services_to_restore[@]}" -gt 0 ]]; then
      "${compose[@]}" up -d "${services_to_restore[@]}" >/dev/null || true
    fi
  fi
  exit "$exit_code"
}
trap 'restore_quiesced_services $?' EXIT

if [[ "$QUIESCE" == 'true' ]]; then
  services_to_stop=()
  [[ "$was_worker_running" == 'true' ]] && services_to_stop+=(worker)
  [[ "$was_api_running" == 'true' ]] && services_to_stop+=(api)
  if [[ "${#services_to_stop[@]}" -gt 0 ]]; then
    "${compose[@]}" stop "${services_to_stop[@]}"
  fi
else
  warn 'Running online backup without quiescing API/Worker.'
fi

# Data services own persistent volumes. Never recreate them during a backup.
"${compose[@]}" up -d --no-recreate --no-deps postgres redis >/dev/null
for _ in $(seq 1 60); do
  if "${compose[@]}" exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
"${compose[@]}" exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null

"${compose[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "${backup_dir}/postgres.dump"

"${compose[@]}" exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" --csv -c "SELECT name, applied_at FROM schema_migrations ORDER BY name"' \
  > "${backup_dir}/schema_migrations.csv" || warn 'Could not export schema_migrations.'

"${compose[@]}" exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" --csv -c "SELECT schemaname || '"'"'.'"'"' || relname AS table_name, n_live_tup AS estimated_rows FROM pg_stat_user_tables ORDER BY table_name"' \
  > "${backup_dir}/table_counts.csv" || warn 'Could not export table counts.'

docker run --rm \
  -v "${DATA_VOLUME}:/data:ro" \
  -v "${backup_dir}/json:/backup" \
  alpine:3.21 \
  sh -ec '
    if [ -f /data/app.json ]; then
      cp /data/app.json /backup/app.json
    else
      printf "app.json was not present in /var/lib/seqora\n" > /backup/app.missing.txt
    fi
    if [ -d /data/uploads ]; then
      tar -czf /backup/uploads.tgz -C /data uploads
    fi
  '

storage_driver="$(env_value STORAGE_DRIVER)"
gcs_bucket="$(env_value GCS_BUCKET)"
if [[ "$storage_driver" == 'gcs' && -n "$gcs_bucket" && "$gcs_bucket" != replace-* ]]; then
  if command -v gcloud >/dev/null 2>&1; then
    gcloud storage buckets describe "gs://${gcs_bucket}" --format=json \
      > "${backup_dir}/gcs-bucket.json" || warn "Could not describe gs://${gcs_bucket}."
    gcloud storage ls --all-versions --recursive --long "gs://${gcs_bucket}" \
      > "${backup_dir}/gcs-object-versions.txt" || warn "Could not list object versions for gs://${gcs_bucket}."
    gcloud storage ls --recursive --json "gs://${gcs_bucket}" \
      > "${backup_dir}/gcs-live-objects.json" || warn "Could not list live object metadata for gs://${gcs_bucket}."
  else
    warn 'gcloud is not installed; skipped GCS bucket metadata and object version manifest.'
  fi
else
  warn 'GCS is not configured; skipped object version manifest.'
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$DEMO_ENV" > "${backup_dir}/demo-env.sha256"
else
  warn 'sha256sum is not installed; skipped demo.env checksum.'
fi

git_commit="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)"
migration_head="$(tail -n +2 "${backup_dir}/schema_migrations.csv" 2>/dev/null | tail -n 1 | cut -d',' -f1 || true)"
app_address="$(env_value APP_ADDRESS)"

cat > "${backup_dir}/manifest.json" <<EOF
{
  "schemaVersion": 1,
  "createdAt": "${timestamp}",
  "createdBy": "deploy/backup-demo.sh",
  "root": "$(json_escape "$ROOT")",
  "composeFile": "$(json_escape "$COMPOSE_FILE")",
  "envFile": "$(json_escape "$DEMO_ENV")",
  "gitCommit": "$(json_escape "$git_commit")",
  "migrationHead": "$(json_escape "$migration_head")",
  "quiescedApiAndWorker": ${QUIESCE},
  "dataVolume": "$(json_escape "$DATA_VOLUME")",
  "appAddress": "$(json_escape "$app_address")",
  "storageDriver": "$(json_escape "$storage_driver")",
  "gcsBucket": "$(json_escape "$gcs_bucket")",
  "containsSecrets": false
}
EOF

if [[ ! -s "$warnings_file" ]]; then
  rm -f "$warnings_file"
fi

echo "Backup created: ${backup_dir}"
