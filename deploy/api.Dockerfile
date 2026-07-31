# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/prompting/package.json packages/prompting/package.json
RUN --mount=type=cache,id=seqora-pnpm-api,target=/pnpm/store \
  pnpm install --frozen-lockfile --filter @seqora/api...

COPY apps/api apps/api
COPY packages/contracts packages/contracts
COPY packages/prompting packages/prompting
RUN pnpm build:shared && pnpm --filter @seqora/api build
RUN pnpm --filter @seqora/api deploy --prod --legacy /opt/seqora-api

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV API_PORT=8787
ENV DATA_FILE=/var/lib/seqora/app.json
ENV UPLOAD_DIR=/var/lib/seqora/uploads
ENV FFMPEG_PATH=/usr/bin/ffmpeg
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /var/lib/seqora \
  && chown node:node /var/lib/seqora

COPY --from=build --chown=node:node /opt/seqora-api /app

USER node
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
