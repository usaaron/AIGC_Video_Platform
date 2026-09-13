#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Preserve exported overrides for every role, including future model profiles.
# shellcheck source=scripts/load_local_env.sh
source "$ROOT_DIR/scripts/load_local_env.sh"
load_local_env "$ROOT_DIR/.env.local"

BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
export AGENT_RUNTIME_INSTANCE_ID="${AGENT_RUNTIME_INSTANCE_ID:-local-$(date +%s)-$$-$RANDOM}"
RUNTIME_DIR="${LOCAL_RUNTIME_DIR:-$ROOT_DIR/.cache/local-runtime}"
BACKEND_PID=""
FRONTEND_PID=""

cleanup_local_runtime() {
  local exit_status="${1:-$?}"
  trap - EXIT INT TERM

  for pid in "$FRONTEND_PID" "$BACKEND_PID"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done

  if [[ -n "$FRONTEND_PID" ]]; then
    wait "$FRONTEND_PID" 2>/dev/null || true
  fi
  if [[ -n "$BACKEND_PID" ]]; then
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
  exit "$exit_status"
}

trap 'cleanup_local_runtime 130' INT TERM
trap 'cleanup_local_runtime "$?"' EXIT

mkdir -p "$RUNTIME_DIR"

# Story planning cannot operate in browser-only mode because every approved
# artifact must share one durable project revision. Use a local SQLite store
# when no external database is configured so the complete workflow is usable
# out of the box; production deployments should still provide PostgreSQL.
if [[ -z "${DATABASE_URL:-}" ]]; then
  export DATABASE_URL="sqlite:///$RUNTIME_DIR/my-comic.db"
  echo "DATABASE_URL is not configured. Using local SQLite persistence: $RUNTIME_DIR/my-comic.db"
fi

export LLM_PROVIDER="${LLM_PROVIDER:-mock}"
export LLM_MODEL="${LLM_MODEL:-mock-script-generator}"
export LLM_TIMEOUT_SECONDS="${LLM_TIMEOUT_SECONDS:-300}"
export LLM_MAX_RETRIES="${LLM_MAX_RETRIES:-2}"
export LLM_PLANNING_TIMEOUT_SECONDS="${LLM_PLANNING_TIMEOUT_SECONDS:-300}"
export LLM_PLANNING_MAX_RETRIES="${LLM_PLANNING_MAX_RETRIES:-1}"
export LLM_PLANNING_REASONING_EFFORT="${LLM_PLANNING_REASONING_EFFORT:-${LLM_REASONING_EFFORT:-}}"
export LLM_PLANNING_MODEL="${LLM_PLANNING_MODEL:-$LLM_MODEL}"
export LLM_PLANNING_WIRE_API="${LLM_PLANNING_WIRE_API:-${LLM_WIRE_API:-chat_completions}}"
export LLM_SCRIPT_PROVIDER="${LLM_SCRIPT_PROVIDER:-$LLM_PROVIDER}"
export LLM_SCRIPT_MODEL="${LLM_SCRIPT_MODEL:-$LLM_MODEL}"
export LLM_SCRIPT_BASE_URL="${LLM_SCRIPT_BASE_URL:-${LLM_BASE_URL:-}}"
export LLM_SCRIPT_TIMEOUT_SECONDS="${LLM_SCRIPT_TIMEOUT_SECONDS:-600}"
export LLM_SCRIPT_MAX_RETRIES="${LLM_SCRIPT_MAX_RETRIES:-1}"
export LLM_SCRIPT_REASONING_EFFORT="${LLM_SCRIPT_REASONING_EFFORT:-high}"
export LLM_SCRIPT_THINKING_MODE="${LLM_SCRIPT_THINKING_MODE:-enabled}"
export LLM_SCRIPT_RETRY_EMPTY_RESPONSE="${LLM_SCRIPT_RETRY_EMPTY_RESPONSE:-true}"
export LLM_SCRIPT_HEDGE_DELAY_SECONDS="${LLM_SCRIPT_HEDGE_DELAY_SECONDS:-35}"
export LLM_SCRIPT_ADAPTIVE_NON_STREAM_THRESHOLD="${LLM_SCRIPT_ADAPTIVE_NON_STREAM_THRESHOLD:-1}"
export LLM_SCRIPT_ADAPTIVE_NON_STREAM_COOLDOWN_SECONDS="${LLM_SCRIPT_ADAPTIVE_NON_STREAM_COOLDOWN_SECONDS:-900}"
export LLM_SCRIPT_CIRCUIT_FAILURE_THRESHOLD="${LLM_SCRIPT_CIRCUIT_FAILURE_THRESHOLD:-1}"
export LLM_SCRIPT_CIRCUIT_COOLDOWN_SECONDS="${LLM_SCRIPT_CIRCUIT_COOLDOWN_SECONDS:-600}"
export LLM_SCRIPT_REPAIR_REASONING_EFFORT="${LLM_SCRIPT_REPAIR_REASONING_EFFORT:-high}"
export LLM_SCRIPT_REPAIR_THINKING_MODE="${LLM_SCRIPT_REPAIR_THINKING_MODE:-enabled}"
export LLM_SCRIPT_REPAIR_RETRY_EMPTY_RESPONSE="${LLM_SCRIPT_REPAIR_RETRY_EMPTY_RESPONSE:-true}"
export LLM_SCRIPT_WIRE_API="${LLM_SCRIPT_WIRE_API:-${LLM_WIRE_API:-chat_completions}}"
export LLM_SCRIPT_EDITOR_PROVIDER="${LLM_SCRIPT_EDITOR_PROVIDER:-${LLM_DIALOGUE_PROVIDER:-$LLM_PROVIDER}}"
export LLM_SCRIPT_EDITOR_MODEL="${LLM_SCRIPT_EDITOR_MODEL:-${LLM_DIALOGUE_MODEL:-$LLM_MODEL}}"
export LLM_SCRIPT_EDITOR_BASE_URL="${LLM_SCRIPT_EDITOR_BASE_URL:-${LLM_DIALOGUE_BASE_URL:-${LLM_BASE_URL:-}}}"
export LLM_SCRIPT_EDITOR_WIRE_API="${LLM_SCRIPT_EDITOR_WIRE_API:-responses}"
export LLM_SCRIPT_EDITOR_REASONING_EFFORT="${LLM_SCRIPT_EDITOR_REASONING_EFFORT:-medium}"
export LLM_SCRIPT_EDITOR_TIMEOUT_SECONDS="${LLM_SCRIPT_EDITOR_TIMEOUT_SECONDS:-600}"
export LLM_SCRIPT_EDITOR_MAX_RETRIES="${LLM_SCRIPT_EDITOR_MAX_RETRIES:-1}"
export LLM_DIALOGUE_PROVIDER="${LLM_DIALOGUE_PROVIDER:-$LLM_PROVIDER}"
export LLM_DIALOGUE_MODEL="${LLM_DIALOGUE_MODEL:-$LLM_MODEL}"
export LLM_DIALOGUE_BASE_URL="${LLM_DIALOGUE_BASE_URL:-${LLM_BASE_URL:-}}"
export LLM_DIALOGUE_WIRE_API="${LLM_DIALOGUE_WIRE_API:-${LLM_WIRE_API:-chat_completions}}"
export LLM_DIALOGUE_REASONING_EFFORT="${LLM_DIALOGUE_REASONING_EFFORT:-medium}"
export LLM_WIRE_API="${LLM_WIRE_API:-chat_completions}"
export SCRIPT_MARKET_PROFILE="${SCRIPT_MARKET_PROFILE:-cn_mainland}"
export SCRIPT_CREATIVE_DEEPENING_ENABLED="${SCRIPT_CREATIVE_DEEPENING_ENABLED:-false}"
export SCRIPT_GPT_POST_EDIT_ENABLED="${SCRIPT_GPT_POST_EDIT_ENABLED:-false}"
export FRONTEND_ORIGINS="${FRONTEND_ORIGINS:-http://$FRONTEND_HOST:$FRONTEND_PORT,http://localhost:$FRONTEND_PORT}"

count_numbered_keys() {
  local prefix="$1"
  local count=0
  local key_index key_name
  for key_index in {1..100}; do
    key_name="${prefix}_API_KEY_$(printf '%02d' "$key_index")"
    [[ -n "${!key_name:-}" ]] && count=$((count + 1))
  done
  printf '%s' "$count"
}

SCRIPT_ROLE_KEY_COUNT="$(count_numbered_keys LLM_SCRIPT)"
LEGACY_SCRIPT_KEY_COUNT="$(count_numbered_keys LLM)"

if [[ "$LLM_PROVIDER" != "mock" ]]; then
  if [[ -z "${LLM_API_KEY:-}" || -z "${LLM_BASE_URL:-}" || -z "${LLM_MODEL:-}" ]]; then
    echo "Real generation requires LLM_MODEL, LLM_API_KEY and LLM_BASE_URL."
    echo "Fill in the real provider settings in the project-root .env.local file."
    exit 1
  fi
  if [[ "$LLM_MODEL" == "your-model-name" || "$LLM_API_KEY" == "replace-with-your-key" || "$LLM_API_KEY" == *"FILL"* || "$LLM_API_KEY" == *"填写"* || "$LLM_BASE_URL" == *"your-provider.example"* ]]; then
    echo ".env.local still contains example LLM values. Replace every placeholder before starting real generation."
    exit 1
  fi
fi

if [[ "$LLM_SCRIPT_PROVIDER" != "mock" ]]; then
  if [[ -z "${LLM_SCRIPT_API_KEY:-}" && "$SCRIPT_ROLE_KEY_COUNT" -eq 0 && "$LEGACY_SCRIPT_KEY_COUNT" -eq 0 && -z "${LLM_API_KEY:-}" ]]; then
    echo "DeepSeek script generation requires LLM_SCRIPT_API_KEY, a numbered LLM_SCRIPT_API_KEY_XX pool, or the legacy root key fallback."
    exit 1
  fi
  if [[ "${LLM_SCRIPT_API_KEY:-}" == *"FILL"* || "${LLM_SCRIPT_API_KEY:-}" == *"填写"* ]]; then
    echo "LLM_SCRIPT_API_KEY still contains the DeepSeek placeholder."
    exit 1
  fi
fi

if [[ "$SCRIPT_GPT_POST_EDIT_ENABLED" == "true" && "$LLM_SCRIPT_EDITOR_PROVIDER" != "mock" ]]; then
  if [[ -z "${LLM_SCRIPT_EDITOR_API_KEY:-}" || -z "${LLM_SCRIPT_EDITOR_BASE_URL:-}" || -z "${LLM_SCRIPT_EDITOR_MODEL:-}" ]]; then
    echo "GPT screenplay post-editing requires LLM_SCRIPT_EDITOR_MODEL, LLM_SCRIPT_EDITOR_API_KEY and LLM_SCRIPT_EDITOR_BASE_URL."
    echo "Fill the fields marked [必须填写] in the project-root .env.local file."
    exit 1
  fi
  if [[ "$LLM_SCRIPT_EDITOR_API_KEY" == *"FILL"* || "$LLM_SCRIPT_EDITOR_API_KEY" == *"填写"* ]]; then
    echo "LLM_SCRIPT_EDITOR_API_KEY still contains a placeholder. Add the GPT API key before starting real generation."
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

echo "Applying database migrations"
(
  cd "$ROOT_DIR"
  PYTHONPATH=backend:. .venv/bin/alembic upgrade head
)

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

BACKEND_LOG="$RUNTIME_DIR/backend.log"
FRONTEND_LOG="$RUNTIME_DIR/frontend.log"
# Closing the terminal sends SIGHUP on macOS. Generation is checkpointed, but
# keeping the local services alive avoids interrupting the in-flight model call.
trap '' HUP

echo "Starting backend with provider=$LLM_PROVIDER model=$LLM_MODEL wire_api=$LLM_WIRE_API"
STORY_BIBLE_MODEL="${LLM_STORY_BIBLE_MODEL:-${LLM_STORY_ARCHITECT_MODEL:-${LLM_PLANNING_MODEL:-${LLM_CREATIVE_MODEL:-$LLM_MODEL}}}}"
STORY_BIBLE_BASE_URL="${LLM_STORY_BIBLE_BASE_URL:-${LLM_STORY_ARCHITECT_BASE_URL:-${LLM_PLANNING_BASE_URL:-${LLM_CREATIVE_BASE_URL:-$LLM_BASE_URL}}}}"
STORY_BIBLE_WIRE_API="${LLM_STORY_BIBLE_WIRE_API:-${LLM_STORY_ARCHITECT_WIRE_API:-${LLM_PLANNING_WIRE_API:-${LLM_CREATIVE_WIRE_API:-$LLM_WIRE_API}}}}"
STORY_BIBLE_REASONING="${LLM_STORY_BIBLE_REASONING_EFFORT:-medium}"
STORY_BIBLE_THINKING="${LLM_STORY_BIBLE_THINKING_MODE:-provider_default}"
STORY_BIBLE_STRICT="${LLM_STORY_BIBLE_USE_STRICT_SCHEMA:-${LLM_STORY_ARCHITECT_USE_STRICT_SCHEMA:-${LLM_PLANNING_USE_STRICT_SCHEMA:-${LLM_CREATIVE_USE_STRICT_SCHEMA:-true}}}}"
STORY_BIBLE_TIMEOUT="${LLM_STORY_BIBLE_TIMEOUT_SECONDS:-300}"
STORY_BIBLE_RETRIES="${LLM_STORY_BIBLE_MAX_RETRIES:-0}"
STORY_ARCHITECT_MODEL="${LLM_STORY_ARCHITECT_MODEL:-${LLM_PLANNING_MODEL:-$LLM_MODEL}}"
STORY_ARCHITECT_WIRE_API="${LLM_STORY_ARCHITECT_WIRE_API:-${LLM_PLANNING_WIRE_API:-$LLM_WIRE_API}}"
STORY_ARCHITECT_REASONING="${LLM_STORY_ARCHITECT_REASONING_EFFORT:-${LLM_PLANNING_REASONING_EFFORT:-${LLM_REASONING_EFFORT:-provider_default}}}"
STORY_ARCHITECT_STRICT="${LLM_STORY_ARCHITECT_USE_STRICT_SCHEMA:-${LLM_PLANNING_USE_STRICT_SCHEMA:-true}}"
STORY_ARCHITECT_RECOVERY_MODEL="${LLM_STORY_ARCHITECT_RECOVERY_MODEL:-$STORY_ARCHITECT_MODEL}"
STORY_ARCHITECT_RECOVERY_WIRE_API="${LLM_STORY_ARCHITECT_RECOVERY_WIRE_API:-$STORY_ARCHITECT_WIRE_API}"
STORY_ARCHITECT_RECOVERY_REASONING="${LLM_STORY_ARCHITECT_RECOVERY_REASONING_EFFORT:-medium}"
STORY_ARCHITECT_RECOVERY_THINKING="${LLM_STORY_ARCHITECT_RECOVERY_THINKING_MODE:-disabled}"
STORY_ARCHITECT_RECOVERY_STRICT="${LLM_STORY_ARCHITECT_RECOVERY_USE_STRICT_SCHEMA:-false}"
STORY_ARCHITECT_RECOVERY_TIMEOUT="${LLM_STORY_ARCHITECT_RECOVERY_TIMEOUT_SECONDS:-180}"
STORY_ARCHITECT_RECOVERY_RETRIES="${LLM_STORY_ARCHITECT_RECOVERY_MAX_RETRIES:-0}"
EPISODE_PLAN_MODEL="${LLM_EPISODE_PLAN_MODEL:-$STORY_ARCHITECT_MODEL}"
EPISODE_PLAN_WIRE_API="${LLM_EPISODE_PLAN_WIRE_API:-$STORY_ARCHITECT_WIRE_API}"
EPISODE_PLAN_REASONING="${LLM_EPISODE_PLAN_REASONING_EFFORT:-$STORY_ARCHITECT_REASONING}"
EPISODE_PLAN_THINKING="${LLM_EPISODE_PLAN_THINKING_MODE:-disabled}"
# Episode roadmaps are large native JSON collections. Keep their transport
# format independent from recursive-tree strict schemas; Pydantic validation
# remains authoritative after the response is received.
EPISODE_PLAN_STRICT="${LLM_EPISODE_PLAN_USE_STRICT_SCHEMA:-false}"
# The runtime reads the role-scoped variable directly. Export the resolved
# value so the episode-plan adapter does not silently inherit the tree setting.
export LLM_EPISODE_PLAN_USE_STRICT_SCHEMA="$EPISODE_PLAN_STRICT"
export LLM_STORY_ARCHITECT_TIMEOUT_SECONDS="${LLM_STORY_ARCHITECT_TIMEOUT_SECONDS:-240}"
export LLM_STORY_ARCHITECT_MAX_RETRIES="${LLM_STORY_ARCHITECT_MAX_RETRIES:-0}"
STORY_ARCHITECT_TIMEOUT="$LLM_STORY_ARCHITECT_TIMEOUT_SECONDS"
STORY_ARCHITECT_RETRIES="$LLM_STORY_ARCHITECT_MAX_RETRIES"
echo "Story Bible model: $STORY_BIBLE_MODEL wire_api=$STORY_BIBLE_WIRE_API strict_schema=$STORY_BIBLE_STRICT reasoning=$STORY_BIBLE_REASONING thinking=$STORY_BIBLE_THINKING"
echo "Story Bible limit: ${STORY_BIBLE_TIMEOUT}s, retries=${STORY_BIBLE_RETRIES}"
echo "Story Bible endpoint base: $STORY_BIBLE_BASE_URL"
echo "Tree decomposition model: $STORY_ARCHITECT_MODEL"
echo "Tree decomposition transport: $STORY_ARCHITECT_WIRE_API strict_schema=$STORY_ARCHITECT_STRICT"
echo "Tree decomposition limit: ${STORY_ARCHITECT_TIMEOUT}s, retries=${STORY_ARCHITECT_RETRIES}, reasoning=$STORY_ARCHITECT_REASONING"
echo "Tree recovery model: $STORY_ARCHITECT_RECOVERY_MODEL wire_api=$STORY_ARCHITECT_RECOVERY_WIRE_API strict_schema=$STORY_ARCHITECT_RECOVERY_STRICT"
echo "Tree recovery limit: ${STORY_ARCHITECT_RECOVERY_TIMEOUT}s, retries=${STORY_ARCHITECT_RECOVERY_RETRIES}, reasoning=$STORY_ARCHITECT_RECOVERY_REASONING, thinking=$STORY_ARCHITECT_RECOVERY_THINKING"
echo "Episode roadmap model: $EPISODE_PLAN_MODEL wire_api=$EPISODE_PLAN_WIRE_API strict_schema=$EPISODE_PLAN_STRICT reasoning=$EPISODE_PLAN_REASONING thinking=$EPISODE_PLAN_THINKING"
echo "Mainland body model: ${LLM_CN_SCRIPT_MODEL:-$LLM_SCRIPT_MODEL}"
echo "Overseas body model: ${LLM_OVERSEAS_SCRIPT_MODEL:-$LLM_SCRIPT_MODEL}"
echo "Planning conversation editor: ${LLM_PLANNING_EDITOR_MODEL:-$LLM_MODEL}"
echo "Mainland conversation editor: ${LLM_CN_SCRIPT_CONVERSATION_EDITOR_MODEL:-$LLM_SCRIPT_MODEL}"
echo "Overseas conversation editor: ${LLM_OVERSEAS_SCRIPT_CONVERSATION_EDITOR_MODEL:-$LLM_SCRIPT_MODEL}"
echo "Input readiness model: ${LLM_INPUT_READINESS_MODEL:-${LLM_CREATIVE_MODEL:-$LLM_MODEL}}"
echo "Mainland dialogue presentation: ${LLM_CN_DIALOGUE_MODEL:-$LLM_DIALOGUE_MODEL}"
echo "Overseas dialogue presentation: ${LLM_OVERSEAS_DIALOGUE_MODEL:-$LLM_DIALOGUE_MODEL}"
echo "Astra fallback model: ${LLM_ASTRA_FALLBACK_MODEL:-${LLM_CN_SCRIPT_MODEL:-not_configured}}"
echo "Script body limit: ${LLM_SCRIPT_TIMEOUT_SECONDS}s, retries=${LLM_SCRIPT_MAX_RETRIES}, reasoning=${LLM_SCRIPT_REASONING_EFFORT:-provider_default}, thinking=${LLM_SCRIPT_THINKING_MODE:-provider_default}, hedge_after=${LLM_SCRIPT_HEDGE_DELAY_SECONDS}s"
echo "Script adaptive transport: non_stream after ${LLM_SCRIPT_ADAPTIVE_NON_STREAM_THRESHOLD} reasoning-length failures for ${LLM_SCRIPT_ADAPTIVE_NON_STREAM_COOLDOWN_SECONDS}s"
if [[ "$SCRIPT_ROLE_KEY_COUNT" -gt 0 ]]; then
  echo "Script body key pool active: $SCRIPT_ROLE_KEY_COUNT LLM_SCRIPT_API_KEY_XX keys"
elif [[ "$LEGACY_SCRIPT_KEY_COUNT" -gt 0 && -z "${LLM_SCRIPT_API_KEY:-}" ]]; then
  echo "Script body legacy key pool active: $LEGACY_SCRIPT_KEY_COUNT LLM_API_KEY_XX keys"
elif [[ -n "${LLM_SCRIPT_API_KEY:-}" ]]; then
  echo "Script body key pool inactive: using LLM_SCRIPT_API_KEY"
else
  echo "Script body key pool inactive: using primary LLM_API_KEY"
fi
(
  cd "$ROOT_DIR"
  exec env PYTHONPATH=backend:. .venv/bin/python -m uvicorn app.main:app \
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

# The creator chooses the market path per project. Keep the default profile for
# startup compatibility, but initialize the other market's platform and
# generation resources as well so a project can switch paths in the input form.
if [[ "$SCRIPT_MARKET_PROFILE" == "cn_mainland" ]]; then
  SECONDARY_MARKET_PROFILE="overseas_tiktok"
else
  SECONDARY_MARKET_PROFILE="cn_mainland"
fi
"$ROOT_DIR/.venv/bin/python" "$ROOT_DIR/scripts/bootstrap_frontend_mvp_runtime.py" \
  --base-url "$BACKEND_URL" \
  --market-profile "$SECONDARY_MARKET_PROFILE"

echo "Starting frontend"
(
  cd "$ROOT_DIR/frontend"
  exec env \
  BACKEND_API_URL="$BACKEND_URL" \
  NEXT_PUBLIC_API_BASE_URL="$BACKEND_URL" \
  NEXT_PUBLIC_SCRIPT_MARKET_PROFILE="$SCRIPT_MARKET_PROFILE" \
  NEXT_PUBLIC_CREATIVE_DEEPENING_ENABLED="$SCRIPT_CREATIVE_DEEPENING_ENABLED" \
  "$ROOT_DIR/frontend/node_modules/.bin/next" dev \
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
echo "Optional screenplay post-edit enabled: $SCRIPT_GPT_POST_EDIT_ENABLED"
if [[ "$LLM_PROVIDER" == "mock" ]]; then
  echo "Mode: Mock demo. Configure .env.local for real script generation."
else
  echo "Mode: Real LLM generation."
fi
echo "Press Ctrl+C to stop both services."

wait "$FRONTEND_PID" "$BACKEND_PID"
