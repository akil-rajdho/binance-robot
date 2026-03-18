#!/bin/bash
set -e

cd /project

echo "=== Deploy started at $(date) ==="

echo "--- Pulling latest changes..."
git pull origin main

echo "--- Building all images..."
docker compose -p binance-robot build

echo "--- Restarting frontend, postgres, redis..."
docker compose -p binance-robot up -d --no-deps --force-recreate frontend postgres redis

echo "--- Container status:"
docker compose -p binance-robot ps

echo "--- Scheduling backend restart via sidecar container..."
docker run --rm -d \
  --name deploy-backend-restart \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /root/binance-robot:/project \
  binance-robot-backend:latest \
  sh -c 'sleep 5 && cd /project && docker compose -p binance-robot up -d --no-deps --force-recreate backend'

echo "=== Deploy complete (backend will restart in ~5 seconds) ==="
