#!/bin/bash

echo "🚀 Deploying MCP Server with Containers"
echo "========================================"
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker Desktop first."
    echo "   Download from: https://www.docker.com/products/docker-desktop"
    exit 1
fi

echo "✅ Docker is running"
echo ""

# Check if Workers Paid plan is active
echo "⚠️  This requires the Workers Paid plan ($5/month)"
echo "   Containers are not available on the free plan"
echo ""
echo "Press Enter to continue or Ctrl+C to cancel..."
read

# Deploy with Container configuration
echo "📦 Building and deploying Container..."
npx wrangler deploy --config wrangler-container.jsonc

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Next steps:"
echo "1. Test the API: https://remote-mcp-server.nick-simo.workers.dev/health"
echo "2. Check Container status in dashboard: https://dash.cloudflare.com"
echo "3. View logs: npx wrangler tail"