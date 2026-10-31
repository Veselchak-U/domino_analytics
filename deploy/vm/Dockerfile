FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY src/ ./src/
COPY shared/ ./shared/
COPY public/ ./public/
COPY contracts/kozel-game.schema.json contracts/kozel-game.example.json ./contracts/
USER node
EXPOSE 3210
CMD ["node", "src/start.js"]
