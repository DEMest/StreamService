FROM node:20-alpine

# openssl для движка Prisma
RUN apk add --no-cache openssl ffmpeg

WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

# Разрешаем pnpm скачивать бинарники Prisma
RUN pnpm config set ignore-scripts false

# Копируем конфиги для установки.
# .npmrc обязателен ДО install: в нём public-hoist-pattern для @prisma/client.
# Без него раскладка node_modules другая, prisma не находит клиент и лезет
# доустанавливать себя сама (`pnpm add prisma` прямо во время сборки).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

# Копируем схему
COPY prisma ./prisma

# Устанавливаем зависимости из lock-файла (retry при нестабильной сети)
RUN pnpm config set fetch-retries 5 && \
    pnpm config set fetch-retry-mintimeout 20000 && \
    pnpm config set fetch-retry-maxtimeout 120000 && \
    pnpm install --frozen-lockfile

# Копируем весь остальной код (чтобы Nest.js было что собирать)
COPY . .

# Генерируем типы. Через --filter api, потому что prisma — devDependency
# именно apps/api; в корневом node_modules/.bin её нет и быть не должно.
RUN pnpm --filter api exec prisma generate

# Собираем Nest.js
RUN pnpm --filter api build

# Прекомпилируем seed в .js, чтобы не зависеть от ts-node / ESM-loader на runtime.
# Настройки вынесены в prisma/tsconfig.seed.json — там же объяснено, почему
# bcrypt требует явного paths-маппинга (флагом --paths tsc задать нельзя).
RUN pnpm --filter api exec tsc -p /app/prisma/tsconfig.seed.json

ENV API_PORT=3001
ENV STREAM_URL=/hls/live/stream/index.m3u8

EXPOSE 3001

CMD ["sh", "-c", "pnpm --filter api exec prisma migrate deploy && NODE_PATH=/app/apps/api/node_modules node /app/seed-out/seed.js && node apps/api/dist/main.js"]