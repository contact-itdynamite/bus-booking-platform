FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
# npm install works without package-lock.json; --omit=dev skips devDependencies
RUN npm install --omit=dev --no-audit --prefer-offline

FROM node:20-alpine
WORKDIR /app
# Run as non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=builder /app/node_modules ./node_modules
COPY . .
RUN chown -R appuser:appgroup /app
USER appuser
EXPOSE ${PORT:-3000}
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3000}/health || exit 1
CMD ["node", "src/index.js"]

