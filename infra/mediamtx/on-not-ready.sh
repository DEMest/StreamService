#!/bin/sh

# Send webhook to API
API_BASE_URL="${API_BASE_URL:-http://api:3001}"
curl -sf -X POST "$API_BASE_URL/v1/internal/mediamtx/webhook" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${MEDIAMTX_WEBHOOK_SECRET}" \
  -d "{\"action\":\"unpublish\",\"path\":\"$MTX_PATH\"}" || true

# Cleanup HLS files
rm -rf "/hls/$MTX_PATH"
