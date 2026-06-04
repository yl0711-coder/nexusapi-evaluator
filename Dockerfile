# 评测工具容器化（在 slave 上 build；宿主机无需安装 Node）。
# 运行时数据（配置/报告/SQLite/.vault）全部落在挂载卷 /data 上，不进镜像。

# ---- 构建阶段：装依赖 + 构建前端 ----
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# ---- 运行阶段：只带运行所需 ----
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5180 \
    NEXUSAPI_DATA_DIR=/data
COPY --from=build /app/server.mjs ./server.mjs
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
COPY --from=build /app/docs ./docs
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
RUN mkdir -p /data
EXPOSE 5180
VOLUME ["/data"]
CMD ["node", "server.mjs"]
