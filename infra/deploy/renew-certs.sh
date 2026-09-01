#!/usr/bin/env bash
#
# Обновление сертификата liga-live.ru от Let's Encrypt.
#
# ВНИМАНИЕ: это КОПИЯ скрипта, который реально работает на сервере по пути
# /home/rootuser/edge/renew-certs.sh и запускается из crontab. Здесь он лежит
# ради истории изменений и ревью — правки отсюда на сервер не уезжают сами,
# переносить руками. Пути ниже (NOTIFY, LOG, LE) абсолютные и привязаны к
# этому хосту: на другом сервере их придётся править.
#
# Механика: certbot поднимается standalone внутри контейнера с именем
# acme-responder на сети edge; edge-nginx проксирует на него
# /.well-known/acme-challenge/ ДО редиректа на https (см. conf.d/streamservice.conf).
# Порт 80 наружу пробрасывает роутер на 37.195.117.62.
#
# Список имён сертификата задаётся НЕ здесь и вообще нигде в конфигурации:
# `certbot renew` продлевает существующий lineage, воспроизводя набор имён из
# самого сертификата (в renewal-конфиге certbot 5.x строки domains нет).
# Добавить имя можно только через `certonly --expand` с полным перечнем -d —
# он заменяет набор целиком.
#
# Сертификат кладём в /etc/ssl/regru/{cert,key}.pem — там, где nginx его уже
# читает. Отдельный каталог потребовал бы нового тома, то есть пересоздания
# edge-nginx: это обрыв соединений у зрителей на ровном месте.
#
# Запускается из crontab пользователя дважды в сутки. certbot сам ничего не
# делает, пока до истечения больше 30 дней, так что холостые прогоны дёшевы.

set -euo pipefail

DOMAIN="liga-live.ru"
LE="/home/rootuser/edge/letsencrypt"
DST="/etc/ssl/regru"
LOG="/home/rootuser/edge/renew.log"
NOTIFY="/home/rootuser/ops/notify.py"

log() { printf '%s  %s\n' "$(date -u '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; }

# Письмо — не критичный путь: notify.py всегда возвращает 0, даже если почта
# не настроена или SMTP лёг. Обновление сертификата от этого падать не должно.
notify() { printf '%s\n' "$2" | "$NOTIFY" "$1" 2>/dev/null || true; }

# Дату достаём из контейнера, а считаем на хосте: в alpine busybox-date не
# понимает формат openssl ("Nov 19 19:03:19 2026 GMT") и молча выдаёт мусор.
days_left() {
  local end
  end=$(docker run --rm -v "$LE:/le:ro" alpine/openssl:latest \
          x509 -in "/le/live/$DOMAIN/fullchain.pem" -noout -enddate 2>/dev/null | cut -d= -f2) || true
  [ -z "$end" ] && { echo -1; return; }
  python3 -c "
import sys,datetime
try:
    end = datetime.datetime.strptime(sys.argv[1].strip(), '%b %d %H:%M:%S %Y %Z').replace(tzinfo=datetime.timezone.utc)
    print((end - datetime.datetime.now(datetime.timezone.utc)).days)
except Exception:
    print(-1)
" "$end"
}

fingerprint() {
  docker run --rm -v "$LE:/le:ro" alpine/openssl:latest \
    x509 -in "/le/live/$DOMAIN/fullchain.pem" -noout -fingerprint -sha256 2>/dev/null || echo none
}

before=$(fingerprint)

# Хвост от прерванного прогона занял бы имя, на которое проксирует nginx.
docker rm -f acme-responder >/dev/null 2>&1 || true

docker run --rm --name acme-responder --network edge \
  -v "$LE:/etc/letsencrypt" \
  -v /home/rootuser/edge/letsencrypt-lib:/var/lib/letsencrypt \
  certbot/certbot renew --quiet >> "$LOG" 2>&1 || {
    log "certbot renew завершился с ошибкой"
    notify "[liga-live] ОШИБКА обновления сертификата" \
"certbot renew завершился с ошибкой на $(hostname).

Осталось дней до истечения: $(days_left)
Сертификат НЕ обновлён, сайт пока работает на текущем.

Лог: $LOG
Ручной запуск: /home/rootuser/edge/renew-certs.sh"
    exit 1
  }

after=$(fingerprint)

if [ "$before" = "$after" ]; then
  left=$(days_left)
  log "обновление не потребовалось (осталось дней: $left)"
  # certbot берётся за дело за 30 дней до конца. Если рубеж пройден, а
  # сертификат прежний — автоматика сломалась, и молчание тут опаснее всего.
  if [ "$left" -lt 20 ] 2>/dev/null; then
    notify "[liga-live] Сертификат истекает через $left дн., обновление не сработало" \
"certbot отработал без ошибок, но сертификат не обновился, хотя до истечения $left дней.

Обычно это значит, что проверка HTTP-01 не проходит: проверьте, что
location /.well-known/acme-challenge/ в conf.d/streamservice.conf стоит ДО
редиректа на https, и что порт 80 всё ещё проброшен на роутере.

Проверка без выпуска:
  docker run --rm --name acme-responder --network edge \\
    -v /home/rootuser/edge/letsencrypt:/etc/letsencrypt \\
    certbot/certbot renew --dry-run --no-random-sleep-on-renew

Лог: $LOG"
  fi
  exit 0
fi

log "сертификат обновлён, ставим и перезагружаем nginx"

# Ключ должен соответствовать сертификату — иначе nginx поднимется с битой
# парой и сайт ляжет целиком.
docker run --rm -v "$LE:/le:ro" -v "$DST:/dst" alpine:3.20 sh -c '
set -e
apk add -q --no-cache openssl
c=$(openssl x509 -noout -pubkey -in /le/live/'"$DOMAIN"'/fullchain.pem | openssl sha256)
k=$(openssl pkey -pubout -in /le/live/'"$DOMAIN"'/privkey.pem | openssl sha256)
[ "$c" = "$k" ] || exit 1
cp /le/live/'"$DOMAIN"'/fullchain.pem /dst/cert.pem.new
cp /le/live/'"$DOMAIN"'/privkey.pem  /dst/key.pem.new
chmod 600 /dst/cert.pem.new /dst/key.pem.new
mv /dst/cert.pem.new /dst/cert.pem
mv /dst/key.pem.new  /dst/key.pem
' >> "$LOG" 2>&1 || {
  log "::error:: ключ не совпал с сертификатом — прод не тронут"
  notify "[liga-live] ОШИБКА: ключ не совпал с сертификатом" \
"Новый сертификат выпущен, но приватный ключ ему не соответствует.
Установка отменена, nginx работает на прежней паре — сайт цел.

Лог: $LOG"
  exit 1
}

docker exec edge-nginx nginx -t >> "$LOG" 2>&1 || {
  log "::error:: nginx -t не прошёл"
  notify "[liga-live] ОШИБКА: nginx -t не прошёл после установки сертификата" \
"Сертификат установлен в /etc/ssl/regru, но конфиг nginx не проходит проверку,
поэтому reload НЕ выполнялся. Работают старые воркеры со старым сертификатом.

Резервная копия предыдущей пары: /home/rootuser/edge/ssl-backup/
Лог: $LOG"
  exit 1
}
docker exec edge-nginx nginx -s reload >> "$LOG" 2>&1
log "готово: $after"
notify "[liga-live] Сертификат обновлён" \
"Сертификат Let's Encrypt для $DOMAIN обновлён и установлен, nginx перезагружен.

Осталось дней до нового истечения: $(days_left)
Отпечаток: $after"
