#!/usr/bin/env bash
set -Eeuo pipefail

ARCHIVE_PATH="${1:-/tmp/seqora-source.tgz}"
APP_DIR="${APP_DIR:-/opt/seqora}"
STAGE_DIR="${APP_DIR}.new"
BACKUP_ROOT="${APP_DIR}-backups"

if [[ "${EUID}" -ne 0 ]]; then
  echo 'Run this script with sudo.' >&2
  exit 1
fi
if [[ ! -f "${ARCHIVE_PATH}" ]]; then
  echo "Deployment archive not found: ${ARCHIVE_PATH}" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl git

if ! docker compose version >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  architecture="$(dpkg --print-architecture)"
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian %s stable\n' \
    "${architecture}" "${VERSION_CODENAME}" > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y --no-install-recommends \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

systemctl enable --now docker
if id -u admin >/dev/null 2>&1; then
  usermod -aG docker admin
fi
apt-get clean
rm -rf /var/lib/apt/lists/*

rm -rf "${STAGE_DIR}"
install -d -m 0755 "${STAGE_DIR}" "${BACKUP_ROOT}"
tar -xzf "${ARCHIVE_PATH}" -C "${STAGE_DIR}"
chmod 600 "${STAGE_DIR}/deploy/demo.env"

cd "${STAGE_DIR}"
docker compose --env-file deploy/demo.env -f compose.demo.yml config --quiet

if [[ -d "${APP_DIR}" ]]; then
  if [[ -f "${APP_DIR}/compose.demo.yml" ]]; then
    (
      cd "${APP_DIR}"
      docker compose --env-file deploy/demo.env -f compose.demo.yml down || true
    )
  fi
  mv "${APP_DIR}" "${BACKUP_ROOT}/source-$(date +%Y%m%d-%H%M%S)"
fi
mv "${STAGE_DIR}" "${APP_DIR}"

cd "${APP_DIR}"
docker compose --env-file deploy/demo.env -f compose.demo.yml up -d --build
docker compose --env-file deploy/demo.env -f compose.demo.yml ps
rm -f "${ARCHIVE_PATH}"

echo "Seqora is running from ${APP_DIR}."
