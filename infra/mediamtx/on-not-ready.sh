#!/bin/sh

# Send webhook to API
curl -sf -X POST http://api:3001/v1/internal/mediamtx/webhook \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${MEDIAMTX_WEBHOOK_SECRET}" \
  -d "{\"action\":\"unpublish\",\"path\":\"$MTX_PATH\"}" || true

# Cleanup HLS files
rm -rf "/hls/$MTX_PATH"
