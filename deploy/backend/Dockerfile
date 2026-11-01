FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN mkdir -p /data/backups && chown -R node:node /data
COPY src/server.js src/storage.js src/backup.js ./src/
COPY shared/contract.js shared/json.js shared/game-schema.js shared/time.js shared/equal.js shared/lesson-manifest.js ./shared/
COPY contracts/demo-game.json ./contracts/
USER node
EXPOSE 3211
CMD ["node", "src/server.js"]
