# Komodo API i web aplikacija u jednom kontejneru. Gradi se iz korijena projekta.
FROM node:22-alpine
ENV NODE_ENV=production
# Niti libuv-a po procesu (scrypt za lozinke, fajlovi). docker-compose.yml ga može pregaziti.
ENV UV_THREADPOOL_SIZE=8
WORKDIR /app
COPY api/package.json api/package-lock.json api/
RUN cd api && npm ci --omit=dev && npm cache clean --force
COPY api/src api/src
COPY api/migrations api/migrations
COPY web web
# Volumen za snimke dobija vlasnika iz slike, pa ga pravimo za korisnika node.
RUN mkdir -p /data/uploads && chown node:node /data/uploads
USER node
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3002/api/health || exit 1
# index.js: migracije jednom, pa WORKERS radnih procesa (node:cluster) na istom portu.
CMD ["node", "api/src/index.js"]
