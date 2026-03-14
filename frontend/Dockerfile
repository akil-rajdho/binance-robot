# Stage 1: Build
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# Build with standalone output
RUN npm run build

# Stage 2: Runtime
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# Next.js standalone mode
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
