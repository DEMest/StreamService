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
