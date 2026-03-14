# Deployment Guide — Bitcoin Robot

**Domain:** `akil.cooleta.al`
**Stack:** Go backend (8080) + Next.js frontend (3000) + PostgreSQL + Redis + Nginx + Docker Compose

---

## Table of Contents

1. [Server Provisioning (Hetzner CX22)](#1-server-provisioning-hetzner-cx22)
2. [Install Dependencies](#2-install-dependencies)
3. [Deploy Project](#3-deploy-project)
4. [Nginx Configuration](#4-nginx-configuration)
5. [SSL with Let's Encrypt](#5-ssl-with-lets-encrypt)
6. [Domain Setup](#6-domain-setup)
7. [docker-compose.yml Update for Domain](#7-docker-composeyml-update-for-domain)
8. [Auto-Restart on Server Reboot](#8-auto-restart-on-server-reboot)
9. [Auto-Deploy Webhook](#9-auto-deploy-webhook)
10. [Updating the Application](#10-updating-the-application)
11. [Viewing Logs](#11-viewing-logs)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Server Provisioning (Hetzner CX22)

### Create the Server

1. Log in to [Hetzner Cloud Console](https://console.hetzner.cloud/).
2. Create a new project or open an existing one.
3. Click **Add Server** and configure:
   - **Location:** Choose a region close to your users (e.g., Nuremberg, Falkenstein, Helsinki).
   - **Image:** Ubuntu 22.04
   - **Type:** CX22 (2 vCPU, 4 GB RAM)
   - **SSH Keys:** Add your public key before creating the server.
4. Note the server's **public IPv4 address** after creation — you will need it throughout this guide. Referred to as `SERVER_IP` below.

### Initial Server Setup

SSH in as root:

```bash
ssh root@SERVER_IP
```

Update the system:

```bash
apt update && apt upgrade -y
```

Create a dedicated non-root user:

```bash
adduser bitcoin
usermod -aG sudo bitcoin
```

Copy your SSH key to the new user:

```bash
rsync --archive --chown=bitcoin:bitcoin ~/.ssh /home/bitcoin
```

Verify you can log in as the new user from your local machine before proceeding:

```bash
ssh bitcoin@SERVER_IP
```

Disable root SSH login:

```bash
sudo nano /etc/ssh/sshd_config
```

Find and change (or add) the following lines:

```
PermitRootLogin no
PasswordAuthentication no
```

Restart SSH:

```bash
sudo systemctl restart sshd
```

### Firewall Setup with ufw

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw deny 3000/tcp
sudo ufw deny 8080/tcp
sudo ufw enable
sudo ufw status
```

Ports 3000 and 8080 are internal Docker services — they must not be publicly accessible. All external traffic is routed through Nginx on ports 80/443.

---

## 2. Install Dependencies

All commands run as the `bitcoin` user with `sudo`.

### Docker and Docker Compose Plugin

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg lsb-release

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Add the `bitcoin` user to the Docker group so you can run Docker without `sudo`:

```bash
sudo usermod -aG docker bitcoin
newgrp docker
```

Verify:

```bash
docker --version
docker compose version
```

### Nginx

```bash
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

### Certbot (via snapd)

```bash
sudo apt install -y snapd
sudo snap install core
sudo snap refresh core
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot
```

### Git

```bash
sudo apt install -y git
```

---

## 3. Deploy Project

### Option A — Push from local machine with rsync

Run this from your **local machine** inside the project root:

```bash
rsync -avz \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.env' \
  ./ bitcoin@SERVER_IP:/home/bitcoin/app/
```

### Option B — Clone from Git

```bash
mkdir -p /home/bitcoin/app
git clone https://github.com/YOUR_USERNAME/bitcoin-robot.git /home/bitcoin/app
```

### Create the .env File on the Server

SSH into the server and create the environment file:

```bash
nano /home/bitcoin/app/.env
```

Paste the following, replacing placeholder values with real secrets:

```env
WHITEBIT_API_KEY=...
WHITEBIT_API_SECRET=...
ADMIN_PASSWORD=changeme
DEPLOY_TOKEN=generate-a-random-token
POSTGRES_DSN=postgres://bitcoin:bitcoin@postgres:5432/bitcoinrobot?sslmode=disable
REDIS_URL=redis://redis:6379
```

To generate a secure random `DEPLOY_TOKEN`:

```bash
openssl rand -hex 32
```

### First Run

```bash
cd /home/bitcoin/app
docker compose up -d --build
```

Verify all four services are running:

```bash
docker compose ps
```

---

## 4. Nginx Configuration

Create the site configuration file:

```bash
sudo nano /etc/nginx/sites-available/bitcoin-robot
```

Paste the following complete configuration:

```nginx
server {
    listen 80;
    server_name akil.cooleta.al;

    # Frontend — Next.js
    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    # Backend API — Go
    location /api {
        proxy_pass         http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    # WebSocket — Go
    location /ws {
        proxy_pass         http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        "upgrade";
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```

Enable the site, test the config, and reload Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/bitcoin-robot /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 5. SSL with Let's Encrypt

Make sure the domain DNS A record is already pointing to your server (see Section 6) before running Certbot.

Obtain and install the certificate:

```bash
sudo certbot --nginx -d akil.cooleta.al
```

Certbot will automatically modify your Nginx config to add HTTPS and redirect HTTP to HTTPS.

### Verify Auto-Renewal

Certbot installs a systemd timer for automatic renewal. Verify it is active:

```bash
sudo systemctl status snap.certbot.renew.timer
```

Do a dry run to confirm renewal works:

```bash
sudo certbot renew --dry-run
```

---

## 6. Domain Setup

### Add DNS A Record

In your DNS provider's control panel (wherever `cooleta.al` is managed):

| Type | Name   | Value       | TTL  |
|------|--------|-------------|------|
| A    | `akil` | `SERVER_IP` | 300  |

Replace `SERVER_IP` with the actual public IPv4 address of your Hetzner server.

### Check DNS Propagation

```bash
dig akil.cooleta.al
```

Wait until the answer section shows your server IP. Propagation typically takes a few minutes, but can take up to 24 hours depending on TTL settings and upstream resolvers.

You can also use an online checker:

```
https://dnschecker.org/#A/akil.cooleta.al
```

---

## 7. docker-compose.yml Update for Domain

The Next.js frontend needs to know the public URLs of the backend at **build time**. Open `docker-compose.yml` on the server and ensure the `frontend` service has the following environment variables set:

```yaml
services:
  frontend:
    build: ./frontend
    environment:
      - NEXT_PUBLIC_BACKEND_API=https://akil.cooleta.al/api
      - NEXT_PUBLIC_BACKEND_WS=wss://akil.cooleta.al/ws
    # ... rest of your config
```

After updating the file, rebuild only the frontend service without restarting the others:

```bash
cd /home/bitcoin/app
docker compose up --build -d --no-deps frontend
```

---

## 8. Auto-Restart on Server Reboot

### Add restart policy to docker-compose.yml

Ensure all four services in `docker-compose.yml` include `restart: unless-stopped`:

```yaml
services:
  backend:
    restart: unless-stopped
    # ...

  frontend:
    restart: unless-stopped
    # ...

  postgres:
    restart: unless-stopped
    # ...

  redis:
    restart: unless-stopped
    # ...
```

### Create a systemd Service

```bash
sudo nano /etc/systemd/system/bitcoin-robot.service
```

Paste:

```ini
[Unit]
Description=Bitcoin Robot
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/bitcoin/app
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down

[Install]
WantedBy=multi-user.target
```

Enable the service so it runs on every boot:

```bash
sudo systemctl daemon-reload
sudo systemctl enable bitcoin-robot
sudo systemctl start bitcoin-robot
sudo systemctl status bitcoin-robot
```

---

## 9. Auto-Deploy Webhook

The Go backend exposes a `/api/deploy` endpoint that is protected by the `DEPLOY_TOKEN` environment variable. When called, it pulls the latest code from Git and rebuilds the Docker services.

### Usage

Trigger a deploy from anywhere with curl:

```bash
curl -X POST "https://akil.cooleta.al/api/deploy?token=YOUR_DEPLOY_TOKEN"
```

Or simply open this URL in your browser:

```
https://akil.cooleta.al/api/deploy?token=YOUR_DEPLOY_TOKEN
```

### Deploy Script

The webhook calls the deploy script on the server. Create it:

```bash
nano /home/bitcoin/app/deploy.sh
```

Paste:

```bash
#!/bin/bash
cd /home/bitcoin/app
git pull origin main
docker compose up --build -d
echo "Deploy complete at $(date)"
```

Make it executable:

```bash
chmod +x /home/bitcoin/app/deploy.sh
```

Make sure the `bitcoin` user (or the user the Docker process runs as) has permission to execute Git commands in `/home/bitcoin/app` and that Git credentials are configured if the repository is private:

```bash
git config --global credential.helper store
```

---

## 10. Updating the Application

### Method 1 — SSH and run deploy script manually

```bash
ssh bitcoin@SERVER_IP
cd /home/bitcoin/app
./deploy.sh
```

### Method 2 — Trigger the webhook

Push your changes to the `main` branch first, then call the deploy endpoint:

```bash
git push origin main
curl -X POST "https://akil.cooleta.al/api/deploy?token=YOUR_DEPLOY_TOKEN"
```

Or open the URL in your browser.

### Method 3 — rsync + rebuild (without Git)

From your local machine:

```bash
rsync -avz \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.env' \
  ./ bitcoin@SERVER_IP:/home/bitcoin/app/

ssh bitcoin@SERVER_IP "cd /home/bitcoin/app && docker compose up --build -d"
```

---

## 11. Viewing Logs

Follow logs for the backend only:

```bash
docker compose logs -f backend
```

Follow logs for the frontend only:

```bash
docker compose logs -f frontend
```

Follow logs for all services at once:

```bash
docker compose logs -f
```

View the last 100 lines from a specific service:

```bash
docker compose logs --tail=100 backend
```

View Nginx access and error logs:

```bash
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

---

## 12. Troubleshooting

### Check service health

```bash
docker compose ps
```

All services should show `Up` or `running`. If any show `Exit`, check their logs immediately.

### Restart a single service

```bash
docker compose restart backend
docker compose restart frontend
docker compose restart postgres
docker compose restart redis
```

### Restart all services

```bash
docker compose down && docker compose up -d
```

### Common Issues

**Port 3000 or 8080 refused / Nginx returns 502 Bad Gateway**

The upstream Docker service is not running or not listening. Check:

```bash
docker compose ps
docker compose logs backend
docker compose logs frontend
```

Ensure Docker containers are binding to `0.0.0.0` and not just `127.0.0.1` internally.

**SSL certificate errors**

Check certificate status:

```bash
sudo certbot certificates
```

Force renewal:

```bash
sudo certbot renew --force-renewal
sudo systemctl reload nginx
```

**WebSocket connections dropping**

Ensure the `proxy_read_timeout 86400;` line is present in the `/ws` Nginx location block. Some load balancers also require `proxy_send_timeout`.

**Database connection errors**

Verify that the `POSTGRES_DSN` in `.env` uses the Docker service name `postgres` as the host (not `localhost`). Docker Compose networking resolves service names automatically.

```bash
docker compose exec backend env | grep POSTGRES_DSN
docker compose exec postgres psql -U bitcoin -d bitcoinrobot -c "\l"
```

**Changes not reflected after deploy**

Next.js bakes `NEXT_PUBLIC_*` variables at build time. If you changed those values, you must rebuild the frontend:

```bash
docker compose up --build -d --no-deps frontend
```

**Container running out of disk space**

Clean up unused images and build cache:

```bash
docker system prune -af
```

**Check server resource usage**

```bash
htop
df -h
docker stats
```
