FROM node:22-alpine AS builder

WORKDIR /usr/src/app

# Enable corepack to use pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --config.strict-dep-builds=false

COPY . .
RUN pnpm run build

RUN pnpm prune --prod

FROM node:22-alpine AS production

WORKDIR /usr/src/app

ENV NODE_ENV=production

COPY --from=builder --chown=node:node /usr/src/app/dist ./dist
COPY --from=builder --chown=node:node /usr/src/app/node_modules ./node_modules
COPY --from=builder --chown=node:node /usr/src/app/package.json ./

USER node

ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/main"]
