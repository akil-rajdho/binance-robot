#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Deploy started at $(date) ==="
echo "Pulling latest changes..."
git pull origin main

echo "Rebuilding and restarting containers..."
docker compose up --build -d

echo "=== Deploy complete at $(date) ==="
