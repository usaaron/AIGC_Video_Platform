#!/usr/bin/env bash

load_local_env() {
  local env_file="$1" name index
  local caller_names=() caller_values=()
  # Export assignments remain literal, including spaces, newlines and '$()'.
  while IFS= read -r name; do
    case "$name" in
      LLM_*|SCRIPT_*|DATABASE_URL|HOST_INTEGRATION_REQUIRED|FRONTEND_ORIGINS)
        caller_names+=("$name")
        caller_values+=("${!name}")
        ;;
    esac
  done < <(compgen -e)
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
  for index in "${!caller_names[@]}"; do
    export "${caller_names[$index]}=${caller_values[$index]}"
  done
  return 0
}
