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
ARG NEXT_PUBLIC_SERVER_IP=
# Порты MediaMTX, проброшенные наружу. Зашиваются в строки SRT/RTMP-вставки
# в Studio UI и старом дашборде. На тест-стенде заданы в .env (см. .env.example).
ARG NEXT_PUBLIC_SRT_PORT=8890
ARG NEXT_PUBLIC_RTMP_PORT=1935
ARG NEXT_PUBLIC_HLS_PORT=8888

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_STREAM_URL=$NEXT_PUBLIC_STREAM_URL
ENV HLS_UPSTREAM=$HLS_UPSTREAM
ENV API_UPSTREAM=$API_UPSTREAM
ENV NEXT_PUBLIC_SOCKET_URL=$NEXT_PUBLIC_SOCKET_URL
ENV NEXT_PUBLIC_SERVER_IP=$NEXT_PUBLIC_SERVER_IP
ENV NEXT_PUBLIC_SRT_PORT=$NEXT_PUBLIC_SRT_PORT
ENV NEXT_PUBLIC_RTMP_PORT=$NEXT_PUBLIC_RTMP_PORT
ENV NEXT_PUBLIC_HLS_PORT=$NEXT_PUBLIC_HLS_PORT
ENV PORT=3000

RUN pnpm --filter web build

EXPOSE 3000

CMD ["pnpm", "--filter", "web", "exec", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
