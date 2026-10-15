# Server Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Install openssl for prisma engine build/detection
RUN apk add --no-cache openssl

# Copy root workspace configurations and package files
COPY package.json package-lock.json ./
COPY server/package.json ./server/

# Install dependencies for server workspace
RUN npm ci --workspace=server

# Copy server source code and prisma schema
COPY server/ ./server/

# Generate Prisma Client & compile TypeScript
RUN npx --prefix server prisma generate --schema=server/prisma/schema.prisma
RUN npm run build --workspace=server

# Production runtime stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Install openssl required by Prisma query engine on Alpine
RUN apk add --no-cache openssl

# Copy root dependencies and server package
COPY package.json package-lock.json ./
COPY server/package.json ./server/

RUN npm ci --omit=dev --workspace=server

# Copy generated prisma client, built code, and schema
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/prisma ./server/prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY scripts/ ./scripts/

WORKDIR /app

EXPOSE 3001

CMD ["sh", "-c", "npx --prefix server prisma db push --schema=server/prisma/schema.prisma && node server/dist/index.js"]
