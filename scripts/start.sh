#!/bin/sh
# Container entrypoint. On hosts whose disk is wiped on every restart (Render's
# free plan), the database lives in an S3-compatible bucket: Litestream restores
# it before the app starts and streams every change back about once a second.
# Without a bucket configured (Fly with a volume, a VPS, local Docker), the app
# runs directly on the persistent disk.
set -eu

DB=/data/lift-me-up.db

if [ -z "${LITESTREAM_BUCKET:-}" ]; then
  exec node server/index.js
fi

case "$LITESTREAM_ENDPOINT" in
  http://* | https://*) ;;
  *) LITESTREAM_ENDPOINT="https://$LITESTREAM_ENDPOINT" ;;
esac
# Backblaze endpoints carry their region: https://s3.<region>.backblazeb2.com
if [ -z "${LITESTREAM_REGION:-}" ]; then
  case "$LITESTREAM_ENDPOINT" in
    *.backblazeb2.com*) LITESTREAM_REGION=$(echo "$LITESTREAM_ENDPOINT" | sed -E 's#^https?://s3\.([^.]+)\..*#\1#') ;;
    *) LITESTREAM_REGION=us-east-1 ;;
  esac
fi
export LITESTREAM_ENDPOINT LITESTREAM_REGION

mkdir -p /data
litestream restore -config /app/litestream.yml -if-db-not-exists -if-replica-exists "$DB"
exec litestream replicate -config /app/litestream.yml -exec "node server/index.js"
