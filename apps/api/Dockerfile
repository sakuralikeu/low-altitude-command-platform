# syntax=docker/dockerfile:1.7
FROM node:22.18.0-alpine3.22 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts && npm rebuild esbuild @parcel/watcher
COPY apps/api apps/api
RUN npm run build --workspace @low-altitude/api

FROM node:22.18.0-alpine3.22 AS runtime-deps
WORKDIR /runtime
COPY apps/api/package.json apps/api/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts

FROM node:22.18.0-alpine3.22 AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
RUN addgroup -S -g 10001 app && adduser -S -D -H -u 10001 -G app app \
  && mkdir -p /data && chown -R app:app /data
COPY --from=runtime-deps --chown=app:app /runtime/node_modules ./node_modules
COPY --from=runtime-deps --chown=app:app /runtime/package.json ./package.json
COPY --from=build --chown=app:app /app/apps/api/dist ./dist
USER app
EXPOSE 3000
HEALTHCHECK --interval=20s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "dist/server.js"]
