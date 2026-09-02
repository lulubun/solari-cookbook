# A long-lived Node process: a swarm holds twenty browsers open for minutes and
# streams frames the whole time, which is the shape serverless is worst at.
FROM node:20-alpine

WORKDIR /app

# Deps first so the layer caches across source edits. Note this installs
# devDependencies too: `tsx` runs the server, so pruning them would leave the
# image unable to boot without reaching the network.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
COPY public ./public

ENV NODE_ENV=production
ENV PORT=8080

# Single-use access codes are recorded here. Mount a volume at this path, or a
# redeploy silently un-spends every code that has been handed out.
ENV TS_STATE_DIR=/data
RUN mkdir -p /data

EXPOSE 8080

# Fail fast and visibly if the process stops answering.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1

CMD ["npx", "tsx", "src/server.ts"]
