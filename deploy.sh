#!/bin/bash
set -e

cd /root/binance-robot

echo "=== Deploy started at $(date) ==="

echo "--- Pulling latest changes..."
git pull origin main

echo "--- Rebuilding and restarting all containers..."
docker compose up --build -d

echo "--- Container status:"
docker compose ps

echo "=== Deploy complete at $(date) ==="
