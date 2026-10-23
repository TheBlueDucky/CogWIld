#!/bin/bash
# Nightly copy of the player database to Oracle Object Storage, off this server.
# The upload link (write-only, made once with the OCI CLI) lives in /etc/cogwild-backup.url (root only).
# Keeps one copy per weekday (daily/db-Mon.json.gz ...) and one per month (monthly/db-2026-11.json.gz).
set -e
URL_FILE=/etc/cogwild-backup.url
DB=/opt/cogwild/data/db.json
[ -s "$URL_FILE" ] && [ -s "$DB" ] || exit 0
URL=$(tr -d '[:space:]' < "$URL_FILE")
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
gzip -c "$DB" > "$TMP"
curl -fsS -m 120 -X PUT --data-binary @"$TMP" "${URL}daily/db-$(date -u +%a).json.gz"
if [ "$(date -u +%d)" = "01" ]; then curl -fsS -m 120 -X PUT --data-binary @"$TMP" "${URL}monthly/db-$(date -u +%Y-%m).json.gz"; fi
logger -t cogwild-backup "uploaded $(stat -c %s "$TMP") bytes"
