# Node.js 22 LTS Alpine image for minimal size and security
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Copy package descriptors
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy application source code and public assets
COPY src/ ./src/
COPY public/ ./public/
COPY reviews.csv ./

# Create data directory for persistent cache volume
RUN mkdir -p data uploads

# Expose server port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Start server
CMD ["node", "src/server.js"]
