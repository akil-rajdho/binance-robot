#!/bin/bash
set -e

cd /project

echo "=== Deploy started at $(date) ==="

echo "--- Pulling latest changes..."
git pull origin main

echo "--- Rebuilding and restarting all containers..."
docker compose -p binance-robot up --build -d

echo "--- Container status:"
docker compose -p binance-robot ps

echo "=== Deploy complete at $(date) ==="
