# Content Lab worker, built as an Apify actor. Build context is the repo root
# (see .actor/actor.json), so the workspace package is available.
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @content-lab/worker...
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/worker apps/worker
RUN pnpm --filter @content-lab/worker build

FROM apify/actor-node:22
RUN apk add --no-cache ffmpeg
WORKDIR /usr/src/app
COPY --from=build /repo/apps/worker/dist ./dist
CMD ["node", "--enable-source-maps", "dist/main.js"]
