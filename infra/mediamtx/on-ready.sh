#!/bin/sh
set -e

SLUG="${MTX_PATH#live/}"
HLS_DIR="/hls/$MTX_PATH"

# HLS_LQ_ENABLED=true (default) — пишем HD-copy + LQ-rendition (4K → 540p через libx264, ~7 cores).
# HLS_LQ_ENABLED=false — только HD-copy (~1 core). Использовать на слабых стендах и в dev.
HLS_LQ_ENABLED="${HLS_LQ_ENABLED:-true}"

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

# Send webhook to API (background, don't block FFmpeg)
API_BASE_URL="${API_BASE_URL:-http://api:3001}"
curl -sf -X POST "$API_BASE_URL/v1/internal/mediamtx/webhook" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${MEDIAMTX_WEBHOOK_SECRET}" \
  -d "{\"action\":\"publish\",\"path\":\"$MTX_PATH\"}" &

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
