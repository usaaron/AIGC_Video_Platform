#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${SEQORA_ROOT:-/opt/seqora}"
ARCHIVE="${1:-}"
if [[ -z "$ARCHIVE" || ! -f "$ARCHIVE" ]]; then
  echo "Usage: update-source.sh /path/to/seqora-source.tgz" >&2
  exit 64
fi

STAMP="$(date -u +%Y%m%d-%H%M%S)"
BACKUP_ROOT="/opt/seqora-backups/source-${STAMP}"
NEW_ROOT="/opt/seqora.new-${STAMP}"
PRESERVE_DIR="/var/tmp/seqora-preserve-${STAMP}"
APP_DOMAIN=""
SWAPPED=0
ROLLED_BACK=0

mkdir -p "$PRESERVE_DIR" /opt/seqora-backups

if [[ -f "$ROOT/deploy/demo.env" ]]; then
  cp "$ROOT/deploy/demo.env" "$PRESERVE_DIR/demo.env"
fi
if [[ -f "$ROOT/deploy/release.env" ]]; then
  cp "$ROOT/deploy/release.env" "$PRESERVE_DIR/release.env"
fi

rollback() {
  local exit_code=$?
  if [[ "$exit_code" -ne 0 && "$SWAPPED" -eq 1 && "$ROLLED_BACK" -eq 0 ]]; then
    ROLLED_BACK=1
    echo "源码更新失败，恢复上一版本目录。" >&2
    docker compose --env-file "$ROOT/deploy/demo.env" -f "$ROOT/compose.demo.yml" down || true
    if [[ -d "$ROOT" ]]; then
      mv "$ROOT" "${ROOT}.failed-${STAMP}" || true
    fi
    if [[ -d "$BACKUP_ROOT" ]]; then
      mv "$BACKUP_ROOT" "$ROOT" || true
      docker compose --env-file "$ROOT/deploy/demo.env" -f "$ROOT/compose.demo.yml" up -d --build || true
    fi
  fi
  rm -rf "$NEW_ROOT" "$PRESERVE_DIR"
  exit "$exit_code"
}
trap rollback EXIT

mkdir -p "$NEW_ROOT"
tar -xzf "$ARCHIVE" -C "$NEW_ROOT"

if [[ -f "$PRESERVE_DIR/demo.env" ]]; then
  install -D -m 600 "$PRESERVE_DIR/demo.env" "$NEW_ROOT/deploy/demo.env"
fi
if [[ -f "$PRESERVE_DIR/release.env" ]]; then
  install -D -m 600 "$PRESERVE_DIR/release.env" "$NEW_ROOT/deploy/release.env"
fi
chmod 600 "$NEW_ROOT/deploy/demo.env"

if [[ -d "$ROOT" ]]; then
  mv "$ROOT" "$BACKUP_ROOT"
fi
mv "$NEW_ROOT" "$ROOT"
SWAPPED=1

APP_DOMAIN="$(sed -n 's/^APP_ADDRESS=//p' "$ROOT/deploy/demo.env" | tail -n 1)"
if [[ -z "$APP_DOMAIN" ]]; then
  echo 'APP_ADDRESS is missing from deploy/demo.env.' >&2
  exit 65
fi

compose=(docker compose --env-file "$ROOT/deploy/demo.env" -f "$ROOT/compose.demo.yml")
"${compose[@]}" config --quiet
"${compose[@]}" build api web
"${compose[@]}" up -d postgres redis
"${compose[@]}" run --rm --no-deps api node dist/scripts/dbMigrate.js
"${compose[@]}" up -d --remove-orphans --force-recreate api worker web

healthy=0
for _ in $(seq 1 60); do
  if curl --fail --silent --show-error --max-time 15 \
    --resolve "${APP_DOMAIN}:443:127.0.0.1" \
    "https://${APP_DOMAIN}/api/v1/health" >/dev/null; then
    healthy=1
    break
  fi
  sleep 5
done
if [[ "$healthy" -ne 1 ]]; then
  echo 'Health check did not pass after source update.' >&2
  exit 1
fi

"${compose[@]}" ps
rm -f "$ARCHIVE"
rm -rf "$PRESERVE_DIR"
trap - EXIT
echo "Seqora source update completed: ${STAMP}"
