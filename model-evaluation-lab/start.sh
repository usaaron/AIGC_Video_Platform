#!/usr/bin/env bash

set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$LAB_DIR"

if [[ -f "$LAB_DIR/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$LAB_DIR/.env.local"
  set +a
fi

EVALUATION_HOST="${EVALUATION_HOST:-127.0.0.1}"
EVALUATION_PORT="${EVALUATION_PORT:-8090}"

if lsof -nP -iTCP:"$EVALUATION_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Evaluation port $EVALUATION_PORT is already in use."
  exit 1
fi

export PYTHONPATH="$LAB_DIR"
if [[ -n "${EVALUATION_PYTHON:-}" ]]; then
  PYTHON_BIN="$EVALUATION_PYTHON"
elif [[ -x "$LAB_DIR/.venv/bin/python" ]]; then
  PYTHON_BIN="$LAB_DIR/.venv/bin/python"
else
  PYTHON_BIN="python3"
fi
echo "Model evaluation lab: http://$EVALUATION_HOST:$EVALUATION_PORT"
exec "$PYTHON_BIN" -m uvicorn model_eval_lab.server:app \
  --host "$EVALUATION_HOST" \
  --port "$EVALUATION_PORT"
