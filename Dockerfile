# syntax=docker/dockerfile:1

# ---- Build: compila o TypeScript ----
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- Runtime: só o necessário para rodar ----
# Imagem Debian (glibc), não Alpine: as dependências de voz usam binários pré-compilados para glibc.
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY assets ./assets

# data/ guarda o store.json; monte um volume persistente em /app/data na hospedagem
# para não perder a configuração a cada deploy.
RUN mkdir -p /app/data && chown node:node /app/data
USER node

# Node como PID 1 recebe o SIGTERM e o bot desmuta todos antes de desligar.
CMD ["node", "dist/index.js"]
