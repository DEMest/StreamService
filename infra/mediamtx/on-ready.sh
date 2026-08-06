#!/bin/sh
set -e

HLS_DIR="/hls/$MTX_PATH"

# HLS_LQ_ENABLED=true (default) — пишем HD-copy + LQ-rendition (4K → 540p через libx264, ~7 cores).
# HLS_LQ_ENABLED=false — только HD-copy (~1 core). Использовать на слабых стендах и в dev.
HLS_LQ_ENABLED="${HLS_LQ_ENABLED:-true}"

# Send webhook to API (background, don't block FFmpeg)
API_BASE_URL="${API_BASE_URL:-http://api:3001}"
curl -sf -X POST "$API_BASE_URL/v1/internal/mediamtx/webhook" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${MEDIAMTX_WEBHOOK_SECRET}" \
  -d "{\"action\":\"publish\",\"path\":\"$MTX_PATH\"}" &

# Composite Stream — master.m3u8 + HD (+ optional LQ fallback).
mkdir -p "$HLS_DIR/hd"
if [ "$HLS_LQ_ENABLED" = "true" ]; then
  mkdir -p "$HLS_DIR/p720" "$HLS_DIR/p480" "$HLS_DIR/p240"
  cat > "$HLS_DIR/master.m3u8" <<EOF
#EXTM3U
#EXT-X-VERSION:3

#EXT-X-STREAM-INF:BANDWIDTH=6500000,RESOLUTION=1920x1080,NAME="Оригинал"
hd/index.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,NAME="720p"
p720/index.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=854x480,NAME="480p"
p480/index.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=426x240,NAME="240p"
p240/index.m3u8
EOF
else
  cat > "$HLS_DIR/master.m3u8" <<EOF
#EXTM3U
#EXT-X-VERSION:3

#EXT-X-STREAM-INF:BANDWIDTH=6500000,RESOLUTION=1920x1080,NAME="HD"
hd/index.m3u8
EOF
fi

# Launch FFmpeg (foreground - MediaMTX kills this process on stream end)
# -fflags nobuffer / -flags low_delay: минимизируем входной буфер
# -hls_time 2 / -hls_init_time 1 / -hls_list_size 5: короткие сегменты для быстрого старта
if [ "$HLS_LQ_ENABLED" = "true" ]; then
  exec ffmpeg \
    -progress "$HLS_DIR/progress.log" -stats_period 1 \
    -fflags nobuffer -flags low_delay \
    -rtsp_transport tcp \
    -i "rtsp://localhost:8554/$MTX_PATH" \
    -filter_complex "[0:v]fps=30,split=3[s720][s480][s240];[s720]scale=-2:720[v720];[s480]scale=-2:480[v480];[s240]scale=-2:240[v240]" \
    -map 0:v -map 0:a -c:v copy -c:a aac \
      -f hls -hls_time 2 -hls_init_time 1 -hls_list_size 40 \
      -hls_flags delete_segments+temp_file \
      -hls_segment_filename "$HLS_DIR/hd/seg%05d.ts" \
      "$HLS_DIR/hd/index.m3u8" \
    -map "[v720]" -map 0:a \
      -c:v libx264 -preset veryfast -crf 25 -maxrate 3000k -bufsize 6000k \
      -r 30 -g 60 -keyint_min 60 -sc_threshold 0 \
      -c:a aac -b:a 128k \
      -f hls -hls_time 2 -hls_init_time 1 -hls_list_size 40 \
      -hls_flags delete_segments+temp_file \
      -hls_segment_filename "$HLS_DIR/p720/seg%05d.ts" \
      "$HLS_DIR/p720/index.m3u8" \
    -map "[v480]" -map 0:a \
      -c:v libx264 -preset veryfast -crf 26 -maxrate 1400k -bufsize 2800k \
      -r 30 -g 60 -keyint_min 60 -sc_threshold 0 \
      -c:a aac -b:a 96k \
      -f hls -hls_time 2 -hls_init_time 1 -hls_list_size 40 \
      -hls_flags delete_segments+temp_file \
      -hls_segment_filename "$HLS_DIR/p480/seg%05d.ts" \
      "$HLS_DIR/p480/index.m3u8" \
    -map "[v240]" -map 0:a \
      -c:v libx264 -preset veryfast -crf 28 -maxrate 500k -bufsize 1000k \
      -r 30 -g 60 -keyint_min 60 -sc_threshold 0 \
      -c:a aac -b:a 64k \
      -f hls -hls_time 2 -hls_init_time 1 -hls_list_size 40 \
      -hls_flags delete_segments+temp_file \
      -hls_segment_filename "$HLS_DIR/p240/seg%05d.ts" \
      "$HLS_DIR/p240/index.m3u8"
else
  exec ffmpeg \
    -progress "$HLS_DIR/progress.log" -stats_period 1 \
    -fflags nobuffer -flags low_delay \
    -rtsp_transport tcp \
    -i "rtsp://localhost:8554/$MTX_PATH" \
    -map 0:v -map 0:a -c:v copy -c:a aac \
      -f hls -hls_time 2 -hls_init_time 1 -hls_list_size 40 \
      -hls_flags delete_segments+temp_file \
      -hls_segment_filename "$HLS_DIR/hd/seg%05d.ts" \
      "$HLS_DIR/hd/index.m3u8"
fi
