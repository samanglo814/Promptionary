#!/usr/bin/env bash
# Sets up (or updates) the whole game on a fresh Vultr Ubuntu server, with real HTTPS so
# phone mics work. Run it as root on the server:
#
#   curl -fsSL https://raw.githubusercontent.com/samanglo814/Reverse-Charades/main/deploy/vultr-setup.sh | bash
#
# Run it again any time to pull the latest code and restart. See docs/deploy-vultr.md.
#
# Optional settings (put them before `bash`, e.g. `... | DOMAIN=promptionary.party bash`):
#   DOMAIN  the website's address. Defaults to <server IP>.sslip.io, a free address that
#           points at this server with no setup. The game server gets api.<DOMAIN>.
#   BRANCH  which branch to run (default: main)
set -euo pipefail

REPO="https://github.com/samanglo814/Reverse-Charades.git"
BRANCH="${BRANCH:-main}"
APP_DIR=/opt/promptionary
APP_USER=promptionary

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this as root (Vultr's console logs you in as root)."
  exit 1
fi

# ---------- Addresses ----------
IP=$(curl -fsS http://169.254.169.254/v1/interfaces/0/ipv4/address 2>/dev/null || curl -fsS https://api.ipify.org)
DOMAIN="${DOMAIN:-$IP.sslip.io}"
API_DOMAIN="api.$DOMAIN"
echo "==> Website:     https://$DOMAIN"
echo "==> Game server: https://$API_DOMAIN"

# ---------- System packages: git, Node 22, Caddy (HTTPS) ----------
export DEBIAN_FRONTEND=noninteractive
if ! command -v node >/dev/null || ! node -v | grep -q '^v22'; then
  echo "==> Installing Node 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
if ! command -v caddy >/dev/null; then
  echo "==> Installing Caddy"
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi
apt-get install -y git

# Building the website needs about 2 GB of memory. Small servers get swap space to make up the difference.
if [ ! -f /swapfile ] && [ "$(free -m | awk '/^Mem:/ {print $2}')" -lt 3000 ]; then
  echo "==> Adding 2 GB of swap"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Vultr's Ubuntu images have a firewall that only allows SSH. Open the web ports.
if command -v ufw >/dev/null; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
fi

# ---------- The code ----------
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
# The code belongs to the app user, but root runs git here; tell git that's fine.
git config --global --add safe.directory "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  echo "==> Updating the code"
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout -B "$BRANCH" "origin/$BRANCH"
else
  echo "==> Downloading the code"
  git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
fi

# ---------- Server settings ----------
# server/.env keeps your AI keys between updates. Only the addresses are rewritten.
ENV_FILE="$APP_DIR/server/.env"
[ -f "$ENV_FILE" ] || cp "$APP_DIR/server/.env.example" "$ENV_FILE"
set_env() {
  if grep -q "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; else echo "$1=$2" >> "$ENV_FILE"; fi
}
set_env PORT 4000
set_env PUBLIC_URL "https://$API_DOMAIN"
set_env CLIENT_ORIGIN "https://$DOMAIN"
grep -q '^IMAGE_PROVIDER=.' "$ENV_FILE" || set_env IMAGE_PROVIDER pollinations
# Vertex AI on a server signs in with a service-account key file instead of your own login.
# Upload it as server/gcp-key.json (see docs/deploy-vultr.md) and this picks it up.
if [ -f "$APP_DIR/server/gcp-key.json" ]; then
  set_env GOOGLE_APPLICATION_CREDENTIALS "$APP_DIR/server/gcp-key.json"
  chmod 600 "$APP_DIR/server/gcp-key.json"
fi

chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ---------- Install and build ----------
echo "==> Installing the game server"
sudo -u "$APP_USER" bash -c "cd $APP_DIR/server && npm ci --no-audit --no-fund"
echo "==> Building the website (takes a few minutes)"
sudo -u "$APP_USER" bash -c "cd $APP_DIR/web && npm ci --no-audit --no-fund && NEXT_PUBLIC_SERVER_URL=https://$API_DOMAIN npm run build"

# ---------- Keep both running (and restart them after a reboot or crash) ----------
cat > /etc/systemd/system/promptionary-server.service <<EOF
[Unit]
Description=Promptionary game server
After=network.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR/server
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/promptionary-web.service <<EOF
[Unit]
Description=Promptionary website
After=network.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR/web
ExecStart=/usr/bin/npm start -- -p 3000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# Caddy gets HTTPS certificates automatically and passes traffic to the two apps.
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
  reverse_proxy localhost:3000
}

$API_DOMAIN {
  reverse_proxy localhost:4000
}
EOF

systemctl daemon-reload
systemctl enable --now promptionary-server promptionary-web >/dev/null
systemctl restart promptionary-server promptionary-web caddy

echo
echo "==> Done. Give it a minute for the HTTPS certificates, then open:"
echo
echo "      https://$DOMAIN/host"
echo
echo "    AI settings live in $ENV_FILE. After editing it: systemctl restart promptionary-server"
echo "    Logs: journalctl -u promptionary-server -f"
