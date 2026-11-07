# Rivo AI

A self-hosted, responsive AI chat application using **Qwen 3.5 4B through Ollama**, **FastAPI**, and a lightweight browser frontend. It runs as one Railway service; Ollama's API binds only inside the container and is never published.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template?template=https%3A%2F%2Fgithub.com%2Falfahad123arafat-hue%2FRivo-Ai2%2Ftree%2Farena%2Fbc062ec5-rivo-ai2)

## Included

- ChatGPT-style sessions with history, rename/delete, streaming, stop and regenerate.
- Markdown, code syntax highlighting, copy-code and copy-response actions.
- Responsive dark/light UI with an English/Bengali interface toggle; the model responds in the user's language.
- Frontend Markdown, sanitization, and Python/JavaScript/HTML/CSS/PHP/Bash/JSON highlighting libraries are bundled locally (no browser CDN dependency).
- Editable persisted system prompt (default matches the requested assistant instructions).
- Optional password gate using `ACCESS_PASSWORD`, signed HttpOnly session cookies, and a persisted random signing key.
- FastAPI health and model status endpoints, request validation, same-origin checks, rate limiting and security headers.
- Ollama starts automatically, downloads the configured model only when absent, retries startup/download, and fails clearly rather than silently choosing another model.
- SQLite conversation and settings data stored with model files on the Railway volume.

## Deploy

Use the [Railway Deploy link](https://railway.com/new/template?template=https%3A%2F%2Fgithub.com%2Falfahad123arafat-hue%2FRivo-Ai2%2Ftree%2Farena%2Fbc062ec5-rivo-ai2). Railway will ask you to authorize GitHub and create the service. The Dockerfile, start command, health-check path, and runtime defaults are in this repository. Railway volumes are provisioned at the project/service level; ensure the service has one mounted at `/root/.ollama` before the first deployment finishes. Then generate/enable the service's public Railway domain if Railway does not do that in the deployment flow. Open that domain once the initial build and model pull have completed.

**First deployment takes time:** the container installs Ollama and downloads the model into the volume. Subsequent restarts reuse it. Keep the `/root/.ollama` volume attached and do not delete it if you want to retain chats and model files. `template.json` records the intended service variables and volume mount for use when creating/publishing a Railway template; Railway's GitHub repo deployment flow may not ingest that manifest automatically.

### Resource sizing

CPU inference is the default; no GPU is assumed. Qwen 3.5 4B quantized weights need several GB of storage and memory in addition to the OS, runtime, and context cache. Start with **at least 8 GB RAM (12 GB recommended)** and **20 GB or more persistent volume storage**; use more memory for a larger context or concurrent users. Railway's available plans and resource limits vary. If the machine is memory constrained, lower `OLLAMA_NUM_CTX` (for example to `4096`). This is a single-service setup, not a distributed deployment.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `OLLAMA_MODEL` | `qwen3.5:4b` | Exact [official Ollama library](https://ollama.com/library/qwen3.5/tags) model tag. No fallback model is selected. |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Private, container-local Ollama endpoint. Do not expose port 11434 publicly. |
| `PORT` | `8000` | FastAPI public port (Railway supplies its own value). |
| `OLLAMA_NUM_CTX` | `8192` | Ollama context window. |
| `OLLAMA_REQUEST_TIMEOUT` | `600` | Upstream chat request timeout in seconds. |
| `ACCESS_PASSWORD` | unset | Optional password gate. Set a strong password to enable sign-in. There is no built-in default login. |
| `APP_SECRET_KEY` | generated once in volume | Optional session-cookie signing key. If set, use a long random value and keep it secret. |
| `STARTUP_RETRIES` | `12` | Ollama readiness/model download retries. |
| `STARTUP_RETRY_SECONDS` | `10` | Delay between retries. |
| `RATE_LIMIT_PER_MINUTE` | `60` | Per-IP API request limit. |
| `MAX_USER_CHARS` | `32000` | Maximum characters per submitted user message. |
| `DATA_DIR` | `/root/.ollama/rivo-data` | Persistent SQLite and session-secret directory. |

The configured tag is pulled with `ollama pull qwen3.5:4b`. If the official Ollama registry does not provide that exact tag or the pull fails after retries, deployment logs report the configured tag and the application does not substitute a different model. The runtime `/api/status` endpoint reports whether the configured model is ready.

## Endpoints

- `GET /api/health` — Railway liveness check.
- `GET /api/status` — Ollama/model readiness (requires access password if enabled).
- `/api/chats` and `/api/chats/{id}` — private conversation management.
- `POST /api/chats/{id}/stream` — SSE chat stream proxied server-side to Ollama.
- `GET/PUT /api/settings` — persisted system-prompt settings.
- `GET /api/auth/status`, `POST /api/auth/login`, `POST /api/auth/logout` — optional access gate.

## Local development

Python 3.11+ and an installed Ollama daemon are needed. Install `requirements.txt`, set `OLLAMA_HOST` to a reachable local Ollama URL and `OLLAMA_MODEL` to an available tag, pull that model with Ollama, then run `uvicorn app.main:app --reload --port 8000`. The Docker image is the production setup: it bundles Ollama and starts both processes under `tini`.

## Data and security notes

Chats, prompt settings, and the generated session-signing key live under the persistent volume. Use Railway's HTTPS domain. The service does not return environment variables or raw exception traces from API errors. Password protection is optional; when enabled, set `ACCESS_PASSWORD` through Railway's variable UI and do not put credentials into Git. Rate limits are in-process and intended for the initial single-service deployment.
