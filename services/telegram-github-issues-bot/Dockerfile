FROM node:20-alpine

WORKDIR /app

RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/telegram-github-issues-bot/package.json services/telegram-github-issues-bot/package.json
RUN pnpm --filter telegram-github-issues-bot install --prod --frozen-lockfile
COPY services/telegram-github-issues-bot/src services/telegram-github-issues-bot/src
WORKDIR /app/services/telegram-github-issues-bot

ENV NODE_ENV=production

CMD ["node", "src/index.js"]
