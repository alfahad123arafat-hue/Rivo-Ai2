#!/usr/bin/env bash
set -Eeuo pipefail

MODEL="${OLLAMA_MODEL:-qwen3.5:4b}"
HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"
# Ollama expects host:port in OLLAMA_HOST; the application uses an HTTP URL.
OLLAMA_BIND="${HOST#http://}"
OLLAMA_BIND="${OLLAMA_BIND#https://}"
export OLLAMA_HOST="$OLLAMA_BIND"
export OLLAMA_MODELS="${OLLAMA_MODELS:-/root/.ollama/models}"
export DATA_DIR="${DATA_DIR:-/root/.ollama/rivo-data}"
mkdir -p "$OLLAMA_MODELS" "$DATA_DIR"

ollama serve &
OLLAMA_PID=$!
cleanup() {
  kill "$OLLAMA_PID" 2>/dev/null || true
  wait "$OLLAMA_PID" 2>/dev/null || true
}
trap cleanup EXIT TERM INT

retries="${STARTUP_RETRIES:-12}"
wait_seconds="${STARTUP_RETRY_SECONDS:-10}"
ready=0
for ((attempt=1; attempt<=retries; attempt++)); do
  if curl --silent --fail "http://${OLLAMA_BIND}/api/tags" >/dev/null; then
    ready=1
    break
  fi
  echo "Waiting for Ollama (${attempt}/${retries})..."
  sleep "$wait_seconds"
done
if [[ "$ready" != 1 ]]; then
  echo "ERROR: Ollama did not become healthy after ${retries} attempts. Check Railway memory/CPU allocation and logs."
  exit 1
fi

# Skip pulling when the exact configured tag is already in the persistent model store.
if ! ollama list | awk 'NR > 1 {print $1}' | grep -Fxq "$MODEL"; then
  echo "Model '$MODEL' is not present in persistent storage; downloading it now."
  pulled=0
  for ((attempt=1; attempt<=retries; attempt++)); do
    if ollama pull "$MODEL"; then
      pulled=1
      break
    fi
    echo "Model download attempt ${attempt}/${retries} failed; retrying in ${wait_seconds}s."
    sleep "$wait_seconds"
  done
  if [[ "$pulled" != 1 ]]; then
    echo "ERROR: Could not download configured model '$MODEL'. Verify the official Ollama tag exists and that the service has outbound network access and sufficient persistent storage. No substitute model was selected."
    exit 1
  fi
fi

uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips='*' &
API_PID=$!
shutdown() {
  kill "$API_PID" "$OLLAMA_PID" 2>/dev/null || true
  wait "$API_PID" 2>/dev/null || true
  wait "$OLLAMA_PID" 2>/dev/null || true
}
trap shutdown EXIT TERM INT
# If either long-lived service exits, terminate the other so Railway can restart the container.
wait -n "$API_PID" "$OLLAMA_PID"
