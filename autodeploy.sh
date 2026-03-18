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

echo "--- Restarting backend (stream will end here)..."
docker compose -p binance-robot up -d --no-deps --force-recreate backend
