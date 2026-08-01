#!/usr/bin/env bash
set -Eeuo pipefail

RELEASE="20260721"
DEPLOY_ID="20260721-storage-credentials-v3"
BUCKET="seqora-deploy-project-935680ce-9aaf-496a-bb7"
SOURCE_OBJECT="releases%2F${RELEASE}%2Fseqora-source.tgz"
RUNTIME_OBJECT="releases%2F${RELEASE}%2Fseqora-runtime.tgz"
CREDENTIALS_OBJECT="releases%2F${RELEASE}%2Fcredentials-patch.json"
SOURCE_SHA256="642CAD919DA5C1D3833EA19148AC78424BB8504EADAEFEA1EE8DED758D789414"
RUNTIME_SHA256="9FA245CC4E10E3D4DF16E6E479DD53BD60EFD0060AA45F6F2220ECFD4EACC670"
CREDENTIALS_SHA256="52201ECF4D84E1FA81B4ED6FDD9624C6AC4D40472863100EB9A84988CCC3F020"
DEPLOY_USER="seqoradeploy"
DEPLOY_PUBLIC_KEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGNFhKCScWH55AjTj4iktBHz1qurUsbWcIYcS4n3uEtc unswaaronzhang@gmail.com"
STATE_DIR="/var/lib/seqora-bootstrap"
LOG_FILE="/var/log/seqora-bootstrap.log"
MARKER="${STATE_DIR}/completed-${DEPLOY_ID}"

mkdir -p "$STATE_DIR"
touch "$LOG_FILE"
chmod 600 "$LOG_FILE"
exec > >(tee -a "$LOG_FILE") 2>&1

on_error() {
  local exit_code=$?
  printf 'failed:%s:%s\n' "$(date -Iseconds)" "$exit_code" > "${STATE_DIR}/status"
  exit "$exit_code"
}
trap on_error ERR

if [[ -f "$MARKER" ]]; then
  echo "Seqora deployment ${DEPLOY_ID} is already completed."
  exit 0
fi

printf 'running:%s\n' "$(date -Iseconds)" > "${STATE_DIR}/status"

if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$DEPLOY_USER"
fi
usermod -aG sudo "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/${DEPLOY_USER}/.ssh"
printf '%s\n' "$DEPLOY_PUBLIC_KEY" > "/home/${DEPLOY_USER}/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/${DEPLOY_USER}/.ssh/authorized_keys"
chmod 600 "/home/${DEPLOY_USER}/.ssh/authorized_keys"
printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$DEPLOY_USER" > "/etc/sudoers.d/${DEPLOY_USER}"
chmod 440 "/etc/sudoers.d/${DEPLOY_USER}"
passwd -l root >/dev/null 2>&1 || true
systemctl restart ssh || systemctl restart sshd

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl docker.io
if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y --no-install-recommends docker-compose-v2
fi
systemctl enable --now docker
usermod -aG docker "$DEPLOY_USER"
apt-get clean
rm -rf /var/lib/apt/lists/*

download_object() {
  local object_name="$1"
  local destination="$2"
  local token
  token="$(curl -fsS -H 'Metadata-Flavor: Google' \
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token' \
    | sed -E 's/.*"access_token"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
  curl --fail --location --retry 8 --retry-all-errors \
    -H "Authorization: Bearer ${token}" \
    "https://storage.googleapis.com/download/storage/v1/b/${BUCKET}/o/${object_name}?alt=media" \
    --output "$destination"
}

download_object "$SOURCE_OBJECT" /var/tmp/seqora-source.tgz
download_object "$RUNTIME_OBJECT" /var/tmp/seqora-runtime.tgz
download_object "$CREDENTIALS_OBJECT" /var/tmp/credentials-patch.json
printf '%s  %s\n' "$SOURCE_SHA256" /var/tmp/seqora-source.tgz | sha256sum --check --strict
printf '%s  %s\n' "$RUNTIME_SHA256" /var/tmp/seqora-runtime.tgz | sha256sum --check --strict
printf '%s  %s\n' "$CREDENTIALS_SHA256" /var/tmp/credentials-patch.json | sha256sum --check --strict

rm -rf /opt/seqora.new /opt/seqora-runtime.new
mkdir -p /opt/seqora.new /opt/seqora-runtime.new /opt/seqora-backups
tar -xzf /var/tmp/seqora-source.tgz -C /opt/seqora.new
tar -xzf /var/tmp/seqora-runtime.tgz -C /opt/seqora-runtime.new
chmod 600 /opt/seqora.new/deploy/demo.env

if [[ -f /opt/seqora/compose.demo.yml ]]; then
  (
    cd /opt/seqora
    docker compose --env-file deploy/demo.env -f compose.demo.yml down || true
  )
fi

if [[ -d /opt/seqora ]]; then
  mv /opt/seqora "/opt/seqora-backups/source-$(date +%Y%m%d-%H%M%S)"
fi
mv /opt/seqora.new /opt/seqora
rm -rf /opt/seqora-runtime
mv /opt/seqora-runtime.new /opt/seqora-runtime

DATA_VOLUME="seqora-demo_seqora_data"
if docker volume inspect "$DATA_VOLUME" >/dev/null 2>&1; then
  docker run --rm \
    -v "${DATA_VOLUME}:/source:ro" \
    -v /opt/seqora-backups:/backup \
    alpine:3.21 \
    sh -c 'tar -czf "/backup/data-$(date +%Y%m%d-%H%M%S).tgz" -C /source .'
else
  docker volume create "$DATA_VOLUME" >/dev/null
fi

docker run --rm \
  -v "${DATA_VOLUME}:/target" \
  -v /opt/seqora-runtime:/source:ro \
  alpine:3.21 \
  sh -c 'find /target -mindepth 1 -maxdepth 1 -exec rm -rf {} +; cp -a /source/. /target/; if [ -d /target/uploads/uploads ]; then cp -a /target/uploads/uploads/. /target/uploads/; rm -rf /target/uploads/uploads; fi; chown -R 1000:1000 /target'

docker run --rm \
  -v "${DATA_VOLUME}:/data" \
  -v /opt/seqora/deploy/credential-patch.mjs:/work/credential-patch.mjs:ro \
  -v /var/tmp/credentials-patch.json:/work/credentials-patch.json:ro \
  node:22-bookworm-slim \
  node /work/credential-patch.mjs apply /work/credentials-patch.json /data/app.json
docker run --rm -v "${DATA_VOLUME}:/data" alpine:3.21 chown -R 1000:1000 /data

cd /opt/seqora
docker compose --env-file deploy/demo.env -f compose.demo.yml config --quiet
APP_DOMAIN="$(sed -n 's/^APP_ADDRESS=//p' deploy/demo.env | tail -n 1)"
if [[ -z "$APP_DOMAIN" ]]; then
  echo 'APP_ADDRESS is missing from deploy/demo.env.'
  exit 1
fi

echo 'Port 80/443 listeners before Seqora startup:'
ss -ltnp '( sport = :80 or sport = :443 )' || true
for service in nginx apache2 caddy; do
  if systemctl is-active --quiet "$service"; then
    systemctl disable --now "$service"
  fi
done
mapfile -t conflicting_containers < <(
  {
    docker ps --filter publish=80 --format '{{.ID}}'
    docker ps --filter publish=443 --format '{{.ID}}'
  } | sort -u
)
if (( ${#conflicting_containers[@]} > 0 )); then
  docker stop "${conflicting_containers[@]}"
fi
echo 'Port 80/443 listeners after conflict cleanup:'
ss -ltnp '( sport = :80 or sport = :443 )' || true

docker compose --env-file deploy/demo.env -f compose.demo.yml up -d --build

for _ in $(seq 1 60); do
  if curl --fail --silent --show-error \
    --resolve "${APP_DOMAIN}:443:127.0.0.1" \
    "https://${APP_DOMAIN}/api/v1/health" >/dev/null; then
    break
  fi
  sleep 5
done
curl --fail --silent --show-error \
  --resolve "${APP_DOMAIN}:443:127.0.0.1" \
  "https://${APP_DOMAIN}/api/v1/health" >/dev/null

install -m 0644 /opt/seqora/deploy/systemd/seqora-synthetic-probe.service /etc/systemd/system/seqora-synthetic-probe.service
install -m 0644 /opt/seqora/deploy/systemd/seqora-synthetic-probe.timer /etc/systemd/system/seqora-synthetic-probe.timer
systemctl daemon-reload
systemctl enable --now seqora-synthetic-probe.timer

docker compose --env-file deploy/demo.env -f compose.demo.yml ps
rm -f /var/tmp/seqora-source.tgz /var/tmp/seqora-runtime.tgz /var/tmp/credentials-patch.json
touch "$MARKER"
printf 'completed:%s\n' "$(date -Iseconds)" > "${STATE_DIR}/status"
echo "Seqora deployment ${DEPLOY_ID} completed."
