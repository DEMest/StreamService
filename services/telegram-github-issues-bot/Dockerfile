FROM node:20-alpine

WORKDIR /app

RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY src ./src

ENV NODE_ENV=production

CMD ["node", "src/index.js"]
