FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public
COPY scripts ./scripts
COPY seed ./seed

EXPOSE 8080
CMD ["node", "server/index.js"]
