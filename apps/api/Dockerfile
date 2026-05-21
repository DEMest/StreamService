FROM node:20-alpine

# openssl для движка Prisma
RUN apk add --no-cache openssl ffmpeg

WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

# Разрешаем pnpm скачивать бинарники Prisma
RUN pnpm config set ignore-scripts false

# Копируем конфиги для установки
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

# Копируем схему
COPY prisma ./prisma

# Устанавливаем зависимости из lock-файла (retry при нестабильной сети)
RUN pnpm config set fetch-retries 5 && \
    pnpm config set fetch-retry-mintimeout 20000 && \
    pnpm config set fetch-retry-maxtimeout 120000 && \
    pnpm install --frozen-lockfile

# Убиваем ЛЮБУЮ самодеятельность Prisma.
# Явно добавляем в корень и CLI, и сам клиент.
# Теперь генератор увидит обе зависимости и ничего не будет скачивать сам.
RUN pnpm add -w -D prisma@6.19.3
RUN pnpm add -w @prisma/client@6.19.3

# bcrypt в корень — seed.ts (в /app/prisma/) импортирует его, а в workspace-репе
# bcrypt живёт только в apps/api/node_modules, недоступен ts-node компилятору сверху.
RUN pnpm add -w bcrypt@^6.0.0
RUN pnpm add -w -D @types/bcrypt@^6.0.0

# Копируем весь остальной код (чтобы Nest.js было что собирать)
COPY . .

# Генерируем типы (теперь автоустановка клиента не триггернется)
RUN pnpm exec prisma generate

# Собираем Nest.js
RUN pnpm --filter api build

# Прекомпилируем seed в .js, чтобы не зависеть от ts-node / ESM-loader на runtime.
RUN pnpm --filter api exec tsc \
        --outDir /app/seed-out \
        --rootDir /app/prisma \
        --esModuleInterop \
        --skipLibCheck \
        --resolveJsonModule \
        --target es2020 \
        --module commonjs \
        /app/prisma/seed.ts

ENV API_PORT=3001
ENV STREAM_URL=/hls/live/stream/index.m3u8

EXPOSE 3001

CMD ["sh", "-c", "pnpm exec prisma migrate deploy && NODE_PATH=/app/apps/api/node_modules node /app/seed-out/seed.js && node apps/api/dist/main.js"]