FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force \
    && mkdir -p /data/backups && chown -R node:node /data
COPY src/ ./src/
COPY shared/ ./shared/
COPY contracts/kozel-game.schema.json contracts/kozel-game.example.json ./contracts/
USER node
EXPOSE 3211
CMD ["node", "src/server.js"]
