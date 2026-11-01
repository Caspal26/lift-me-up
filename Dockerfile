FROM litestream/litestream:0.3.13@sha256:027eda2a89a86015b9797d2129d4dd447e8953097b4190e1d5a30b73e76d8d58 AS litestream

FROM node:24-slim

# CA certificates for Litestream's HTTPS connection to the bucket (Node carries
# its own, the slim image has none for other programs).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream

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
COPY litestream.yml ./

EXPOSE 8080
CMD ["sh", "scripts/start.sh"]
