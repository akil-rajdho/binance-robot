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

echo "--- Scheduling backend restart in 3 seconds..."
nohup sh -c 'sleep 3 && cd /project && docker compose -p binance-robot up -d --no-deps --force-recreate backend' >/dev/null 2>&1 &

echo "=== Deploy complete (backend will restart momentarily) ==="
