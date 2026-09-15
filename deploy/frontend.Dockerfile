FROM dockerproxy.net/library/node:22-bookworm-slim AS build
WORKDIR /app/frontend
ENV NEXT_TELEMETRY_DISABLED=1
ARG NPM_REGISTRY=https://registry.npmjs.org
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --registry=${NPM_REGISTRY} --no-audit --no-fund
COPY frontend ./
ENV NEXT_PUBLIC_BASE_PATH=/script-master
ENV NEXT_PUBLIC_API_BASE_URL=/script-master/api
ENV NEXT_PUBLIC_HOST_LAUNCH_URL=/api/v1/script-master/launch
ENV NEXT_PUBLIC_HOST_DELIVERY_URL=/api/v1/script-master/deliveries
ENV BACKEND_API_URL=http://script-master-api:8000
RUN npm run build

FROM dockerproxy.net/library/node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/frontend/.next/standalone ./
COPY --from=build --chown=node:node /app/frontend/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
