# Frontend Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Arguments for Next.js build-time environment variables
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY package.json package-lock.json ./
COPY web/package.json ./web/

# Install dependencies across workspace
RUN npm ci --workspace=web

# Copy frontend source
COPY web/ ./web/

# Build Next.js application from web directory
WORKDIR /app/web
RUN npx next build

# Production runtime stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json ./
COPY web/package.json ./web/

RUN npm ci --omit=dev --workspace=web

COPY --from=builder /app/web/.next ./web/.next
COPY --from=builder /app/web/public ./web/public
COPY --from=builder /app/web/next.config.ts ./web/next.config.ts

WORKDIR /app/web

EXPOSE 3000

CMD ["npx", "next", "start", "-p", "3000"]
