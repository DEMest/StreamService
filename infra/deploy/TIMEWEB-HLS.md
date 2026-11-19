# Пилот Timeweb CDN для live HLS

Подготовка к [#121](https://github.com/DEMest/StreamService/issues/121). Ресурс Timeweb `liga-live` приостановлен, текущий источник — `liga-live.ru`, технический домен — `vff2txu865.cdn.twcstorage.ru`.

## Источник пилота

Добавить A-запись `hls-origin.liga-live.ru` на HostKey. Шаблон вставляется отдельным файлом в `conf.d` внешнего `edge-nginx`, в контексте `http`. Заменить `cdn-test/test-live` на фактические slug выделенной тестовой организации и публичного стрима. Зона `hls_cache` уже объявлена в существующем конфиге edge-nginx.

```nginx
map $status:$uri $cdn_pilot_cache_control {
  default "no-store";
  ~^200:.*\.ts$ "public, max-age=0, s-maxage=5";
}

server {
  listen 80;
  server_name hls-origin.liga-live.ru;
  resolver 127.0.0.11 valid=30s ipv6=off;

  location /.well-known/acme-challenge/ {
    set $acme_upstream http://acme-responder:80;
    proxy_pass $acme_upstream;
    proxy_set_header Host $host;
  }

  location / {
    return 301 https://hls-origin.liga-live.ru$request_uri;
  }
}

server {
  listen 443 ssl;
  server_name hls-origin.liga-live.ru;
  ssl_certificate /etc/ssl/regru/cert.pem;
  ssl_certificate_key /etc/ssl/regru/key.pem;
  resolver 127.0.0.11 valid=30s ipv6=off;

  set $upstream_web streamservice-web:3000;
  proxy_set_header Host liga-live.ru;
  proxy_set_header Authorization "";
  proxy_set_header Cookie "";
  proxy_set_header Origin "";
  proxy_hide_header Access-Control-Allow-Origin;
  proxy_hide_header Cache-Control;
  proxy_hide_header Expires;
  proxy_hide_header Pragma;
  proxy_hide_header Set-Cookie;
  proxy_hide_header Vary;
  proxy_cache_key "cdn-pilot|$uri";
  proxy_cache_bypass $http_range;
  proxy_no_cache $http_range;
  proxy_ignore_headers Cache-Control Expires Set-Cookie;
  proxy_cache_lock on;
  add_header Cache-Control $cdn_pilot_cache_control always;

  location ~ ^/api/v1/public/orgs/cdn-test/streams/test-live/live/hls/(master\.m3u8|(hd|p720|p480|p240)/index\.m3u8)$ {
    limit_except GET { deny all; }
    proxy_pass http://$upstream_web$uri;
    proxy_cache hls_cache;
    proxy_cache_valid 200 1s;
  }

  location ~ ^/api/v1/public/orgs/cdn-test/streams/test-live/live/hls/(hd|p720|p480|p240)/seg[0-9]+\.ts$ {
    limit_except GET { deny all; }
    proxy_pass http://$upstream_web$uri;
    proxy_cache hls_cache;
    proxy_cache_valid 200 5s;
  }

  location / {
    return 404;
  }
}
```

1. Сделать резервную копию действующей пары TLS на HostKey с доступом только у владельца. Проверить конфиг через `nginx -t` и применить через `reload`, чтобы активировать ACME-маршрут нового имени.
2. Расширить действующий lineage сертификата через `certonly --expand` по [DEPLOY.md](DEPLOY.md). Перед выпуском сверить SAN действующего сертификата. На 19 ноября 2026 полный список для расширения включает `liga-live.ru`, `www.liga-live.ru`, `admin.liga-live.ru`, `ads.liga-live.ru`, `bot.liga-live.ru` и `hls-origin.liga-live.ru`.
3. После ручного выпуска отдельно установить новую пару из lineage в уже смонтированный `/etc/ssl/regru`, предварительно проверив совпадение публичных ключей. Обычный `renew-certs.sh` сравнивает fingerprint lineage до и после `renew`, поэтому первый запуск после `certonly` может пропустить копирование. Выполнить `nginx -t`, затем `reload` и проверить TLS всех шести имён. Если проверка конфигурации не проходит, восстановить сохранённую пару до следующего reload. Дальше `certbot renew` использует SAN обновлённого lineage.
4. Проверить HLS через новый источник. Отдельный виртуальный хост ограничивает CDN одним публичным маршрутом. Тестовый Stream сохраняет публичный режим на протяжении пилота. Имена сегментов FFmpeg повторяются между эфирами, поэтому перед повторным запуском очистить кэш CDN.

## Настройки Timeweb

| Настройка | Значение для пилота |
| --- | --- |
| Источник | `hls-origin.liga-live.ru` по HTTPS, с Host этого источника |
| Технический домен | `vff2txu865.cdn.twcstorage.ru` по HTTPS |
| CDN-кэш | Учитывать `Cache-Control` источника. Успешный ответ для сегмента кэшируется 5 секунд. Плейлисты, диапазонные ответы и ошибки получают `no-store` |
| Кэш браузера | Опцию переопределения выключить |
| «Всегда онлайн» | Выключить, плейлист должен обновляться при каждом запросе |
| CORS | `liga-live.ru`, включая ответы с ошибками |

[Кэширование Timeweb](https://timeweb.cloud/docs/cdn/settings/cache) · [HTTP-заголовки и CORS](https://timeweb.cloud/docs/cdn/settings/http-headers)

## Проверка после разрешения на включение

1. Подать синтетический SRT-эфир на выделенный тестовый Stream. Через источник проверить главный и медиаплейлисты, сегмент и ответы `404` для главной страницы, архива, другого стрима и пути `private`. Для проверки `private` использовать фиктивный ключ.
2. Указать защищённый источник в Timeweb и включить ресурс. На техническом домене повторить проверки, включая CORS с `Origin: https://liga-live.ru`. Сверить, что `MEDIA-SEQUENCE` в медиаплейлисте растёт, а повторный GET одного сегмента в пределах TTL даёт попадание в CDN-кэш по статистике Timeweb или журналу источника.
3. Воспроизвести URL пилота в hls.js и Safari. Зафиксировать `4xx`, задержку, битрейт и долю попаданий в кэш. Продолжение #121 предполагает отдельное изменение URL публичного live HLS в приложении с управляемым включением. Приватный HLS и архив сохраняют существующие адреса.
4. Для остановки пилота приостановить ресурс и выключить тестовый поток. Если CDN успели указать в приложении, сначала вернуть выдачу URL с основного домена, затем приостановить CDN.
