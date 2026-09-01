# Деплой StreamService (liga-live.ru)

## 1. Сертификаты

```bash
sudo mkdir -p /etc/ssl/regru
cat сертификат.crt корневой.crt | sudo tee /etc/ssl/regru/cert.pem > /dev/null
sudo cp ключ.key /etc/ssl/regru/key.pem
sudo chmod 600 /etc/ssl/regru/*.pem
```

## 2. Остановить arbitrage

```bash
cd ~/arbitrage
docker compose stop
```

## 3. DNS (reg.ru)

| Тип | Имя | Значение |
|-----|-----|----------|
| A   | @   | IP сервера |

## 4. Запустить StreamService

```bash
cd ~/streamservice
docker compose up -d --build
```

## 5. Проверить

```bash
docker compose ps
docker exec streamservice-nginx nginx -t
curl -I https://liga-live.ru
```

## 6. Файрвол

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 8890/udp
```

## Восстановить arbitrage

```bash
cd ~/streamservice && docker compose down
cd ~/arbitrage && docker compose start
```

## Админка на поддомене (admin.liga-live.ru)

Админка суперадмина живёт **только** на `admin.liga-live.ru`; на основном
домене `/admin` и `/api/v1/admin/` отдают 404.

Причина — cookie. `access_token`/`refresh_token` ставятся без атрибута
`domain`, то есть host-only, поэтому на разных именах это разные наборы: вход
под организацией на `liga-live.ru` и вход под суперадмином на поддомене больше
не затирают друг друга в одном браузере. Пока админка была на том же домене,
второй вход просто перезаписывал cookie первого.

Настройка разовая, автодеплою она не нужна:

1. **DNS** (reg.ru → панель хостинга, управление записями зоны):

   | Тип | Имя | Значение |
   |-----|-----|----------|
   | A   | admin.liga-live.ru. | тот же IP, что у `liga-live.ru` |

2. **Сертификат.** Отдельный не выпускаем: `admin.liga-live.ru` добавляется
   вторым именем в существующий сертификат (`certbot --expand`), чтобы срок и
   продление остались общими. Оба `server`-блока читают одни и те же
   `/etc/ssl/regru/{cert,key}.pem`.

3. **Конфиг** `nginx-streamservice.conf` → на сервер, `nginx -t`, перезагрузка.

> **Порядок важен.** Если применить конфиг раньше, чем сертификат начнёт
> покрывать поддомен, nginx не стартует из-за отсутствующего/несоответствующего
> `ssl_certificate` — и вместе с админкой ляжет **весь сайт**. Сначала
> сертификат, потом конфиг.

## Схема

```
Интернет
  │
  ├── :80  ──► nginx (redirect → 443)
  ├── :443 ──► nginx ──┬── liga-live.ru ──┬── /chat/  → api:3001
  │                     │                   ├── /hls/   → web:3000
  │                     │                   ├── /admin, /api/v1/admin/ → 404
  │                     │                   └── /*      → web:3000
  │                     │
  │                     └── admin.liga-live.ru ──┬── /admin, /login → web:3000
  │                                               ├── /api/v1/{auth,admin}/ → web:3000
  │                                               └── /* → 301 на основной домен
  │
  └── :8890/udp ──► mediamtx (SRT-инжест)
```
