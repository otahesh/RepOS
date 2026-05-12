# syntax=docker/dockerfile:1.6

# ─── Stage 1: frontend builder ──────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build
# Output: /build/frontend/dist

# ─── Stage 2: api builder ───────────────────────────────────────
FROM node:20-alpine AS api-builder
WORKDIR /build/api
COPY api/package.json api/package-lock.json ./
RUN npm ci
COPY api/ ./
RUN npm run build && npm prune --omit=dev
# Output: /build/api/dist + pruned /build/api/node_modules

# ─── Stage 3: runtime ───────────────────────────────────────────
FROM lscr.io/linuxserver/baseimage-alpine:3.21

# Runtime packages: postgres + node + nginx + tooling.
# postgresql16-client supplies pg_isready and psql for init scripts.
RUN apk add --no-cache \
      nodejs \
      postgresql16 \
      postgresql16-client \
      postgresql16-contrib \
      nginx \
      bash \
      tzdata

# Verify postgres binaries are where the s6 scripts expect them.
# Alpine's postgresql16 package puts binaries in /usr/bin/. Fail the build
# loudly if a future Alpine release moves them.
RUN test -x /usr/bin/postgres && test -x /usr/bin/initdb && test -x /usr/bin/pg_isready && test -x /usr/bin/pg_dump

# App layout (lsio uses /config for persistent data; /app for read-only code)
RUN mkdir -p /app/api /app/frontend /config /config/backups /config/log/backup

COPY --from=api-builder      /build/api/dist          /app/api/dist
COPY --from=api-builder      /build/api/node_modules  /app/api/node_modules
COPY --from=api-builder      /build/api/package.json  /app/api/package.json
COPY --from=frontend-builder /build/frontend/dist     /app/frontend

# Operational scripts (pre-restore snapshot, cutover SQL) invoked via docker exec.
COPY scripts /scripts

# nginx config + s6 service tree
COPY docker/nginx/repos.conf  /etc/nginx/http.d/default.conf
COPY docker/root/             /

# Override Alpine nginx's main-level error_log so startup errors hit stderr
# (where s6-log can capture them) instead of /var/log/nginx/error.log.
# The leading whitespace match handles Alpine's tab-indented directive.
RUN sed -i \
      -e 's|^[[:space:]]*error_log .*|error_log /dev/stderr warn;|' \
      /etc/nginx/nginx.conf

# Make all script files executable (COPY does not preserve unless explicit)
RUN find /etc/s6-overlay -type f \( -name 'run' -o -name 'up' -o -path '*scripts*' \) -exec chmod +x {} + && \
    chmod +x /usr/local/bin/repos-backup.sh

# lsio's stock cont-init.d chowns /config recursively to abc:abc (PUID:PGID).
# That would steal /config/postgres from the postgres user (uid 70) on every
# boot and break initdb's chmod-700 contract. This hook re-asserts ownership
# AFTER the lsio chown loop runs (filename order: 99-* runs last).
RUN mkdir -p /etc/cont-init.d && \
    printf '#!/usr/bin/with-contenv bash\nif [ -d /config/postgres ]; then\n  chown -R postgres:postgres /config/postgres\n  chmod 700 /config/postgres\nfi\n' \
      > /etc/cont-init.d/99-postgres-perms && \
    chmod +x /etc/cont-init.d/99-postgres-perms

EXPOSE 80

# Healthcheck: nginx → /health (proxied to API)
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1/health || exit 1

# baseimage-alpine sets ENTRYPOINT ["/init"] which boots s6-overlay v3.
