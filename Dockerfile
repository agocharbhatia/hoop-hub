FROM oven/bun:1.3.14 AS bun-runtime

FROM node:22-bookworm-slim AS build
COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY apps/web/package.json apps/web/bun.lock ./
RUN bun install --frozen-lockfile
COPY apps/web ./
RUN bun run build && bun install --production --frozen-lockfile

FROM node:22-bookworm-slim AS runtime
COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app /data/exports /backups && chown -R node:node /app /data /backups
WORKDIR /app
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json /app/tsconfig.json ./
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/src/lib/server ./src/lib/server
COPY --from=build --chown=node:node /app/src/lib/contracts ./src/lib/contracts
# Operator scripts use the same aliases as the app without depending on generated development files.
RUN printf '%s\n' '{"compilerOptions":{"baseUrl":".","paths":{"$lib/*":["src/lib/*"]}}}' > tsconfig.json
ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/agocharbhatia/hoop-hub" \
    org.opencontainers.image.revision=$VCS_REF
ENV HOOP_HUB_REVISION=$VCS_REF
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 BODY_SIZE_LIMIT=16384 \
    HOOP_HUB_DB_PATH=/data/hoop-hub.sqlite \
    HOOP_HUB_EXPORT_DIR=/data/exports HOOP_HUB_BACKUP_DIR=/backups
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD bun -e 'const r = await fetch("http://127.0.0.1:3000/api/health"); process.exit(r.ok ? 0 : 1)'
CMD ["node", "build/start-server.mjs"]

# Fly mounts a fresh filesystem over /data; initialize only its directory ownership, then drop privileges.
FROM runtime AS fly-runtime
USER root
RUN apt-get update && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*
COPY --chmod=755 deploy/fly-entrypoint.sh /usr/local/bin/hoop-hub-entrypoint
ENTRYPOINT ["/usr/local/bin/hoop-hub-entrypoint"]
CMD ["node", "build/start-server.mjs"]

# Preserve the existing non-root Docker/Compose image as the default build target.
FROM runtime AS final
