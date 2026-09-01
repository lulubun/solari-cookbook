# Long-lived Node process: a swarm holds twenty browsers open for minutes and
# streams frames the whole time, which is the shape serverless is worst at.
FROM node:20-alpine

WORKDIR /app

# Deps first so the layer caches across source edits.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY tsconfig.json ./
COPY src ./src
COPY public ./public

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# tsx runs the TypeScript directly; there is no build artifact to ship.
CMD ["npx", "tsx", "src/server.ts"]
