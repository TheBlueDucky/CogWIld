#!/usr/bin/env bash
# Cogwild server setup for an Oracle Cloud VM (Ubuntu or Oracle Linux; Intel/AMD or Ampere ARM).
# Installs Node.js + Caddy (automatic HTTPS), runs the game server as a service, opens the VM firewall.
# Safe to run again: that's how updates are installed (deploy/upload.ps1 does it for you).
#
#   sudo bash deploy/setup.sh                 # no domain yet: uses <your-ip>.sslip.io
#   sudo bash deploy/setup.sh play.mygame.com # your own domain (its DNS A record must point at this VM)
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/cogwild
PORT=8765
DOMAIN="${1:-}"

[ "$(id -u)" -eq 0 ] || { echo "Please run with sudo: sudo bash $0 $*"; exit 1; }
if command -v apt-get >/dev/null; then PM=apt; elif command -v dnf >/dev/null; then PM=dnf; else echo "Unsupported Linux (needs Ubuntu/Debian or Oracle Linux)"; exit 1; fi
echo "==> Cogwild setup ($PM)"

# ---- 1. Node.js 20 ----
need_node=1
if command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ]; then need_node=0; fi
if [ $need_node -eq 1 ]; then
  echo "==> Installing Node.js 20"
  if [ $PM = apt ]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  else
    dnf module reset -y nodejs || true
    dnf module enable -y nodejs:20 || true
    dnf install -y nodejs
  fi
fi
echo "    node $(node -v)"

# ---- 2. Web server in front: an nginx that's already running is reused (its other sites stay as they are),
#         otherwise Caddy (free automatic HTTPS) ----
if command -v nginx >/dev/null && systemctl is-active --quiet nginx; then PROXY=nginx; else PROXY=caddy; fi
echo "    web server: $PROXY"
if [ $PROXY = caddy ] && ! command -v caddy >/dev/null; then
  echo "==> Installing Caddy"
  if [ $PM = apt ]; then
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update
    apt-get install -y caddy
  else
    dnf install -y 'dnf-command(copr)'
    dnf copr enable -y @caddy/caddy
    dnf install -y caddy
  fi
fi

# ---- 3. Game files ----
echo "==> Copying the game to $APP"
id cogwild >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin cogwild
mkdir -p "$APP"
rm -rf "$APP/js" "$APP/server"
rm -rf "$APP/fonts" "$APP/img"
cp -r "$SRC/index.html" "$SRC/favicon.svg" "$SRC/js" "$SRC/fonts" "$SRC/img" "$SRC/server" "$APP/"
for f in privacy.html terms.html credits.html download.html manifest.webmanifest sw.js; do [ -f "$SRC/$f" ] && cp "$SRC/$f" "$APP/"; done
# accounts live in $APP/data (kept across updates, backed up daily into data/backups); app downloads in $APP/downloads
mkdir -p "$APP/data" "$APP/downloads"
chown -R cogwild:cogwild "$APP"

# ---- 4. Domain ----
if [ -z "$DOMAIN" ] && [ -f "$APP/.domain" ]; then DOMAIN="$(cat "$APP/.domain")"; fi
if [ -z "$DOMAIN" ]; then
  IP="$(curl -fsS https://api.ipify.org || curl -fsS https://ifconfig.me)"
  DOMAIN="${IP//./-}.sslip.io" # sslip.io turns 1-2-3-4.sslip.io into 1.2.3.4, so HTTPS works without buying a domain
fi
echo "$DOMAIN" > "$APP/.domain"
echo "    address: $DOMAIN"

# ---- 5. Service (starts on boot, restarts if it ever crashes) ----
cat > /etc/systemd/system/cogwild.service <<EOF
[Unit]
Description=Cogwild game server
After=network.target

[Service]
User=cogwild
WorkingDirectory=$APP
Environment=PORT=$PORT
Environment=HOST=127.0.0.1
Environment=DATA_DIR=$APP/data
EnvironmentFile=-/etc/cogwild.env
ReadWritePaths=$APP/data
ExecStart=$(command -v node) $APP/server/server.js
Restart=always
RestartSec=2
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

# ---- 6. Web server in front of the game ----
if [ $PROXY = caddy ]; then
  # Caddy: HTTPS with automatic certificates
  cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$PORT
}
EOF
else
  # nginx: a site of its own for the game's address, WebSockets passed through on /ws
  SITE=/etc/nginx/sites-available/cogwild
  [ -d /etc/nginx/sites-available ] || SITE=/etc/nginx/conf.d/cogwild.conf
  if [ -f "$SITE" ] && grep -q 'managed by Certbot' "$SITE"; then
    echo "    keeping the existing HTTPS nginx site ($SITE)"
  else
    cat > "$SITE" <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    gzip on;
    gzip_types text/javascript application/json image/svg+xml text/css;
    location /ws {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_read_timeout 120s;
    }
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;
    }
}
EOF
  fi
  [ "$SITE" = /etc/nginx/sites-available/cogwild ] && ln -sfn "$SITE" /etc/nginx/sites-enabled/cogwild
  nginx -t
fi

# ---- 7. The VM's own firewall (Oracle images only allow SSH by default) ----
echo "==> Opening ports 80 and 443 on the VM"
if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
elif command -v firewall-cmd >/dev/null && systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-service=http --add-service=https
  firewall-cmd --reload
elif command -v iptables >/dev/null; then
  for p in 80 443; do
    iptables -C INPUT -p tcp -m state --state NEW --dport $p -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp -m state --state NEW --dport $p -j ACCEPT
  done
  if command -v netfilter-persistent >/dev/null; then netfilter-persistent save; fi
fi

# ---- 7b. Upkeep: a watchdog every 2 minutes, an off-server database backup every night ----
install -m 755 "$SRC/deploy/watchdog.sh" /usr/local/sbin/cogwild-watchdog
install -m 755 "$SRC/deploy/backup-offsite.sh" /usr/local/sbin/cogwild-backup
cat > /etc/cron.d/cogwild <<EOF
*/2 * * * * root /usr/local/sbin/cogwild-watchdog
17 4 * * * root /usr/local/sbin/cogwild-backup
EOF
chmod 644 /etc/cron.d/cogwild

# ---- 8. Start ----
systemctl daemon-reload
systemctl enable cogwild $PROXY >/dev/null 2>&1
systemctl restart cogwild
if [ $PROXY = caddy ]; then systemctl restart caddy; else systemctl reload nginx; fi
sleep 2
if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null; then echo "==> Game server is running"; else echo "!! Game server did not start. See: sudo journalctl -u cogwild -n 50"; exit 1; fi

echo
echo "============================================================"
if [ $PROXY = caddy ] || grep -qs 'managed by Certbot' /etc/nginx/sites-available/cogwild /etc/nginx/conf.d/cogwild.conf; then
  echo " Cogwild is live at:  https://$DOMAIN"
  [ $PROXY = caddy ] && echo " (the first visit can take ~30 s while the HTTPS certificate is made)"
else
  echo " Cogwild is live at:  http://$DOMAIN"
  echo " For HTTPS (free Let's Encrypt certificate): sudo certbot --nginx -d $DOMAIN"
fi
echo
echo " Page won't load? Open ports 80 + 443 in the Oracle Cloud console:"
echo "   Networking > Virtual cloud networks > your VCN > Security Lists"
echo "   > Default Security List > Add Ingress Rules (see deploy/README.md)"
echo
echo " Logs:    sudo journalctl -u cogwild -f"
echo " Status:  curl http://127.0.0.1:$PORT/health"
echo "============================================================"
