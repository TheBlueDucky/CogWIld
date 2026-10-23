#!/bin/bash
# Run by cron every 2 minutes: if the game server (or nginx in front of it) stops answering twice
# in a row, restart it. systemd already restarts crashes; this catches a server that hangs.
PORT=$(grep -oP 'PORT=\K[0-9]+' /etc/systemd/system/cogwild.service 2>/dev/null | head -1)
PORT=${PORT:-8765}
DOMAIN=$(cat /opt/cogwild/.domain 2>/dev/null)
check() { # name, url, extra curl args, service
  local state=/run/cogwild-watchdog-$1
  if curl -fsS -m 6 -o /dev/null $3 "$2"; then rm -f "$state"; return; fi
  if [ -f "$state" ]; then
    logger -t cogwild-watchdog "$1 did not answer twice, restarting $4"
    systemctl restart "$4"
    rm -f "$state"
  else
    touch "$state"
  fi
}
check game "http://127.0.0.1:$PORT/health" "" cogwild
if [ -n "$DOMAIN" ] && systemctl is-active --quiet nginx; then
  check web "https://$DOMAIN/health" "--resolve $DOMAIN:443:127.0.0.1" nginx
fi
