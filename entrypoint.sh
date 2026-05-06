#!/bin/sh
set -e

echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] [INFO] domain-manager-mcp starting"

# Show environment
if [ -n "$PORT" ]; then
    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] [INFO] HTTP mode: PORT=$PORT"
else
    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] [INFO] stdio mode (local binary)"
fi

if [ -n "$CLOUDFLARE_API_TOKEN" ]; then
    token_len=${#CLOUDFLARE_API_TOKEN}
    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] [INFO] CLOUDFLARE_API_TOKEN configured (${token_len} chars)"
else
    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] [WARN] CLOUDFLARE_API_TOKEN not set"
fi

if [ -n "$HTTP_PROXY" ] || [ -n "$HTTPS_PROXY" ]; then
    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] [INFO] HTTP proxy configured: HTTP_PROXY=$HTTP_PROXY HTTPS_PROXY=$HTTPS_PROXY"
fi

echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] [INFO] Starting bun process..."
exec bun src/index.ts
