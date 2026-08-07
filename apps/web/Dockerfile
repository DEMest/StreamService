FROM node:20-alpine

WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json

RUN pnpm install --frozen-lockfile

COPY . .

ARG NEXT_PUBLIC_API_URL=/api
ARG NEXT_PUBLIC_STREAM_URL=/hls/live/stream/index.m3u8
ARG HLS_UPSTREAM=http://mediamtx:8888
ARG API_UPSTREAM=http://api:3001
ARG NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
# Демо-ролик лендинга. Лежит в объектном хранилище, а не в apps/web/public —
# 97 МБ в git/образе не нужны. Пусто = лендинг покажет статичную заглушку.
ARG NEXT_PUBLIC_DEMO_VIDEO_URL=

# NEXT_PUBLIC_SERVER_IP / SRT_PORT / RTMP_PORT здесь больше нет намеренно.
# Next.js подставляет NEXT_PUBLIC_* в клиентский бандл на СБОРКЕ, поэтому смена
# адреса стенда требовала пересборки образа. Теперь дашборд получает их в
# рантайме из GET /v1/org/ingest-config, и образ web одинаков для любого стенда.
# NEXT_PUBLIC_HLS_PORT удалён совсем — в коде он не использовался.

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_STREAM_URL=$NEXT_PUBLIC_STREAM_URL
ENV HLS_UPSTREAM=$HLS_UPSTREAM
ENV API_UPSTREAM=$API_UPSTREAM
ENV NEXT_PUBLIC_SOCKET_URL=$NEXT_PUBLIC_SOCKET_URL
ENV NEXT_PUBLIC_DEMO_VIDEO_URL=$NEXT_PUBLIC_DEMO_VIDEO_URL
ENV PORT=3000

RUN pnpm --filter web build

EXPOSE 3000

CMD ["pnpm", "--filter", "web", "exec", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
