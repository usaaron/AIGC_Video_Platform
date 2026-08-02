#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CALLER_LLM_PROVIDER="${LLM_PROVIDER:-}"
CALLER_LLM_MODEL="${LLM_MODEL:-}"
CALLER_LLM_API_KEY="${LLM_API_KEY:-}"
CALLER_LLM_BASE_URL="${LLM_BASE_URL:-}"
CALLER_LLM_TIMEOUT_SECONDS="${LLM_TIMEOUT_SECONDS:-}"
CALLER_LLM_MAX_RETRIES="${LLM_MAX_RETRIES:-}"

if [[ -f "$ROOT_DIR/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env.local"
  set +a
fi

[[ -n "$CALLER_LLM_PROVIDER" ]] && export LLM_PROVIDER="$CALLER_LLM_PROVIDER"
[[ -n "$CALLER_LLM_MODEL" ]] && export LLM_MODEL="$CALLER_LLM_MODEL"
[[ -n "$CALLER_LLM_API_KEY" ]] && export LLM_API_KEY="$CALLER_LLM_API_KEY"
[[ -n "$CALLER_LLM_BASE_URL" ]] && export LLM_BASE_URL="$CALLER_LLM_BASE_URL"
[[ -n "$CALLER_LLM_TIMEOUT_SECONDS" ]] && export LLM_TIMEOUT_SECONDS="$CALLER_LLM_TIMEOUT_SECONDS"
[[ -n "$CALLER_LLM_MAX_RETRIES" ]] && export LLM_MAX_RETRIES="$CALLER_LLM_MAX_RETRIES"

BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
RUNTIME_DIR="$ROOT_DIR/.cache/local-runtime"

export LLM_PROVIDER="${LLM_PROVIDER:-mock}"
export LLM_MODEL="${LLM_MODEL:-mock-script-generator}"
export LLM_TIMEOUT_SECONDS="${LLM_TIMEOUT_SECONDS:-300}"
export LLM_MAX_RETRIES="${LLM_MAX_RETRIES:-2}"
export SCRIPT_MARKET_PROFILE="${SCRIPT_MARKET_PROFILE:-cn_mainland}"
export SCRIPT_CREATIVE_DEEPENING_ENABLED="${SCRIPT_CREATIVE_DEEPENING_ENABLED:-false}"

if [[ "$LLM_PROVIDER" != "mock" ]]; then
  if [[ -z "${LLM_API_KEY:-}" || -z "${LLM_BASE_URL:-}" || -z "${LLM_MODEL:-}" ]]; then
    echo "Real generation requires LLM_MODEL, LLM_API_KEY and LLM_BASE_URL."
    echo "Copy .env.example to .env.local and fill in the real provider settings."
    exit 1
  fi
  if [[ "$LLM_MODEL" == "your-model-name" || "$LLM_API_KEY" == "replace-with-your-key" || "$LLM_BASE_URL" == *"your-provider.example"* ]]; then
    echo ".env.local still contains example LLM values. Replace every placeholder before starting real generation."
    exit 1
  fi
fi

if [[ ! -x "$ROOT_DIR/.venv/bin/python" ]]; then
  echo "Missing .venv. Create it and install the Python dependencies first."
  exit 1
fi

if [[ ! -d "$ROOT_DIR/frontend/node_modules" ]]; then
  echo "Missing frontend dependencies. Run: cd frontend && npm install"
  exit 1
fi

if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "Applying database migrations"
  (
    cd "$ROOT_DIR"
    PYTHONPATH=backend:. .venv/bin/alembic upgrade head
  )
else
  echo "DATABASE_URL is not configured. Projects will remain browser-local until server persistence is available."
fi

port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

if port_in_use "$BACKEND_PORT"; then
  echo "Backend port $BACKEND_PORT is already in use. Stop the existing backend or set BACKEND_PORT."
  exit 1
fi

if port_in_use "$FRONTEND_PORT"; then
  echo "Frontend port $FRONTEND_PORT is already in use. Stop the existing frontend or set FRONTEND_PORT."
  exit 1
fi

mkdir -p "$RUNTIME_DIR"
BACKEND_LOG="$RUNTIME_DIR/backend.log"
FRONTEND_LOG="$RUNTIME_DIR/frontend.log"
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  trap - EXIT INT TERM
  if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  wait "$FRONTEND_PID" "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting backend with provider=$LLM_PROVIDER model=$LLM_MODEL"
(
  cd "$ROOT_DIR"
  PYTHONPATH=backend:. .venv/bin/python -m uvicorn app.main:app \
    --host "$BACKEND_HOST" --port "$BACKEND_PORT"
) >"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

BACKEND_URL="http://$BACKEND_HOST:$BACKEND_PORT"
for _attempt in {1..60}; do
  if curl --silent --fail "$BACKEND_URL/ontology-nodes" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "Backend failed to start. See $BACKEND_LOG"
    tail -40 "$BACKEND_LOG"
    exit 1
  fi
  sleep 0.5
done

if ! curl --silent --fail "$BACKEND_URL/ontology-nodes" >/dev/null 2>&1; then
  echo "Backend did not become ready. See $BACKEND_LOG"
  exit 1
fi

"$ROOT_DIR/.venv/bin/python" "$ROOT_DIR/scripts/bootstrap_frontend_mvp_runtime.py" \
  --base-url "$BACKEND_URL" \
  --market-profile "$SCRIPT_MARKET_PROFILE"

echo "Starting frontend"
(
  cd "$ROOT_DIR/frontend"
  BACKEND_API_URL="$BACKEND_URL" \
  NEXT_PUBLIC_SCRIPT_MARKET_PROFILE="$SCRIPT_MARKET_PROFILE" \
  NEXT_PUBLIC_CREATIVE_DEEPENING_ENABLED="$SCRIPT_CREATIVE_DEEPENING_ENABLED" \
  npm run dev -- \
    --hostname "$FRONTEND_HOST" --port "$FRONTEND_PORT"
) >"$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!

FRONTEND_URL="http://$FRONTEND_HOST:$FRONTEND_PORT"
for _attempt in {1..60}; do
  if curl --silent --fail "$FRONTEND_URL" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    echo "Frontend failed to start. See $FRONTEND_LOG"
    tail -40 "$FRONTEND_LOG"
    exit 1
  fi
  sleep 0.5
done

if ! curl --silent --fail "$FRONTEND_URL" >/dev/null 2>&1; then
  echo "Frontend did not become ready. See $FRONTEND_LOG"
  exit 1
fi

echo
echo "AI Comic Content OS is ready: $FRONTEND_URL"
echo "Backend API docs: $BACKEND_URL/docs"
echo "Market profile: $SCRIPT_MARKET_PROFILE"
echo "Creative Deepening enabled: $SCRIPT_CREATIVE_DEEPENING_ENABLED"
if [[ "$LLM_PROVIDER" == "mock" ]]; then
  echo "Mode: Mock demo. Configure .env.local for real script generation."
else
  echo "Mode: Real LLM generation."
fi
echo "Press Ctrl+C to stop both services."

wait "$FRONTEND_PID" "$BACKEND_PID"
