#!/bin/sh
set -eu

REMOTE_HOST="${REMOTE_HOST:-fengye@192.168.1.136}"
REMOTE_DIR="${REMOTE_DIR:-/home/fengye/low-altitude-platform}"
ARCHIVE="${ARCHIVE:-low-altitude-platform-images.tar.gz}"

docker compose build
docker save low-altitude-api:0.1.0 low-altitude-web:0.1.0 | gzip > "$ARCHIVE"

ssh "$REMOTE_HOST" "mkdir -p '$REMOTE_DIR'"
scp "$ARCHIVE" compose.yaml .env "$REMOTE_HOST:$REMOTE_DIR/"
ssh "$REMOTE_HOST" "cd '$REMOTE_DIR' && gzip -dc '$ARCHIVE' | docker load && docker compose up -d --no-build && docker compose ps"

echo "Deployment complete: http://${REMOTE_HOST#*@}:${PUBLIC_PORT:-8080}"
