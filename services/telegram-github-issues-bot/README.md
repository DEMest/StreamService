# Telegram → GitHub Issues bot

Независимый микросервис для рабочих Telegram-групп. Настройки каждого
пользователя и чата хранятся в MongoDB: несколько репозиториев, псевдонимы и
направления внутри репозитория (например, `mobile`, `backend`, `web`).

## Запуск

```bash
cd services/telegram-github-issues-bot
cp .env.example .env
# заполните .env: Telegram, DeepSeek и GitHub App
docker compose up -d --build
docker compose logs -f
```

Остановка: `docker compose down`.

Это отдельный Compose-проект и отдельный контейнер: он не подключается к
PostgreSQL, API или сетям StreamService.

## Автовыкладка

Workflow `.github/workflows/telegram-github-issues-bot.yml` запускается только
когда меняется эта папка. В PR он проверяет синтаксис, а после merge в `main`
подключается к тому же серверу через уже существующие `DEPLOY_*` GitHub secrets
и выполняет `docker compose up -d --build` **только для бота**. Контейнеры
основного StreamService не перезапускаются.

Перед первым merge на сервере нужно один раз создать конфигурацию рядом с
compose-файлом:

```bash
cd /путь/к/StreamService/services/telegram-github-issues-bot
cp .env.example .env
chmod 600 .env
# заполните реальные Telegram, DeepSeek и GitHub ключи
```

Файл `.env` игнорируется git, поэтому `git merge` во время выкладки не заменит
ключи. Если его нет, workflow завершится ошибкой до запуска Docker.

## Настройка Telegram

1. Создайте бота через [@BotFather](https://t.me/BotFather) и задайте
   `TELEGRAM_BOT_TOKEN`.
2. Добавьте бота в нужную группу.
3. Отключите Privacy Mode в BotFather: после нажатия «Изменить» бот должен
   получить обычное текстовое сообщение автора с инструкцией по правке.
4. Настройте GitHub App с разрешением **Issues: Read and write**, сохраните её
   App ID и base64 приватного ключа в `.env`. Пользователь устанавливает App
   только на нужные ему репозитории; в MongoDB остаётся только installation ID,
   а не его GitHub token.

## Поведение

- `/start` или `/help` — встроенная инструкция;
- `/connect` — ссылка на установку GitHub App;
- `/repo add app org/repo installation_id` — подключить репозиторий;
- `/repo list`, `/repo use app` — посмотреть и выбрать репозиторий;
- `/area add app mobile --labels=mobile,ios --prefix="[Mobile]"` — добавить
  направление и labels;
- `/area list app`, `/area use app mobile` — посмотреть и выбрать направление;
- `/issue app mobile Исправить экран оплаты` — подготовить задачу. `app` и
  `mobile` необязательны: бот использует последние выбранные настройки;
- кнопка «Изменить» ждёт следующее текстовое сообщение автора и обновляет
  черновик через DeepSeek;
- кнопки «Создать issue», «Изменить» и «Отмена» доступны только тому, кто запросил
  черновик.

Черновики хранятся только в памяти контейнера и живут 30 минут. После
перезапуска их нужно подготовить заново; уже созданные GitHub issues не
затрагиваются.

## Права GitHub

GitHub App выпускает короткоживущий installation token только во время запроса.
Бот не получает и не хранит персональные GitHub PAT пользователей.

## Переход на webhook

Сервис сейчас использует long polling: это проще для отдельного Docker
контейнера и не требует публичного HTTPS-адреса. В Docker может работать лишь
одна его копия. При переносе в Kubernetes стоит заменить polling на webhook и
добавить постоянное хранилище черновиков (Redis/PostgreSQL), чтобы безопасно
масштабировать реплики.
