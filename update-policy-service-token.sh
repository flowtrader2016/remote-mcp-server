#!/bin/bash

# Update Access policy to accept service tokens

set -e

CF_ACCOUNT_ID="f24c54db3f8e3fdf0c96ca87f66e93a8"
APP_ID="83457a9a-a593-47d4-8a95-07ca24638147"
POLICY_ID="6b7e7b7a-34a6-4c9c-9ddc-65143555f2b1"
SERVICE_TOKEN_ID="a16ceef8-3078-4f39-b722-79cb87f55b9a"

# Check for API token
if [ -n "$CLOUDFLARE_API_TOKEN" ]; then
    CF_API_TOKEN="$CLOUDFLARE_API_TOKEN"
elif [ -z "$CF_API_TOKEN" ]; then
    echo "Error: CLOUDFLARE_API_TOKEN or CF_API_TOKEN not set"
    exit 1
fi

echo "=== Updating Access Policy to Accept Service Token ==="

# Update the existing policy to include service token
POLICY_UPDATE=$(curl -s -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps/${APP_ID}/policies/${POLICY_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Email and Service Token Access",
    "decision": "allow",
    "include": [
      {
        "email": {
          "email": "nick.simo@gmail.com"
        }
      },
      {
        "service_token": {
          "token_id": "'"${SERVICE_TOKEN_ID}"'"
        }
      }
    ],
    "exclude": [],
    "require": [],
    "precedence": 1
  }')

if ! echo "$POLICY_UPDATE" | jq -e '.success' > /dev/null; then
    echo "Error updating policy:"
    echo "$POLICY_UPDATE" | jq '.errors'
    exit 1
fi

echo "✅ Updated Access policy to accept both email and service token"
echo ""
echo "Testing service token authentication..."

# Test the service token
TEST_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "CF-Access-Client-Id: 2dbe8ab597f81c3308530d3e61691765.access" \
  -H "CF-Access-Client-Secret: 2932b4b3f043c1560893d78735f6b3682cc1b5a6c284ad4226e4ca09c453a34a" \
  https://remote-mcp-server.nick-simo.workers.dev/sse)

if [ "$TEST_RESPONSE" = "200" ]; then
    echo "✅ Service token authentication works!"
else
    echo "❌ Service token test failed with HTTP $TEST_RESPONSE"
fi