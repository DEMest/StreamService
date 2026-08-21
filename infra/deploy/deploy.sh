#!/usr/bin/env bash
#
# Выкатка StreamService на прод. Запускается деплой-джобой из
# .github/workflows/ci.yml по SSH через Tailscale, но рассчитан и на ручной
# запуск с сервера.
#
# Главное требование: выкатка идёт ПОД ЖИВЫМ ЭФИРОМ и не должна его рвать.
# Срочные правки (модерация, фикс ботов) чаще всего и нужны именно во время
# трансляции, поэтому "подождём простоя" — не вариант.
#
# Что это значит по частям стека:
#   mediamtx          — НЕ трогаем (--no-deps). Приём SRT/RTMP не прерывается.
#   ffmpeg ABR+запись — живут внутри mediamtx (runOnReady), не трогаются.
#   postgres, minio   — не трогаем.
#   api, web          — пересобираются и перезапускаются (~5 с).
#
# Единственный видимый эффект: api сам отдаёт live-HLS, поэтому на время его
# рестарта раздача встаёт. Сегменты по 2 с, окно плейлиста 80 с, nginx отдаёт
# stale при ошибке апстрима — зритель обычно не замечает, эфир не кончается.

set -euo pipefail

REPO="${REPO:-/home/rootuser/StreamService}"
SERVICES="api web"
HEALTH_URL="${HEALTH_URL:-https://liga-live.ru/api/v1/org/ingest-config}"
SITE_URL="${SITE_URL:-https://liga-live.ru/}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"
BUILD_CACHE_KEEP="${BUILD_CACHE_KEEP:-20GB}"

cd "$REPO"

log()  { printf '%s  %s\n' "$(date -u +%H:%M:%S)" "$*"; }
fail() { printf '::error::%s\n' "$*" >&2; exit 1; }

# ─────────────────────────────────────────────────────────────────────────
# 1. Сколько потоков в эфире прямо сейчас
# ─────────────────────────────────────────────────────────────────────────
live_paths() {
  local user pass
  user=$(grep -E '^MEDIAMTX_API_USER=' .env | cut -d= -f2- || true)
  pass=$(grep -E '^MEDIAMTX_API_PASS=' .env | cut -d= -f2- || true)
  docker exec streamservice-api sh -c \
    "wget -qO- 'http://${user}:${pass}@mediamtx:9997/v3/paths/list'" 2>/dev/null \
    | python3 -c 'import sys,json
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
for i in d.get("items",[]):
    if i.get("ready"): print(i["name"])' 2>/dev/null || true
}

LIVE_BEFORE=$(live_paths)
LIVE_COUNT=$(printf '%s' "$LIVE_BEFORE" | grep -c . || true)
if [ "$LIVE_COUNT" -gt 0 ]; then
  log "в эфире $LIVE_COUNT поток(ов): $(echo "$LIVE_BEFORE" | tr '\n' ' ')"
  log "выкатка пойдёт как обычно — mediamtx не трогаем"
else
  log "живых потоков нет"
fi

# ─────────────────────────────────────────────────────────────────────────
# 2. Подтягиваем код и смотрим, не задет ли mediamtx
# ─────────────────────────────────────────────────────────────────────────
# Что РЕАЛЬНО крутится в контейнерах, берём из файла состояния, а не из git
# HEAD: воркфлоу подтягивает main до запуска этого скрипта (иначе выполнялась
# бы его прошлая версия), да и после отката HEAD и образы расходятся.
STATE="infra/deploy/.deployed"
DEPLOYED_SHA=$(cat "$STATE" 2>/dev/null || true)

git fetch origin main --quiet
git checkout main --quiet
git merge --ff-only origin/main --quiet
TARGET_SHA=$(git rev-parse HEAD)

if [ "$DEPLOYED_SHA" = "$TARGET_SHA" ]; then
  log "$(git rev-parse --short HEAD) уже выкачен — делать нечего"
  exit 0
fi

if [ -n "$DEPLOYED_SHA" ]; then
  log "выкатываем $(git rev-parse --short "$DEPLOYED_SHA") -> $(git rev-parse --short "$TARGET_SHA")"
else
  log "файла состояния нет (первая выкатка) — выкатываем $(git rev-parse --short "$TARGET_SHA")"
fi

# Правки mediamtx вступают в силу только с его рестартом, а рестарт рвёт приём
# у ВСЕХ стримеров разом. Под эфиром это недопустимо — останавливаемся и
# оставляем решение человеку. Тот же случай ловит live-safety-auditor на PR,
# это второй рубеж на случай мержа мимо него.
if [ -n "$DEPLOYED_SHA" ] && [ "$LIVE_COUNT" -gt 0 ]; then
  if git diff --name-only "$DEPLOYED_SHA" "$TARGET_SHA" \
       | grep -qE '^infra/mediamtx/|^docker-compose\.yml$'; then
    fail "diff трогает mediamtx/compose, а в эфире $LIVE_COUNT поток(ов).
Такое изменение требует рестарта mediamtx = обрыва приёма у всех стримеров.
Прод не изменён. Выкатывайте вручную, когда эфир закончится:
  cd $REPO && docker compose up -d --build"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────
# 3. Метки для отката
# ─────────────────────────────────────────────────────────────────────────
for s in $SERVICES; do
  if docker image inspect "streamservice-$s:latest" >/dev/null 2>&1; then
    docker tag "streamservice-$s:latest" "streamservice-$s:rollback"
    log "метка отката: streamservice-$s:rollback"
  fi
done

rollback() {
  log "ОТКАТ: возвращаем предыдущие образы"
  for s in $SERVICES; do
    docker image inspect "streamservice-$s:rollback" >/dev/null 2>&1 \
      && docker tag "streamservice-$s:rollback" "streamservice-$s:latest"
  done
  # Файл состояния НЕ трогаем: там по-прежнему то, что реально работает.
  [ -n "$DEPLOYED_SHA" ] && git reset --hard "$DEPLOYED_SHA" --quiet
  docker compose up -d --no-deps $SERVICES
  fail "выкатка откачена${DEPLOYED_SHA:+ на $(git rev-parse --short "$DEPLOYED_SHA")}"
}

# ─────────────────────────────────────────────────────────────────────────
# 4. Сборка и подъём — только api и web, без каскада на mediamtx
# ─────────────────────────────────────────────────────────────────────────
log "сборка образов"
docker compose build $SERVICES || fail "сборка упала — прод не тронут"

log "подъём (--no-deps: mediamtx не перезапускается)"
docker compose up -d --no-deps $SERVICES || rollback

# ─────────────────────────────────────────────────────────────────────────
# 5. Health-gate: ждём, пока API снова отвечает через edge-nginx
#    401 — валидный ответ: ручка под JwtAuthGuard, значит Nest поднялся и
#    маршрутизация жива. Любой HTTP-код лучше, чем отсутствие ответа.
# ─────────────────────────────────────────────────────────────────────────
log "ждём API (таймаут ${HEALTH_TIMEOUT}с)"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
until code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" 2>/dev/null) \
      && [ "$code" != "000" ] && [ "$code" -lt 500 ]; do
  [ "$(date +%s)" -ge "$deadline" ] && { log "API не поднялся за ${HEALTH_TIMEOUT}с"; rollback; }
  sleep 2
done
log "API отвечает: HTTP $code"

site=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$SITE_URL" || echo 000)
[ "$site" = "200" ] || { log "сайт отдаёт $site вместо 200"; rollback; }
log "сайт отвечает: HTTP $site"

# ─────────────────────────────────────────────────────────────────────────
# 6. Самое важное: эфир пережил выкатку?
# ─────────────────────────────────────────────────────────────────────────
if [ "$LIVE_COUNT" -gt 0 ]; then
  sleep 3
  LIVE_AFTER=$(live_paths)
  lost=0
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    printf '%s\n' "$LIVE_AFTER" | grep -qxF "$p" || { log "ПОТОК ПРОПАЛ: $p"; lost=1; }
  done <<< "$LIVE_BEFORE"
  [ "$lost" -eq 1 ] && rollback
  log "все $LIVE_COUNT поток(ов) в эфире после выкатки"

  # Раздача зрителям действительно работает, а не просто «api отвечает»
  first=$(printf '%s' "$LIVE_BEFORE" | head -1 | sed 's|^live/||')
  org=${first%%/*}; stream=${first#*/}
  hls="https://liga-live.ru/api/v1/public/orgs/$org/streams/$stream/live/hls/master.m3u8"
  hcode=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$hls" || echo 000)
  log "HLS $org/$stream: HTTP $hcode"
  [ "$hcode" = "200" ] || log "::warning::мастер-плейлист отдаёт $hcode — проверьте вручную"
fi

# ─────────────────────────────────────────────────────────────────────────
# 7. Уборка. Build cache тут растёт быстро (был случай на 114 ГБ).
# ─────────────────────────────────────────────────────────────────────────
docker builder prune --force --keep-storage "$BUILD_CACHE_KEEP" >/dev/null 2>&1 || true
log "build cache подрезан до $BUILD_CACHE_KEEP"

# Фиксируем, что теперь реально выкачено. Пишем только здесь — после того,
# как health-gate и проверка эфира прошли.
printf '%s\n' "$TARGET_SHA" > "$STATE"

log "готово: $(git rev-parse --short "$TARGET_SHA") выкачен"
