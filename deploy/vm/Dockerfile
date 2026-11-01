FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY src/server.js src/storage.js src/frontend.js src/start.js src/backup.js ./src/
COPY shared/ ./shared/
COPY public/ ./public/
COPY contracts/kozel-game.schema.json contracts/kozel-game.example.json contracts/demo-game.json ./contracts/
USER node
EXPOSE 3210
CMD ["node", "src/start.js"]
