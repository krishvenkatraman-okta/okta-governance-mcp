# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source
COPY src ./src

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Copy docs and postman collection (for catalog parsing)
COPY docs ./docs
COPY postman ./postman

# Create keys directory
RUN mkdir -p keys

# Entrypoint script — writes PEM keys from env vars to files
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Environment variables will be provided at runtime
ENV NODE_ENV=production

# Expose port for HTTP server
EXPOSE 3002

# Entrypoint writes keys, then execs CMD
ENTRYPOINT ["./docker-entrypoint.sh"]

# Start the HTTP server (for cloud hosting)
# For stdio mode, override CMD with: node dist/index.js
CMD ["node", "dist/mrs-http.js"]
