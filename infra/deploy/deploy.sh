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
#   mediamtx          — по умолчанию НЕ трогаем (--no-deps), приём SRT/RTMP
#                       не прерывается. Перезапускаем, только если diff его
#                       задел И (эфиров нет ИЛИ FORCE_MEDIAMTX=1).
#   ffmpeg ABR+запись — живут внутри mediamtx (runOnReady), не трогаются.
#   postgres, minio   — не трогаем.
#   api, web          — пересобираются и перезапускаются (~5 с).
#
# Единственный видимый эффект: api сам отдаёт live-HLS, поэтому на время его
# рестарта раздача встаёт. Сегменты по 2 с, окно плейлиста 80 с, nginx отдаёт
# stale при ошибке апстрима — зритель обычно не замечает, эфир не кончается.

set -euo pipefail

REPO="${REPO:-/home/rootuser/StreamService}"
SERVICES="api web"          # собираем и метим для отката
APP_SERVICES="api web"      # поднимаем обычным up; mediamtx идёт отдельно и раньше
HEALTH_URL="${HEALTH_URL:-https://liga-live.ru/api/v1/org/ingest-config}"
SITE_URL="${SITE_URL:-https://liga-live.ru/}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"
BUILD_CACHE_KEEP="${BUILD_CACHE_KEEP:-20GB}"
# Разрешает рестарт mediamtx ПОД ЭФИРОМ. Обрывает приём у всех стримеров
# разом, поэтому только вручную: workflow_dispatch или запуск с сервера.
FORCE_MEDIAMTX="${FORCE_MEDIAMTX:-0}"

cd "$REPO"

log()  { printf '%s  %s\n' "$(date -u +%H:%M:%S)" "$*"; }
fail() { printf '::error::%s\n' "$*" >&2; exit 1; }

# ─────────────────────────────────────────────────────────────────────────
# 1. Сколько потоков в эфире прямо сейчас
# ─────────────────────────────────────────────────────────────────────────
# Опрашиваем mediamtx НАПРЯМУЮ, из его же контейнера (в образе есть curl):
# через api ходить нельзя — если ляжет он, опрос молча вернёт «эфиров нет».
#
# Функция обязана падать ЗАКРЫТО. Пустой вывод раньше означал сразу и «никто не
# публикует», и «спросить не удалось» — а на этом различии теперь висит решение
# рвать приём или нет. Неудачный опрос возвращает rc=1 и пустой stdout;
# «эфиров ноль» — rc=0 и пустой stdout.
live_paths() {
  local raw
  raw=$(docker exec streamservice-mediamtx \
          curl -sf --max-time 5 'http://127.0.0.1:9997/v3/paths/list?itemsPerPage=1000' 2>/dev/null) \
    || return 1
  printf '%s' "$raw" | python3 -c 'import sys,json
d=json.load(sys.stdin)
if not isinstance(d.get("items"), list): raise SystemExit(1)
if d.get("pageCount", 1) > 1: raise SystemExit(1)
for i in d["items"]:
    if i.get("ready"): print(i["name"])' 2>/dev/null || return 1
}

# Контейнер поднялся и control-API отвечает. Битый mediamtx.yml роняет процесс
# в crash-loop, а health-gate ниже щупает только api и сайт — они живут
# независимо, и выкатка уехала бы зелёной с мёртвым приёмом.
mediamtx_api_ok() {
  docker exec streamservice-mediamtx \
    curl -sf --max-time 5 'http://127.0.0.1:9997/v3/paths/list' 2>/dev/null \
    | grep -q '"itemCount"'
}

# Сколько путей сконфигурировано в рантайме. Ноль = никто не сможет публиковать.
config_paths_count() {
  docker exec streamservice-mediamtx \
    curl -sf --max-time 5 'http://127.0.0.1:9997/v3/config/paths/list' 2>/dev/null \
    | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("itemCount", 0))
except Exception: print(0)' 2>/dev/null || echo 0
}

# Ждём, пока api зальёт пути обратно. Сверяемся с числом Stream'ов в БД, а не
# просто с «больше нуля»: частичная заливка тоже отказ — часть стримеров молча
# не сможет выйти в эфир.
wait_paths_restored() {
  local deadline=$(( $(date +%s) + 90 )) want have
  # || echo 0 привязалось бы к пайплайну, чей статус берёт tr — а он успешен
  # всегда. При недоступной БД want стал бы пустым, сравнение упало бы с
  # "integer expression expected", и мы получили бы ложный откат.
  want=$(docker exec streamservice-postgres sh -c \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select count(*) from \"Stream\";"' \
    2>/dev/null || true)
  want=${want//[^0-9]/}
  if [ -z "$want" ]; then
    log "не удалось узнать число Stream'ов в БД — считаем проверку путей непройденной"
    return 1
  fi
  while [ "$(date +%s)" -lt "$deadline" ]; do
    have=$(config_paths_count)
    if [ "$have" -ge "$want" ] && [ "$have" -gt 0 ]; then
      log "пути восстановлены: $have (Stream'ов в БД: $want)"
      return 0
    fi
    sleep 3
  done
  log "путей в mediamtx: ${have:-0}, а Stream'ов в БД: $want"
  return 1
}

wait_mediamtx() {
  local deadline=$(( $(date +%s) + 60 )) state
  while [ "$(date +%s)" -lt "$deadline" ]; do
    state=$(docker inspect -f '{{.State.Status}}' streamservice-mediamtx 2>/dev/null || echo none)
    # Мало «running»: при битом конфиге процесс успевает подняться и упасть,
    # поэтому ждём осмысленного ответа control-API, а не статуса контейнера.
    if [ "$state" = "running" ] && mediamtx_api_ok; then
      log "mediamtx поднялся, control-API отвечает"
      return 0
    fi
    sleep 2
  done
  log "mediamtx за 60с не ответил (статус контейнера: ${state:-none})"
  return 1
}

if LIVE_BEFORE=$(live_paths); then
  LIVE_PROBE_OK=1
  LIVE_COUNT=$(printf '%s' "$LIVE_BEFORE" | grep -c . || true)
else
  # Спросить не удалось. Считаем, что эфир МОЖЕТ идти: рестарт mediamtx
  # запрещён, обычная выкатка api/web продолжается — она эфиру не мешает.
  LIVE_PROBE_OK=0
  LIVE_BEFORE=""
  LIVE_COUNT=0
  log "::warning::опрос mediamtx не удался — считаем эфир возможным, mediamtx не трогаем"
fi
if [ "$LIVE_COUNT" -gt 0 ]; then
  log "в эфире $LIVE_COUNT поток(ов): $(echo "$LIVE_BEFORE" | tr '\n' ' ')"
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
# у ВСЕХ стримеров разом. Поэтому решаем в три ветки, а не в две: раньше проверка
# стояла под `LIVE_COUNT > 0`, и без эфира правка конфига молча проезжала мимо —
# .deployed уезжал вперёд, изменение выпадало из следующего diff и терялось
# насовсем. Теперь diff смотрим всегда.
RESTART_MEDIAMTX=0
if [ -n "$DEPLOYED_SHA" ]; then
  if git diff --name-only "$DEPLOYED_SHA" "$TARGET_SHA" \
       | grep -qE '^infra/mediamtx/|^docker-compose\.yml$'; then
    if [ "$LIVE_COUNT" -eq 0 ] && [ "$LIVE_PROBE_OK" = "1" ]; then
      RESTART_MEDIAMTX=1
      log "diff трогает mediamtx, эфиров нет — перезапустим его вместе с остальным"
      # mediamtx собирается из своего Dockerfile (туда запечён on-ready.sh), а
      # mediamtx.yml подключён томом: правка конфига требует только рестарта,
      # правка скрипта — ещё и пересборки. Раз перезапускаем — значит и собираем.
      SERVICES="$SERVICES mediamtx"
    elif [ "$FORCE_MEDIAMTX" = "1" ]; then
      RESTART_MEDIAMTX=1
      log "::warning::FORCE_MEDIAMTX=1 при $LIVE_COUNT живом(ых) потоке(ах) — приём будет оборван"
      SERVICES="$SERVICES mediamtx"
    else
      fail "diff трогает mediamtx/compose, а в эфире $LIVE_COUNT поток(ов).
Такое изменение требует рестарта mediamtx = обрыва приёма у всех стримеров.
Контейнеры не тронуты, .deployed не изменён. Варианты:
  * дождаться конца эфира и перезапустить прогон: Actions -> CI -> Run workflow
    (без форса) — нового push для этого не нужно;
  * форсировать: Actions -> CI -> Run workflow -> force_mediamtx = true;
  * руками на сервере: cd $REPO && FORCE_MEDIAMTX=1 bash infra/deploy/deploy.sh"
    fi
  fi
else
  # Первая выкатка: сравнивать не с чем. Молча перезапускать mediamtx на всякий
  # случай нельзя — это обрыв приёма без причины.
  log "::warning::файла состояния нет, задет ли mediamtx — неизвестно; не трогаем его"
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
  # git reset нужен и для mediamtx.yml — он подключён томом, откат образа
  # старый конфиг не вернёт.
  [ -n "$DEPLOYED_SHA" ] && git reset --hard "$DEPLOYED_SHA" --quiet
  if [ "$RESTART_MEDIAMTX" = "1" ]; then
    # Тот же порядок, что и при выкатке, и по той же причине: сначала mediamtx,
    # потом api — иначе откат вернёт старый образ, но с пустым каталогом путей.
    # Без --force-recreate mediamtx вдобавок остался бы работать на НОВОМ
    # конфиге — том самом, из-за которого откатываемся.
    log "::warning::mediamtx пересоздаётся повторно — для стримеров это второй обрыв подряд"
    docker compose up -d --no-deps --force-recreate mediamtx || true
    wait_mediamtx || log "::warning::mediamtx после отката не отвечает"
    # --force-recreate обязателен: после git reset и перетега образов compose
    # считает контейнер api актуальным и не тронул бы его, а пути в свежем
    # mediamtx заливает именно старт api. Иначе откат оставляет пустой каталог.
    docker compose up -d --no-deps --force-recreate $APP_SERVICES
    wait_paths_restored || log "::error::после отката пути в mediamtx не восстановились"
  else
    docker compose up -d --no-deps $APP_SERVICES
  fi
  fail "выкатка откачена${DEPLOYED_SHA:+ на $(git rev-parse --short "$DEPLOYED_SHA")}"
}

# ─────────────────────────────────────────────────────────────────────────
# 4. Сборка и подъём. --no-deps: поднимаем ровно $SERVICES и ничего сверх,
#    иначе depends_on у api/web утянул бы mediamtx за компанию.
# ─────────────────────────────────────────────────────────────────────────
log "сборка образов: $SERVICES"
docker compose build $SERVICES || fail "сборка упала — прод не тронут"

# Замер эфира в п.1 сделан до git fetch и до сборки, а сборка идёт минутами.
# Стример, вышедший в эфир за это время, попал бы под обрыв мимо гейта —
# поэтому перед самым рестартом mediamtx пересчитываем.
if [ "$RESTART_MEDIAMTX" = "1" ] && [ "$FORCE_MEDIAMTX" != "1" ]; then
  if ! now_paths=$(live_paths); then
    fail "перед рестартом mediamtx не удалось опросить — идёт эфир или нет, неизвестно.
Контейнеры не тронуты, .deployed не изменён."
  fi
  now_live=$(printf '%s' "$now_paths" | grep -c . || true)
  if [ "$now_live" -gt 0 ]; then
    fail "пока шла сборка, в эфир вышло $now_live поток(ов) — рестарт mediamtx отменён.
Контейнеры не тронуты, .deployed не изменён: выкатка повторится на следующем
прогоне. Если ждать нельзя — Actions -> CI -> Run workflow -> force_mediamtx."
  fi
fi

# ПОРЯДОК ЗДЕСЬ КРИТИЧЕН. В mediamtx.yml нет секции `paths:` — вообще ни одной
# записи. Все пути живут только в рантайме: их заливает api на своём старте
# (AdminService, «Восстановить путь в MediaMTX для каждого Stream'а»), вместе с
# srtPublishPassphrase и флагами записи. Свежепересозданный mediamtx приходит
# с пустым каталогом путей и отклоняет любую публикацию.
# Значит mediamtx поднимаем ПЕРВЫМ, а api — после него: иначе выкатка
# отрапортует успех, а приём будет мёртв у всех до ручного вмешательства.
if [ "$RESTART_MEDIAMTX" = "1" ]; then
  log "пересоздаём mediamtx — приём SRT/RTMP прервётся, стримерам нужен реконнект"
  # --force-recreate обязателен: mediamtx.yml подключён томом, а не запечён в
  # образ, поэтому правка одного конфига не меняет image ID и обычный `up -d`
  # контейнер бы не тронул. Плюс bind привязан к inode, а git заменяет файл
  # через rename — живой контейнер новый файл и не увидел бы.
  docker compose up -d --no-deps --force-recreate mediamtx || rollback
  wait_mediamtx || { log "mediamtx не поднялся после рестарта"; rollback; }
fi

log "подъём api и web"
docker compose up -d --no-deps $APP_SERVICES || rollback

# api стартовал последним и залил пути заново. Если их ноль — публиковать
# некуда, и это единственный способ отличить рабочий mediamtx от пустого:
# сам он на /v3/paths/list отвечает бодро в обоих случаях.
if [ "$RESTART_MEDIAMTX" = "1" ]; then
  wait_paths_restored || { log "пути в mediamtx не восстановились"; rollback; }
fi

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

  # При форсированном рестарте mediamtx потоки обязаны пропасть — это и есть
  # заказанное поведение, откатываться тут не на что. Стример переподключится
  # сам, если у энкодера включён reconnect.
  if [ "$RESTART_MEDIAMTX" = "1" ]; then
    [ "$lost" -eq 1 ] && log "::warning::приём оборван по FORCE_MEDIAMTX — ждём реконнекта стримеров"
  else
    [ "$lost" -eq 1 ] && rollback
    log "все $LIVE_COUNT поток(ов) в эфире после выкатки"
  fi

  # Раздача зрителям действительно работает, а не просто «api отвечает».
  # Под форсом путь заведомо мёртв (on-not-ready.sh снёс /hls/<path>), и
  # гарантированно ложный warning только приучал бы его игнорировать.
  if [ "$RESTART_MEDIAMTX" != "1" ]; then
  first=$(printf '%s' "$LIVE_BEFORE" | head -1 | sed 's|^live/||')
  org=${first%%/*}; stream=${first#*/}
  hls="https://liga-live.ru/api/v1/public/orgs/$org/streams/$stream/live/hls/master.m3u8"
  hcode=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$hls" || echo 000)
  log "HLS $org/$stream: HTTP $hcode"
  [ "$hcode" = "200" ] || log "::warning::мастер-плейлист отдаёт $hcode — проверьте вручную"
  fi
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
