#!/bin/bash
set -e

cd /project

echo "=== Deploy started at $(date) ==="
git config --global --add safe.directory /project
echo "Pulling latest changes..."
git pull origin main

echo "Launching deploy runner (separate container)..."
docker rm -f bitcoin-robot-deployer 2>/dev/null || true
docker run -d \
  --name bitcoin-robot-deployer \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /root/binance-robot:/project \
  -w /project \
  binance-robot-backend \
  /usr/local/bin/docker-compose -p binance-robot up --build -d

echo "Runner started. Streaming output (will cut off when backend restarts — that is normal)..."
docker logs -f bitcoin-robot-deployer 2>/dev/null || true

echo "=== Handoff complete — backend will reconnect shortly ==="
