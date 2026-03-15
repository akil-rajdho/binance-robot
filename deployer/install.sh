#!/bin/bash
# Run this on the server as root to build and install the deployer service.
# Usage: cd /root/binance-robot/deployer && bash install.sh

set -e

echo "=== Building deployer ==="
cd /root/binance-robot/deployer
go build -o deployer .

echo "=== Installing systemd service ==="
cp deployer.service /etc/systemd/system/deployer.service
systemctl daemon-reload
systemctl enable deployer
systemctl restart deployer
systemctl status deployer --no-pager

echo ""
echo "=== Updating Nginx ==="
# Insert the /deployer/ location block if not already present
NGINX_CONF=/etc/nginx/sites-available/bitcoin-robot
if grep -q '/deploy/' "$NGINX_CONF"; then
  echo "Nginx already has /deploy/ block — skipping."
else
  # Insert before the closing brace of the last server block
  sed -i 's|^}$|    location /deploy/ {\n        proxy_pass         http://127.0.0.1:9090/;\n        proxy_http_version 1.1;\n        proxy_set_header   Host              $host;\n        proxy_set_header   X-Real-IP         $remote_addr;\n        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;\n        proxy_set_header   X-Forwarded-Proto $scheme;\n        proxy_buffering    off;\n        proxy_cache        off;\n        proxy_read_timeout 3600s;\n    }\n}|' "$NGINX_CONF"
  nginx -t && systemctl reload nginx
  echo "Nginx updated and reloaded."
fi

echo ""
echo "=== Done ==="
echo "Deployer available at: https://akil.cooleta.al/deploy/?token=YOUR_DEPLOY_TOKEN"
