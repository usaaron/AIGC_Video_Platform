# syntax=docker/dockerfile:1

FROM node:22.13-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @seqora/contracts build
RUN pnpm --filter @seqora/api build
RUN pnpm --filter @seqora/api --prod deploy --legacy /prod/api

FROM node:22.13-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV API_PORT=8787

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /prod/api ./
COPY apps/api/migrations ./migrations
COPY apps/api/data ./data

EXPOSE 8787

CMD ["node", "dist/server.js"]
