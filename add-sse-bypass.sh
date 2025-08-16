#!/bin/bash

# Add bypass policy for /sse endpoint to allow MCP connections

set -e

CF_ACCOUNT_ID="f24c54db3f8e3fdf0c96ca87f66e93a8"
APP_ID="83457a9a-a593-47d4-8a95-07ca24638147"

# Check for API token
if [ -n "$CLOUDFLARE_API_TOKEN" ]; then
    CF_API_TOKEN="$CLOUDFLARE_API_TOKEN"
elif [ -z "$CF_API_TOKEN" ]; then
    echo "Error: CLOUDFLARE_API_TOKEN or CF_API_TOKEN not set"
    exit 1
fi

echo "=== Creating bypass policy for /sse endpoint ==="

# Create bypass policy with higher precedence
BYPASS_RESPONSE=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps/${APP_ID}/policies" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "SSE Endpoint Bypass",
    "decision": "bypass",
    "include": [
      {
        "everyone": {}
      }
    ],
    "exclude": [],
    "require": [],
    "precedence": 0
  }')

if ! echo "$BYPASS_RESPONSE" | jq -e '.success' > /dev/null; then
    echo "Error creating bypass policy:"
    echo "$BYPASS_RESPONSE" | jq '.errors'
    exit 1
fi

BYPASS_ID=$(echo "$BYPASS_RESPONSE" | jq -r '.result.id')
echo "✅ Created bypass policy with ID: $BYPASS_ID"

echo ""
echo "=== Configuration Complete ==="
echo "✅ /sse endpoint: No authentication (for Claude Desktop)"
echo "✅ All other paths: Email + PIN authentication required"
echo ""
echo "Test with: curl https://remote-mcp-server.nick-simo.workers.dev/sse"