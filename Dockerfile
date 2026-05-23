# Stage 1: Build web frontend
FROM oven/bun:1.2 AS web-builder
WORKDIR /app/web
COPY web/package.json web/bun.lock* ./
RUN bun install --frozen-lockfile
COPY web/ ./
RUN bun run build

# Stage 2: Production image
FROM oven/bun:1.2-slim
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

COPY src/ ./src/
COPY tsconfig.json ./

COPY --from=web-builder /app/web/dist ./web/dist

ENV PORT=19877
EXPOSE 19877

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:19877/health || exit 1

CMD ["bun", "run", "src/index.ts", "--http", "--web", "--port", "19877", "--no-mcp"]
