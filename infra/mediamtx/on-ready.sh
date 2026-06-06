#!/bin/sh
set -e

HLS_DIR="/hls/$MTX_PATH"

# HLS_LQ_ENABLED=true (default) — пишем HD-copy + LQ-rendition (4K → 540p через libx264, ~7 cores).
# HLS_LQ_ENABLED=false — только HD-copy (~1 core). Использовать на слабых стендах и в dev.
# Применимо только к composite Stream'ам — multistream slot'ы пишут единственную дорожку.
HLS_LQ_ENABLED="${HLS_LQ_ENABLED:-true}"

# Determine path topology — composite Stream vs multistream slot.
#
# Supported MTX_PATH forms (см. spec §5 «Passphrase / key»):
#   live/<org>                   → default composite Stream
#   live/<org>/<n>               → default multistream slot N (n numeric)
#   live/<org>/<streamSlug>      → named composite Stream
#   live/<org>/<streamSlug>/<n>  → named multistream slot N (n numeric)
#
# Rule: если последний сегмент после «live/» числовой И между «live/» и
# числовым хвостом есть хотя бы один сегмент (orgSlug) — это multistream
# SLOT, пишем HLS прямо в $HLS_DIR (без master.m3u8 и hd/+lq/-fanout).
# Каждый slot — самостоятельный rendition, компонует клиент.
#
# Иначе — composite Stream: master.m3u8 + hd/ (+ опционально lq/).
REST="${MTX_PATH#live/}"
SLASHES=$(printf '%s' "$REST" | tr -d -c '/' | wc -c | tr -d ' ')
LAST_SEGMENT="${REST##*/}"

IS_SLOT=0
case "$LAST_SEGMENT" in
  ''|*[!0-9]*) IS_SLOT=0 ;;
  *)
    # Last segment is numeric; treat as slot iff there's an orgSlug segment
    # before it (SLASHES >= 1 in REST).
    if [ "$SLASHES" -ge 1 ]; then IS_SLOT=1; fi
    ;;
esac

# Send webhook to API (background, don't block FFmpeg)
API_BASE_URL="${API_BASE_URL:-http://api:3001}"
curl -sf -X POST "$API_BASE_URL/v1/internal/mediamtx/webhook" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${MEDIAMTX_WEBHOOK_SECRET}" \
  -d "{\"action\":\"publish\",\"path\":\"$MTX_PATH\"}" &

if [ "$IS_SLOT" = "1" ]; then
  # Multistream slot — единственный HLS rendition прямо в $HLS_DIR.
  # Backend в recording.controller.serveLiveHls резолвит
  # /api/v1/public/orgs/<org>/live/hls/<n>/index.m3u8 → /hls/live/<org>/<n>/index.m3u8.
  # Поэтому никакого master.m3u8 здесь не нужно.
  mkdir -p "$HLS_DIR"
  exec ffmpeg \
    -fflags nobuffer -flags low_delay \
    -rtsp_transport tcp \
    -i "rtsp://localhost:8554/$MTX_PATH" \
    -map 0:v -map 0:a? -c:v copy -c:a aac \
      -f hls -hls_time 2 -hls_init_time 1 -hls_list_size 5 \
      -hls_flags delete_segments+temp_file \
      -hls_segment_filename "$HLS_DIR/seg%05d.ts" \
      "$HLS_DIR/index.m3u8"
fi

# Composite Stream — master.m3u8 + HD (+ optional LQ fallback).
mkdir -p "$HLS_DIR/hd"
if [ "$HLS_LQ_ENABLED" = "true" ]; then
  mkdir -p "$HLS_DIR/lq"
  cat > "$HLS_DIR/master.m3u8" <<EOF
#EXTM3U
#EXT-X-VERSION:3

#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,NAME="HD"
hd/index.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=960x540,NAME="LQ"
lq/index.m3u8
EOF
else
  cat > "$HLS_DIR/master.m3u8" <<EOF
#EXTM3U
#EXT-X-VERSION:3

#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,NAME="HD"
hd/index.m3u8
EOF
fi

# Launch FFmpeg (foreground - MediaMTX kills this process on stream end)
# -fflags nobuffer / -flags low_delay: минимизируем входной буфер
# -hls_time 2 / -hls_init_time 1 / -hls_list_size 5: короткие сегменты для быстрого старта
if [ "$HLS_LQ_ENABLED" = "true" ]; then
  exec ffmpeg \
    -fflags nobuffer -flags low_delay \
    -rtsp_transport tcp \
    -i "rtsp://localhost:8554/$MTX_PATH" \
    -map 0:v -map 0:a -c:v copy -c:a aac \
      -f hls -hls_time 2 -hls_init_time 1 -hls_list_size 5 \
      -hls_flags delete_segments+temp_file \
      -hls_segment_filename "$HLS_DIR/hd/seg%05d.ts" \
      "$HLS_DIR/hd/index.m3u8" \
    -map 0:v -map 0:a \
      -vf "scale=ceil(iw/4)*2:ceil(ih/4)*2" \
      -c:v libx264 -preset fast -crf 28 \
      -c:a aac -b:a 96k \
      -f hls -hls_time 2 -hls_init_time 1 -hls_list_size 5 \
      -hls_flags delete_segments+temp_file \
      -hls_segment_filename "$HLS_DIR/lq/seg%05d.ts" \
      "$HLS_DIR/lq/index.m3u8"
else
  exec ffmpeg \
    -fflags nobuffer -flags low_delay \
    -rtsp_transport tcp \
    -i "rtsp://localhost:8554/$MTX_PATH" \
    -map 0:v -map 0:a -c:v copy -c:a aac \
      -f hls -hls_time 2 -hls_init_time 1 -hls_list_size 5 \
      -hls_flags delete_segments+temp_file \
      -hls_segment_filename "$HLS_DIR/hd/seg%05d.ts" \
      "$HLS_DIR/hd/index.m3u8"
fi
