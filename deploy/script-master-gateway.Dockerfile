# Reuse the already validated main application assets; replace the gateway only.
ARG BASE_WEB_IMAGE
FROM ${BASE_WEB_IMAGE}
COPY deploy/Caddyfile /etc/caddy/Caddyfile
