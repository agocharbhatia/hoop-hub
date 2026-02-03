FROM oven/bun:1.1.29

# Needed for SSH tunneling to the ClickHouse droplet and HTTPS fetches.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssh-client ca-certificates bash \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json tsconfig.json ./
RUN bun install

COPY src ./src
COPY scripts ./scripts

ENV NODE_ENV=production
EXPOSE 8787

CMD ["/app/scripts/start-with-tunnel.sh"]
