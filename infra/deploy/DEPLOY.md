# Деплой StreamService (standalone на 443)

Arbitrage останавливается, StreamService занимает 80/443 со своим nginx.

## 1. Сертификаты

Файлы от reg.ru положить на сервере:

```
/etc/ssl/regru/cert.pem    — сертификат (или цепочка cert + CA bundle)
/etc/ssl/regru/key.pem     — приватный ключ
```

```bash
sudo mkdir -p /etc/ssl/regru
sudo cp сертификат.crt /etc/ssl/regru/cert.pem
sudo cp ключ.key       /etc/ssl/regru/key.pem
sudo chmod 600 /etc/ssl/regru/*.pem
```

Если reg.ru дал отдельный CA bundle, склей в один файл:

```bash
cat сертификат.crt ca_bundle.crt > /etc/ssl/regru/cert.pem
```

## 2. Остановить arbitrage

```bash
cd ~/arbitrage
docker compose stop
```

## 3. DNS (reg.ru)

В панели домена бердсктв.рф:

| Тип | Имя | Значение |
|-----|-----|----------|
| A   | @   | IP сервера |

## 4. Настроить .env StreamService

```
NEXT_PUBLIC_SOCKET_URL=https://xn--90abalcpekgi.xn--p1ai
```

## 5. Запустить StreamService

```bash
cd ~/streamservice
docker compose -f docker-compose.yml -f infra/deploy/docker-compose.prod.yml up -d --build
```

## 6. Проверить

```bash
docker compose -f docker-compose.yml -f infra/deploy/docker-compose.prod.yml ps
docker exec streamservice-nginx nginx -t
curl -I https://xn--90abalcpekgi.xn--p1ai
```

## 7. Файрвол

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 8890/udp   # SRT-инжест
```

## Восстановить arbitrage

```bash
cd ~/streamservice
docker compose -f docker-compose.yml -f infra/deploy/docker-compose.prod.yml down

cd ~/arbitrage
docker compose start
```

## Схема

```
Интернет
  │
  ├── :80  ──► nginx (redirect → 443)
  ├── :443 ──► nginx ──┬── /chat/  → api:3001
  │                     ├── /hls/   → web:3000
  │                     └── /*      → web:3000
  │
  └── :8890/udp ──► mediamtx (SRT-инжест)
```
