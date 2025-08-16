# Use Node.js slim image for smaller size
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --production

# Copy source code
COPY src ./src

# Create directory for cached data
RUN mkdir -p /app/cache

# The MCP server will run on port 3000
EXPOSE 3000

# Start the container server
CMD ["node", "src/container-server.js"]