#!/bin/bash
set -e

cd /project

echo "=== Deploy started at $(date) ==="
git config --global --add safe.directory /project
echo "Pulling latest changes..."
git pull origin main

echo "Rebuilding and restarting containers..."
docker-compose up --build -d

echo "=== Deploy complete at $(date) ==="
