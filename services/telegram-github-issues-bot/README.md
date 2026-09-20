# Telegram → GitHub Issues bot

Независимый микросервис для создания GitHub Issues из Telegram-групп. В одном
контейнере работают Telegram long polling и HTTP backend для Mini App; MongoDB
хранит общие настройки групп, подключённые репозитории и короткоживущие setup
sessions. Сервис не использует API, PostgreSQL или сети основного
StreamService.

## Пользовательский сценарий

- администратор группы запускает `/settings` и открывает Mini App;
- Mini App проверяет подпись Telegram и актуальную роль администратора;
- `Connect GitHub` сначала проводит администратора через OAuth и находит уже
  существующие установки GitHub App (`GET /user/installations`); если установки
  нет, отправляет на страницу установки и после Setup URL повторяет OAuth.
  Доступные репозитории всех установок пользователя показываются одним списком;
- администратор может подключить к группе несколько репозиториев и выбрать для
  каждого разрешённые labels из существующих GitHub labels;
- администратор задаёт постоянный AI context и язык issue отдельно для каждой
  Telegram-группы;
- любой участник группы запускает `/issue <description>`;
- при одном репозитории он выбирается автоматически, при нескольких бот
  показывает выбор;
- DeepSeek готовит черновик. Автор может добавить разрешённые labels,
  отредактировать его через модель, создать issue или отменить;
- issue создаётся от GitHub App, а внизу описания фиксируется Telegram-автор
  запроса.

Все команды, ответы бота и Mini App используют английский язык. Labels
необязательны и по умолчанию не устанавливаются.

### AI context группы

В Mini App раздел `AI context` хранит до 8000 символов постоянного контекста
для выбранной Telegram-группы: назначение продукта, стек, терминологию и
правила оформления issue. Контекст применяется и при первом создании, и при
редактировании черновика. Не добавляйте туда credentials или другие секреты.

Язык можно зафиксировать как English или Russian. Режим `Match request`
сохраняет язык запроса, а для нейтрального текста вроде `test` использует
English. Модель отдельно инструктируется не переключаться на китайский или
другой посторонний язык без явной просьбы пользователя.

## Локальный запуск

Compose подключает бот к уже используемой production-сети `edge`, чтобы
edge-nginx мог обращаться к нему по имени. Для локального запуска сеть можно
создать один раз:

```bash
docker network create edge
cd services/telegram-github-issues-bot
cp .env.example .env
# заполните Telegram, DeepSeek и GitHub App credentials
docker compose up -d --build
docker compose logs -f telegram-github-issues-bot
```

Проверки без Docker:

```bash
cd services/telegram-github-issues-bot
pnpm check
pnpm test
```

Остановка: `docker compose down`. Это затрагивает только бот и его MongoDB.

## Telegram

1. Создайте бота через [@BotFather](https://t.me/BotFather), сохраните token в
   `TELEGRAM_BOT_TOKEN`.
2. В BotFather создайте для него Mini App (`/newapp`):
   - Web App URL: `https://bot.liga-live.ru`;
   - short name: значение `TELEGRAM_MINI_APP_SHORT_NAME`.
3. Добавьте бота в группу. Администратор запускает `/settings` именно в этой
   группе; ссылка содержит случайную 30-минутную сессию, привязанную к группе и
   Telegram user ID.
4. Отключите Privacy Mode. Это нужно для сообщения, которое автор отправляет
   после нажатия `Edit`.

Menu button `Settings` бот устанавливает сам при старте. Telegram показывает
его в личном чате с ботом; первый вход для новой группы всё равно выполняется
командой `/settings` внутри группы.

## GitHub App

Используется один общий GitHub App. Пользовательские PAT не нужны и не
хранятся.

Настройки GitHub App:

- Homepage URL: `https://bot.liga-live.ru`;
- Callback URL: `https://bot.liga-live.ru/github/callback`;
- Setup URL: `https://bot.liga-live.ru/github/setup`;
- `Request user authorization (OAuth) during installation`: выключено — OAuth
  запускается backend с собственным `state` и PKCE;
- Webhooks: выключены, события боту не нужны;
- GitHub App visibility: **Public**, чтобы его могли устанавливать другие
  GitHub-пользователи и организации;
- Repository permission `Issues`: **Read and write**. Metadata read GitHub
  добавляет автоматически.

Сохраните в `.env`:

- App ID → `GITHUB_APP_ID`;
- private key в base64 → `GITHUB_APP_PRIVATE_KEY_BASE64`;
- Client ID → `GITHUB_CLIENT_ID`;
- сгенерированный Client secret → `GITHUB_CLIENT_SECRET`;
- install URL вида `https://github.com/apps/<app-slug>/installations/new` →
  `GITHUB_APP_INSTALL_URL`.

Кодирование private key:

```bash
base64 -i private-key.pem | tr -d '\n'
```

GitHub callback не доверяет входному `installation_id`: backend проверяет
installation через App JWT, получает короткоживущий user token и убеждается,
что авторизованный GitHub-пользователь действительно видит эту installation.
Установки берутся из `GET /user/installations` с этим токеном, поэтому уже
установленное приложение не требует повторной установки и перехода на Setup URL.
User token после проверки не сохраняется. Issues создаются короткоживущим
installation token от имени GitHub App.

## Публичный HTTPS

Новый домен покупать не нужно: используется бесплатный поддомен существующего
`liga-live.ru`.

Перед включением Mini App на production:

1. Добавьте DNS A record `bot.liga-live.ru` на IP production-сервера.
2. Добавьте `bot.liga-live.ru` в общий Let's Encrypt сертификат полным
   `certonly --expand` списком и в `~/edge/renew-certs.sh`.
3. Перенесите блоки из [`nginx-bot.conf.example`](nginx-bot.conf.example) в
   живой `~/edge/nginx/conf.d/streamservice.conf`.
4. Выполните `docker exec edge-nginx nginx -t`, затем только `reload`, не
   `restart`: этот nginx обслуживает текущие трансляции.
5. Проверьте `https://bot.liga-live.ru/health`.

Репозиторный nginx-конфиг не применяется автодеплоем, поэтому этот шаг делается
на сервере отдельно.

## Обновление существующей установки

Старый `.env` остаётся пригодным, но для Mini App нужно дописать:

```dotenv
PUBLIC_BASE_URL=https://bot.liga-live.ru
TELEGRAM_MINI_APP_SHORT_NAME=issues-settings
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

`ALLOWED_TELEGRAM_USER_IDS` больше не используется: создавать issue может любой
участник настроенной группы, а менять настройки — только текущий Telegram admin.

Прежняя коллекция `repositoryConfigs`, где настройки принадлежали отдельному
пользователю, не удаляется. Пока у группы нет новой общей конфигурации, `/issue`
использует старые репозитории автора в read-only режиме, поэтому текущий bot
flow не обрывается сразу после деплоя. Старые `/repo` и `/area` больше не
редактируют настройки. Администратор один раз подключает репозитории через
`/settings`; после сохранения общей конфигурации legacy fallback для этой
группы перестаёт использоваться.

## Автовыкладка

Workflow `.github/workflows/telegram-github-issues-bot.yml` запускается только
для этой папки и своего workflow. В PR он проверяет синтаксис и тесты, а после
merge в `main` пересобирает только Compose-проект
`telegram-github-issues-bot`. Контейнеры основного StreamService не
перезапускаются.

На сервере `.env` остаётся рядом с compose-файлом и не коммитится:

```bash
cd /путь/к/StreamService/services/telegram-github-issues-bot
cp .env.example .env
chmod 600 .env
```

Черновики issue хранятся в памяти и живут 30 минут. GitHub/Mini App setup
sessions хранятся в MongoDB с TTL, поэтому переживают перезапуск контейнера.
Long polling допускает только одну реплику бота; перед горизонтальным
масштабированием его нужно заменить webhook-доставкой, а черновики перенести в
общее хранилище.
