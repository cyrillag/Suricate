FROM node:20-alpine
WORKDIR /app
# Chromium from Alpine's own package repo, not Puppeteer's bundled download — Puppeteer's
# download is a glibc binary and doesn't run on this musl-based image. puppeteer-core (no bundled
# browser) + PUPPETEER_EXECUTABLE_PATH pointed at this package is the standard pattern for
# Puppeteer on Alpine. Font packages matter for PDF export fidelity (see FUNCTIONAL_RULES.md) —
# without them Chromium falls back to whatever bitmap font it can find, which looks noticeably
# worse than even a substituted sans-serif.
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont font-noto
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /data
VOLUME ["/data"]
ENV NODE_ENV=production
ENV DATA_DIR=/data
EXPOSE 3000
CMD ["node", "server.js"]
