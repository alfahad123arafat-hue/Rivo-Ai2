from __future__ import annotations

import asyncio
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = Path(os.getenv("DATA_DIR", "/root/.ollama/rivo-data"))
DB_PATH = DATA_DIR / "conversations.sqlite3"
MODEL = os.getenv("OLLAMA_MODEL", "qwen3.5:4b").strip()
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
if not OLLAMA_HOST.startswith(("http://", "https://")):
    OLLAMA_HOST = "http://" + OLLAMA_HOST
ACCESS_PASSWORD = os.getenv("ACCESS_PASSWORD", "")
DEFAULT_PROMPT = """You are a highly capable AI assistant and expert software engineer.

You specialize in Python, JavaScript, HTML, CSS, Linux, networking, cybersecurity education, debugging, and software development.

Respond in the language used by the user.

Provide complete, runnable code when requested.

Explain errors and provide practical fixes.

Never pretend that code was executed when it was not.

Be accurate, concise, and technically helpful.

Support authorized cybersecurity labs, defensive security, and educational penetration testing."""
MAX_USER_CHARS = int(os.getenv("MAX_USER_CHARS", "32000"))
MAX_CONTEXT_MESSAGES = int(os.getenv("MAX_CONTEXT_MESSAGES", "60"))
MAX_CONTEXT_TOKENS = int(os.getenv("OLLAMA_NUM_CTX", "8192"))
REQUEST_TIMEOUT = float(os.getenv("OLLAMA_REQUEST_TIMEOUT", "600"))
COOKIE_NAME = "rivo_session"


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_secret() -> str:
    configured = os.getenv("APP_SECRET_KEY")
    if configured:
        return configured
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    secret_file = DATA_DIR / ".session-secret"
    try:
        fd = os.open(secret_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as out:
            out.write(secrets.token_urlsafe(48))
    except FileExistsError:
        pass
    return secret_file.read_text().strip()


serializer = URLSafeTimedSerializer(get_secret(), salt="rivo-session-v1")


def connect_db() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    with connect_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                messages TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        """)
        db.execute("INSERT OR IGNORE INTO settings(key, value) VALUES('system_prompt', ?)", (DEFAULT_PROMPT,))


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Rivo AI", version="1.0.0", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Small in-memory sliding window limiter. Railway's single service is the intended initial topology.
_rate: dict[str, list[float]] = {}
RATE_LIMIT = int(os.getenv("RATE_LIMIT_PER_MINUTE", "60"))


@app.middleware("http")
async def security_and_limits(request: Request, call_next):
    if request.url.path.startswith("/api/"):
        ip = request.client.host if request.client else "unknown"
        now = time.monotonic()
        samples = [t for t in _rate.get(ip, []) if now - t < 60]
        if len(samples) >= RATE_LIMIT:
            return JSONResponse({"detail": "Rate limit exceeded. Please wait a moment."}, status_code=429)
        samples.append(now)
        _rate[ip] = samples
        origin = request.headers.get("origin")
        if origin and origin.rstrip("/") != str(request.base_url).rstrip("/"):
            # Railway's proxy supplies the public host through forwarded headers.
            origin_host = re.sub(r"^https?://", "", origin).split("/", 1)[0]
            request_host = request.headers.get("x-forwarded-host", request.headers.get("host", ""))
            if origin_host.lower() != request_host.lower():
                return JSONResponse({"detail": "Cross-origin request rejected."}, status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self';"
    return response


def is_authenticated(request: Request) -> bool:
    if not ACCESS_PASSWORD:
        return True
    token = request.cookies.get(COOKIE_NAME, "")
    try:
        return serializer.loads(token, max_age=60 * 60 * 24 * 14) == "authenticated"
    except (BadSignature, SignatureExpired):
        return False


async def require_auth(request: Request) -> None:
    if not is_authenticated(request):
        raise HTTPException(status_code=401, detail="Authentication required.")


class LoginBody(BaseModel):
    password: str = Field(min_length=1, max_length=512)


class ChatCreate(BaseModel):
    title: str = Field(default="New chat", max_length=120)


class RenameBody(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class PromptBody(BaseModel):
    system_prompt: str = Field(min_length=1, max_length=12000)


class ChatInput(BaseModel):
    message: str = Field(min_length=1, max_length=MAX_USER_CHARS)
    regenerate: bool = False


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/auth/status")
async def auth_status(request: Request):
    return {"required": bool(ACCESS_PASSWORD), "authenticated": is_authenticated(request)}


@app.post("/api/auth/login")
async def login(body: LoginBody, request: Request, response: Response):
    if not ACCESS_PASSWORD:
        return {"authenticated": True}
    if not hmac.compare_digest(body.password.encode(), ACCESS_PASSWORD.encode()):
        raise HTTPException(status_code=401, detail="Incorrect password.")
    secure = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    response.set_cookie(COOKIE_NAME, serializer.dumps("authenticated"), httponly=True, secure=secure,
                        samesite="strict", max_age=60 * 60 * 24 * 14, path="/")
    return {"authenticated": True}


@app.post("/api/auth/logout", dependencies=[Depends(require_auth)])
async def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"authenticated": False}


@app.get("/api/health")
async def health():
    # Liveness endpoint intentionally remains cheap; model readiness is reported separately.
    return {"status": "ok", "service": "rivo-ai"}


@app.get("/api/status", dependencies=[Depends(require_auth)])
async def status():
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(f"{OLLAMA_HOST}/api/tags")
            response.raise_for_status()
            data = response.json()
        models = [entry.get("name", "") for entry in data.get("models", [])]
        found = any(name == MODEL or name == MODEL + ":latest" for name in models)
        return {"ready": found, "ollama": "online", "model": MODEL,
                "models": models, "error": None if found else f"Configured model '{MODEL}' is not downloaded."}
    except (httpx.HTTPError, ValueError) as exc:
        return {"ready": False, "ollama": "offline", "model": MODEL, "models": [],
                "error": f"Ollama is not reachable: {type(exc).__name__}"}


@app.get("/api/chats", dependencies=[Depends(require_auth)])
async def list_chats():
    with connect_db() as db:
        rows = db.execute("SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC").fetchall()
    return [dict(row) for row in rows]


@app.post("/api/chats", dependencies=[Depends(require_auth)])
async def create_chat(body: ChatCreate):
    chat_id, now = str(uuid.uuid4()), utcnow()
    with connect_db() as db:
        db.execute("INSERT INTO conversations(id,title,messages,created_at,updated_at) VALUES(?,?, '[]', ?, ?)",
                   (chat_id, body.title.strip() or "New chat", now, now))
    return {"id": chat_id, "title": body.title.strip() or "New chat", "messages": [], "created_at": now, "updated_at": now}


@app.get("/api/chats/{chat_id}", dependencies=[Depends(require_auth)])
async def get_chat(chat_id: str):
    with connect_db() as db:
        row = db.execute("SELECT * FROM conversations WHERE id=?", (chat_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    data = dict(row)
    data["messages"] = json.loads(data["messages"])
    return data


@app.patch("/api/chats/{chat_id}", dependencies=[Depends(require_auth)])
async def rename_chat(chat_id: str, body: RenameBody):
    with connect_db() as db:
        cur = db.execute("UPDATE conversations SET title=?, updated_at=? WHERE id=?", (body.title.strip(), utcnow(), chat_id))
        if not cur.rowcount:
            raise HTTPException(status_code=404, detail="Conversation not found.")
    return {"id": chat_id, "title": body.title.strip()}


@app.delete("/api/chats/{chat_id}", dependencies=[Depends(require_auth)])
async def delete_chat(chat_id: str):
    with connect_db() as db:
        cur = db.execute("DELETE FROM conversations WHERE id=?", (chat_id,))
        if not cur.rowcount:
            raise HTTPException(status_code=404, detail="Conversation not found.")
    return {"deleted": True}


@app.get("/api/settings", dependencies=[Depends(require_auth)])
async def get_settings():
    with connect_db() as db:
        row = db.execute("SELECT value FROM settings WHERE key='system_prompt'").fetchone()
    return {"system_prompt": row["value"] if row else DEFAULT_PROMPT, "model": MODEL,
            "num_ctx": MAX_CONTEXT_TOKENS}


@app.put("/api/settings", dependencies=[Depends(require_auth)])
async def save_settings(body: PromptBody):
    with connect_db() as db:
        db.execute("INSERT INTO settings(key,value) VALUES('system_prompt',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                   (body.system_prompt.strip(),))
    return {"saved": True}


def load_messages(chat_id: str) -> list[dict[str, Any]]:
    with connect_db() as db:
        row = db.execute("SELECT messages FROM conversations WHERE id=?", (chat_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return json.loads(row["messages"])


def save_messages(chat_id: str, messages: list[dict[str, Any]]) -> None:
    with connect_db() as db:
        db.execute("UPDATE conversations SET messages=?, updated_at=? WHERE id=?",
                   (json.dumps(messages, ensure_ascii=False), utcnow(), chat_id))


async def event_stream(chat_id: str, body: ChatInput):
    messages = load_messages(chat_id)
    if body.regenerate:
        if not messages or messages[-1].get("role") != "assistant":
            yield f"data: {json.dumps({'error': 'There is no assistant response to regenerate.'})}\n\n"
            return
        messages.pop()
    else:
        messages.append({"role": "user", "content": body.message.strip()})
        with connect_db() as db:
            row = db.execute("SELECT title FROM conversations WHERE id=?", (chat_id,)).fetchone()
            if row and row["title"] == "New chat":
                title = re.sub(r"\s+", " ", body.message.strip())[:54]
                db.execute("UPDATE conversations SET title=? WHERE id=?", (title or "New chat", chat_id))
        # Persist the submitted prompt immediately so it survives an Ollama error or client disconnect.
        save_messages(chat_id, messages)
    with connect_db() as db:
        row = db.execute("SELECT value FROM settings WHERE key='system_prompt'").fetchone()
    system_prompt = row["value"] if row else DEFAULT_PROMPT
    payload = {
        "model": MODEL,
        "messages": [{"role": "system", "content": system_prompt}, *messages[-MAX_CONTEXT_MESSAGES:]],
        "stream": True,
        "options": {"num_ctx": MAX_CONTEXT_TOKENS},
    }
    answer = ""
    try:
        timeout = httpx.Timeout(REQUEST_TIMEOUT, connect=20)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream("POST", f"{OLLAMA_HOST}/api/chat", json=payload) as upstream:
                if upstream.status_code >= 400:
                    yield f"data: {json.dumps({'error': f'Ollama rejected the request (HTTP {upstream.status_code}). Check the configured model and service logs.'})}\n\n"
                    return
                async for line in upstream.aiter_lines():
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if chunk.get("error"):
                        yield f"data: {json.dumps({'error': 'Ollama could not complete the request. Check the configured model and service logs.'})}\n\n"
                        return
                    content = chunk.get("message", {}).get("content", "")
                    if content:
                        answer += content
                        yield f"data: {json.dumps({'token': content}, ensure_ascii=False)}\n\n"
                    if chunk.get("done"):
                        break
        if answer:
            messages.append({"role": "assistant", "content": answer})
            save_messages(chat_id, messages)
        yield f"data: {json.dumps({'done': True})}\n\n"
    except httpx.TimeoutException:
        yield f"data: {json.dumps({'error': 'The model took too long to respond. Try again or increase OLLAMA_REQUEST_TIMEOUT.'})}\n\n"
    except httpx.HTTPError as exc:
        yield f"data: {json.dumps({'error': f'Could not connect to Ollama ({type(exc).__name__}). Check service logs.'})}\n\n"


@app.post("/api/chats/{chat_id}/stream", dependencies=[Depends(require_auth)])
async def stream_chat(chat_id: str, body: ChatInput):
    # Check existence and request readiness before starting the event stream.
    load_messages(chat_id)
    return StreamingResponse(event_stream(chat_id, body), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})


@app.exception_handler(Exception)
async def generic_error_handler(_: Request, exc: Exception):
    # Never send internal paths, environment values, or raw stack traces to clients.
    print(f"Unhandled application error: {type(exc).__name__}")
    return JSONResponse({"detail": "An unexpected server error occurred."}, status_code=500)
