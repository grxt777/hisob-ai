# Office AI on Railway. The Playwright image already has Chromium and all its system libraries.
FROM mcr.microsoft.com/playwright:v1.65.1-noble

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    PLAYWRIGHT_MCP_BROWSER=chromium \
    PLAYWRIGHT_MCP_SANDBOX=false

# XGBoost cash-flow forecast (lib/forecast) runs in Python; ffmpeg converts Mini App voice for speech-to-text
COPY lib/forecast/requirements.txt /tmp/forecast-requirements.txt
RUN apt-get update && apt-get install -y --no-install-recommends python3-pip ffmpeg \
 && pip3 install --no-cache-dir --break-system-packages -r /tmp/forecast-requirements.txt \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
 # Playwright MCP ships its own Playwright build: install the matching Chromium for it
 && node node_modules/@playwright/mcp/node_modules/playwright/cli.js install chromium \
 && mkdir -p /data

COPY . .

EXPOSE 8080
CMD ["node", "server.js"]
