#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "Created .env from .env.example. Edit it to set your secrets."
  else
    echo "Missing .env and .env.example; cannot continue." >&2
    exit 1
  fi
fi

echo "Building and starting pm-mvp..."
docker compose up -d --build

echo "Waiting for /api/health..."
for i in $(seq 1 30); do
  if curl -fsS http://localhost:8000/api/health >/dev/null 2>&1; then
    echo "Healthy. App is at http://localhost:8000/"
    exit 0
  fi
  sleep 1
done

echo "Health check did not pass within 30s. Recent logs:" >&2
docker compose logs --tail=80 app >&2 || true
exit 1
