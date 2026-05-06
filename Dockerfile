FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY src/ src/
COPY tsconfig.json ./
COPY entrypoint.sh ./

# Make entrypoint executable
RUN chmod +x entrypoint.sh

EXPOSE 3000

# Health check label for Komodo container orchestration
LABEL com.komodo.healthcheck="true"

ENTRYPOINT ["./entrypoint.sh"]
