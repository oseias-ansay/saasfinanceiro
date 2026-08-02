# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Chromium do próprio Alpine, não o que o Puppeteer baixaria.
#
# Por isso a dependência é `puppeteer-core` (sem navegador embutido): o
# Chromium do npm é glibc e não roda em Alpine, que é musl. Instalar pelo
# apk resolve o binário certo e ainda deixa a imagem bem menor.
#
# As fontes não são opcional: sem elas o PDF sai com quadrados no lugar
# de acentos, e "Razão Social" vira "Raz□o Social" na capa do relatório.
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      font-noto \
      ttf-dejavu \
 && rm -rf /var/cache/apk/*

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    CHROMIUM_PATH=/usr/bin/chromium-browser

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

USER node
EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3333/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
