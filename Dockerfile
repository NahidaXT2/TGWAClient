FROM node:20-alpine

# Dependencias de sistema para Puppeteer/Chromium (requerido por wppconnect)
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-fira \
    ttf-fira-code \
    && mkdir -p /app

WORKDIR /app

COPY package*.json ./
RUN npm install --only=production

COPY . .

EXPOSE 7860

CMD ["node", "index.js"]
