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

# Environment variables will be provided at runtime
ENV NODE_ENV=production

# Expose ports for MAS and MRS
EXPOSE 3000 3001

# Default to MRS mode (override with docker run -e SERVER_MODE=mas)
ENV SERVER_MODE=mrs

# Start the server
CMD ["node", "dist/index.js"]
