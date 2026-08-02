#!/usr/bin/env bash
set -Eeuo pipefail

CONFIRM=false

usage() {
  cat <<'EOF'
Usage: restore-gcs-version.sh --yes gs://BUCKET/OBJECT GENERATION [DESTINATION]

Copies a noncurrent Cloud Storage generation back to a live object.
DESTINATION defaults to gs://BUCKET/OBJECT.

Example:
  restore-gcs-version.sh --yes gs://seqora-media/projects/p1/clip.mp4 1710000000000000
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

object_uri="${1:-}"
generation="${2:-}"
destination="${3:-$object_uri}"

if [[ -z "$object_uri" || -z "$generation" || $# -lt 2 || $# -gt 3 ]]; then
  usage
  exit 64
fi

if [[ "$CONFIRM" != 'true' && "${SEQORA_RESTORE_CONFIRM:-}" != 'replace-gcs-object' ]]; then
  echo 'Refusing to overwrite a live GCS object without --yes or SEQORA_RESTORE_CONFIRM=replace-gcs-object.'
  exit 64
fi

if [[ "$object_uri" != gs://* || "$destination" != gs://* || "$object_uri" == *'#'* ]]; then
  echo 'Object and destination must be gs:// URIs, and object must not already include #GENERATION.'
  exit 64
fi

if [[ ! "$generation" =~ ^[0-9]+$ ]]; then
  echo 'GENERATION must be a numeric Cloud Storage generation.'
  exit 64
fi

command -v gcloud >/dev/null 2>&1 || { echo 'gcloud is required.'; exit 69; }

source_uri="${object_uri}#${generation}"
gcloud storage objects describe "$source_uri" >/dev/null
gcloud storage cp "$source_uri" "$destination"
echo "Restored ${source_uri} to ${destination}"
