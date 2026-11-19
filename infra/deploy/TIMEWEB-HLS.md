# Пилот Timeweb CDN для live HLS

Подготовка к [#121](https://github.com/DEMest/StreamService/issues/121). Ресурс Timeweb `liga-live` приостановлен, текущий источник — `liga-live.ru`, технический домен — `vff2txu865.cdn.twcstorage.ru`.

## Источник пилота

Выделить `hls-origin.liga-live.ru` на текущем HostKey и выпустить для него TLS. Шаблон ниже вставляется отдельным файлом в `conf.d` внешнего `edge-nginx`, в контексте `http`. Перед применением заменить `cdn-test/test-live` на фактические slug выделенной тестовой организации и публичного стрима, а пути к сертификату — на пути, доступные контейнеру. Для выпуска и продления использовать существующий ACME-маршрут из [DEPLOY.md](DEPLOY.md).

```nginx
map $upstream_status:$uri $cdn_pilot_cache_control {
  default "no-store";
  ~^200:.*\.ts$ "public, max-age=0, s-maxage=5";
}

server {
  listen 443 ssl;
  server_name hls-origin.liga-live.ru;
  ssl_certificate /etc/ssl/hls-origin/cert.pem;
  ssl_certificate_key /etc/ssl/hls-origin/key.pem;
  resolver 127.0.0.11 valid=30s ipv6=off;

  location ~ ^/api/v1/public/orgs/cdn-test/streams/test-live/live/hls/(master\.m3u8|(hd|p720|p480|p240)/[a-zA-Z0-9_.-]+\.(m3u8|ts))$ {
    set $upstream_web streamservice-web:3000;
    proxy_pass http://$upstream_web$uri;
    proxy_set_header Host liga-live.ru;
    proxy_set_header Authorization "";
    proxy_set_header Cookie "";
    proxy_hide_header Cache-Control;
    proxy_hide_header Expires;
    proxy_hide_header Pragma;
    proxy_hide_header Set-Cookie;
    add_header Cache-Control $cdn_pilot_cache_control always;
  }

  location / {
    return 404;
  }
}
```

Проверить конфигурацию через `nginx -t` перед `reload`. Запросы идут через тот же Web/API, который проверяет видимость стрима. Отдельный виртуальный хост ограничивает весь CDN одним публичным тестовым маршрутом. Выделенный тестовый стрим сохраняет публичный режим на протяжении пилота. Имена сегментов FFmpeg повторяются между эфирами, поэтому перед повторным запуском пилота очистить кэш CDN.

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
