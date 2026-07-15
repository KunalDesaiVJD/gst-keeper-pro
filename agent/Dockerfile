# GST Keeper Portal Agent - cloud container (no office PC needed).
#
# Runs the always-on queue poller with Chromium baked in. Deploy this to any host
# that keeps one small container running 24/7 (Render / Railway / Fly.io / a VPS).
# Config comes from environment variables (set in the cloud dashboard), so no .env
# and no secrets in the image.

FROM node:20-bookworm-slim

WORKDIR /app

# Install dependencies first (better layer caching). package-lock.json is committed
# so `npm ci` is reproducible. tsx (a devDependency) runs the agent, so no --omit=dev.
COPY package.json package-lock.json ./
RUN npm ci

# Install the exact Chromium build this Playwright version needs, plus its OS deps.
RUN npx playwright install --with-deps chromium

# App source.
COPY . .

# Headless in the cloud. When a login needs a CAPTCHA the agent captures the image
# and parks the job; a human types it once in the web app (from any device).
ENV HEADFUL=false
ENV NODE_ENV=production

CMD ["npm", "start"]
