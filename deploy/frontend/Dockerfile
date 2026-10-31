FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY src/frontend.js ./src/frontend.js
COPY public/ ./public/
COPY shared/ ./shared/
USER node
EXPOSE 3210
CMD ["node", "src/frontend.js"]
