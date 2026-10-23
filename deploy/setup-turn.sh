#!/bin/bash
# Cogwild voice chat relay (coturn). Run on the server once (again is fine): sudo bash setup-turn.sh cogwild.duckdns.org
# Voice chat goes through this relay, so players never see each other's internet address.
# Logins are short-lived and made by the game server from a shared secret (TURN REST scheme, server/talk.js).
# Also open in the Oracle Cloud security list: UDP 3478, TCP 3478, UDP 49160-49200.
set -e
DOMAIN="${1:-cogwild.duckdns.org}"
SECRET_FILE=/etc/cogwild-turn.secret

apt-get install -y coturn >/dev/null
[ -s "$SECRET_FILE" ] || (umask 077; openssl rand -hex 32 > "$SECRET_FILE")
SECRET=$(cat "$SECRET_FILE")
PRIVATE_IP=$(hostname -I | awk '{print $1}')
PUBLIC_IP=$(curl -fsS --max-time 5 https://api.ipify.org || getent hosts "$DOMAIN" | awk '{print $1}')

cat > /etc/turnserver.conf <<EOF
# Cogwild voice relay (written by deploy/setup-turn.sh)
listening-port=3478
listening-ip=$PRIVATE_IP
relay-ip=$PRIVATE_IP
external-ip=$PUBLIC_IP/$PRIVATE_IP
min-port=49160
max-port=49200
realm=$DOMAIN
use-auth-secret
static-auth-secret=$SECRET
fingerprint
no-cli
no-multicast-peers
no-tlsv1
no-tlsv1_1
stale-nonce=600
total-quota=200
user-quota=20
max-bps=96000
# never relay into this machine or private networks
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=::1
log-file=syslog
simple-log
EOF
sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn 2>/dev/null || true
systemctl enable coturn >/dev/null 2>&1
systemctl restart coturn

if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
  ufw allow 3478/udp >/dev/null
  ufw allow 3478/tcp >/dev/null
  ufw allow 49160:49200/udp >/dev/null
fi

# tell the game server about the relay (keeps every other setting in /etc/cogwild.env)
ENV=/etc/cogwild.env
touch "$ENV"; chmod 600 "$ENV"
sed -i '/^TURN_URLS=/d;/^TURN_SECRET=/d;/^PUBLIC_ORIGIN=/d' "$ENV"
{
  echo "TURN_URLS=turn:$DOMAIN:3478?transport=udp,turn:$DOMAIN:3478?transport=tcp"
  echo "TURN_SECRET=$SECRET"
  echo "PUBLIC_ORIGIN=https://$DOMAIN"
} >> "$ENV"
systemctl restart cogwild
echo "voice relay ready on $PUBLIC_IP:3478 (relay ports 49160-49200)"
