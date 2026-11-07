FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    OLLAMA_MODELS=/root/.ollama/models \
    OLLAMA_HOST=127.0.0.1:11434 \
    DATA_DIR=/root/.ollama/rivo-data

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl bash tini && \
    rm -rf /var/lib/apt/lists/* && \
    curl -fsSL https://ollama.com/install.sh | sh

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY static ./static
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh && mkdir -p /root/.ollama/rivo-data

EXPOSE 8000
VOLUME ["/root/.ollama"]
ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker-entrypoint.sh"]
