#!/usr/bin/env bash
#
# Собирает HLS-версию демо-ролика лендинга и заливает её в публичный бакет.
#
# Зачем: в бакете лежал один прогрессивный MP4 3840×2180 / H.264 Level 5.1 /
# 16 с / 97 МБ (~50 Мбит/с). iOS тянул его почти целиком до первого кадра, а
# Android не показывал вовсе — 4K H.264 мимо аппаратного декодера телефонов.
# Скрипт режет ролик на сегменты по 2 с и делает лестницу ступеней, обрезанную
# сверху 2560 px: любая ступень декодируется железом, а ABR выбирает нужную.
#
# Запускать НА СЕРВЕРЕ из корня чекаута:
#
#   ./infra/scripts/build-demo-hls.sh                 # источник — текущий объект в бакете
#   ./infra/scripts/build-demo-hls.sh ./new-demo.mp4  # источник — локальный файл
#
# Скрипт выполняет команды ВНУТРИ уже работающих контейнеров (docker compose
# exec) и не трогает их жизненный цикл: ингест, запись и эфир не прерываются.
# Но транскод 4K — это надолго и по всем ядрам, поэтому он идёт под `nice` и с
# ограничением потоков. Всё равно лучше запускать, когда эфира нет: конкуренция
# за CPU с FFmpeg'ом живых трансляций ударит по их качеству.
#
# После заливки скрипт печатает готовое значение NEXT_PUBLIC_DEMO_VIDEO_URL.
# Переменная инлайнится на build-time, поэтому дальше нужен
# `docker compose build web && docker compose up -d --no-deps web`.
set -euo pipefail

# ─── Настройки ────────────────────────────────────────────────────────────
# Каталог версионируется: перезаливка поверх старого пути упёрлась бы в
# immutable-кэш браузеров и CDN, которые уже держат прежние сегменты.
DEST_PREFIX="${DEST_PREFIX:-landing/demo-hls-v1}"
BUCKET="${BUCKET:-streamservice-public}"
# Исходник по умолчанию — тот же объект, что лендинг играл до сих пор.
# Адрес внутренний: api и minio живут в одной compose-сети, наружу через
# nginx ходить незачем.
SOURCE_URL="${SOURCE_URL:-http://minio:9000/streamservice-public/landing/demo-multicam-v1.mp4}"
# Ступени: ширина:битрейт. Верхняя ограничена 2560 не из экономии, а ради
# декодера — см. шапку. Высота считается автоматически (-2), потому что
# исходник не 16:9 (3840×2180) и жёсткая высота сломала бы пропорции.
LADDER=("2560:5500k" "1920:3000k" "1280:1500k" "854:800k")
THREADS="${THREADS:-4}"

WORK_DIR="/tmp/demo-hls-build"
LOCAL_SRC="${1:-}"

# ─── Проверки ─────────────────────────────────────────────────────────────
if [ ! -f docker-compose.yml ]; then
  echo "Запускать из корня чекаута (там, где docker-compose.yml)." >&2
  exit 1
fi

compose() { docker compose "$@"; }

for service in api minio; do
  if ! compose ps --status running --services | grep -qx "$service"; then
    echo "Контейнер '$service' не запущен — скрипт работает внутри живого стека." >&2
    exit 1
  fi
done

# ─── 1. Источник ──────────────────────────────────────────────────────────
compose exec -T api rm -rf "$WORK_DIR"
compose exec -T api mkdir -p "$WORK_DIR"

if [ -n "$LOCAL_SRC" ]; then
  if [ ! -f "$LOCAL_SRC" ]; then
    echo "Файл '$LOCAL_SRC' не найден." >&2
    exit 1
  fi
  echo "→ Копирую исходник в контейнер api…"
  compose cp "$LOCAL_SRC" "api:$WORK_DIR/source.mp4"
  INPUT="$WORK_DIR/source.mp4"
else
  echo "→ Исходник беру из бакета: $SOURCE_URL"
  INPUT="$SOURCE_URL"
fi

# ─── 2. Транскод ──────────────────────────────────────────────────────────
# Собираем аргументы лестницы: split по числу ступеней, затем scale на каждую.
split_labels=""
scale_chain=""
map_args=""
var_map=""
for i in "${!LADDER[@]}"; do
  width="${LADDER[$i]%%:*}"
  bitrate="${LADDER[$i]##*:}"
  # maxrate/bufsize держат пики в узде: без них ABR-оценка полосы у плеера
  # скачет, и он дёргает ступени туда-сюда на ровном месте.
  maxrate="$(( ${bitrate%k} * 110 / 100 ))k"
  bufsize="$(( ${bitrate%k} * 2 ))k"
  split_labels="${split_labels}[v${i}]"
  scale_chain="${scale_chain};[v${i}]scale=${width}:-2[v${i}out]"
  map_args="${map_args} -map [v${i}out] -c:v:${i} libx264 -b:v:${i} ${bitrate} -maxrate:v:${i} ${maxrate} -bufsize:v:${i} ${bufsize}"
  var_map="${var_map}v:${i} "
done
filter="[0:v]split=${#LADDER[@]}${split_labels}${scale_chain}"

echo "→ Транскодирую ${#LADDER[@]} ступени (это надолго)…"
# shellcheck disable=SC2086 # map_args намеренно разбивается на аргументы
compose exec -T api nice -n 19 ffmpeg -hide_banner -y \
  -i "$INPUT" \
  -filter_complex "$filter" \
  $map_args \
  -threads "$THREADS" \
  -preset medium -profile:v high -pix_fmt yuv420p \
  -sc_threshold 0 \
  -force_key_frames "expr:gte(t,n_forced*2)" \
  -an \
  -f hls \
  -hls_time 2 \
  -hls_playlist_type vod \
  -hls_flags independent_segments \
  -hls_segment_filename "$WORK_DIR/out/v%v/seg%03d.ts" \
  -master_pl_name master.m3u8 \
  -var_stream_map "${var_map% }" \
  "$WORK_DIR/out/v%v/index.m3u8"

# ─── 3. Перенос api → minio ───────────────────────────────────────────────
# Прямого общего тома у контейнеров нет, поэтому через хост. Объём после
# транскода — единицы мегабайт, промежуточная копия ничего не стоит.
HOST_TMP="$(mktemp -d)"
trap 'rm -rf "$HOST_TMP"' EXIT

echo "→ Забираю результат из api…"
compose cp "api:$WORK_DIR/out" "$HOST_TMP/out"
compose exec -T api rm -rf "$WORK_DIR"

echo "→ Кладу результат в minio…"
compose exec -T minio rm -rf "$WORK_DIR"
compose cp "$HOST_TMP/out" "minio:$WORK_DIR"

# ─── 4. Заливка в бакет ───────────────────────────────────────────────────
# Алиас настраиваем явно: полагаться на предустановленный в образе — лишнее
# допущение, а команда идемпотентна. Кавычки одинарные: креды должны
# раскрыться ВНУТРИ контейнера, на хосте этих переменных нет.
compose exec -T minio sh -c \
  'mc alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"' >/dev/null

DEST="local/${BUCKET}/${DEST_PREFIX}"

echo "→ Заливаю сегменты…"
# Сегменты неизменны в пределах версии каталога — отсюда годовой immutable.
compose exec -T minio mc cp --recursive --quiet \
  --exclude "*.m3u8" \
  --attr "Content-Type=video/mp2t;Cache-Control=public,max-age=31536000,immutable" \
  "$WORK_DIR/" "$DEST/"

echo "→ Заливаю плейлисты…"
# Плейлисты — 5 минут: если понадобится подправить лестницу в пределах той же
# версии, правка разойдётся быстро, а не через год.
compose exec -T minio mc cp --recursive --quiet \
  --exclude "*.ts" \
  --attr "Content-Type=application/vnd.apple.mpegurl;Cache-Control=public,max-age=300" \
  "$WORK_DIR/" "$DEST/"

compose exec -T minio rm -rf "$WORK_DIR"

# ─── Готово ───────────────────────────────────────────────────────────────
SITE_URL_VALUE="${SITE_URL:-https://liga-live.ru}"
cat <<EOF

Готово. Пропишите в .env:

  NEXT_PUBLIC_DEMO_VIDEO_URL=${SITE_URL_VALUE}/static/${DEST_PREFIX}/master.m3u8

и пересоберите web (значение инлайнится на build-time):

  docker compose build web && docker compose up -d --no-deps web

EOF
