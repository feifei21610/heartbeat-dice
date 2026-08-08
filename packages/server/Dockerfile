# 后端镜像。多阶段：先在 builder 里把 shared 引擎和服务端打成单文件
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
RUN npm ci --include-workspace-root -w @game/server

COPY packages/shared ./packages/shared
COPY packages/server ./packages/server
RUN npm run build -w @game/server

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/server/package.json ./packages/server/
RUN npm ci --omit=dev --include-workspace-root -w @game/server && npm cache clean --force

# 打包产物已内联 @game/shared，只需带上这一个文件
COPY --from=builder /app/packages/server/build ./packages/server/build

EXPOSE 2567
CMD ["node", "packages/server/build/index.js"]
