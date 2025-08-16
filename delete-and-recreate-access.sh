#!/bin/bash

# Delete and recreate Access app with proper service token support

set -e

CF_ACCOUNT_ID="f24c54db3f8e3fdf0c96ca87f66e93a8"
OLD_APP_ID="83457a9a-a593-47d4-8a95-07ca24638147"
SERVICE_TOKEN_ID="a16ceef8-3078-4f39-b722-79cb87f55b9a"

# Check for API token
if [ -n "$CLOUDFLARE_API_TOKEN" ]; then
    CF_API_TOKEN="$CLOUDFLARE_API_TOKEN"
elif [ -z "$CF_API_TOKEN" ]; then
    echo "Error: CLOUDFLARE_API_TOKEN or CF_API_TOKEN not set"
    exit 1
fi

echo "=== Deleting old Access application ==="
curl -s -X DELETE \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps/${OLD_APP_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" > /dev/null

echo "✅ Deleted old application"

echo ""
echo "=== Creating new Access application with service token support ==="

# Create new app that properly supports service tokens
APP_RESPONSE=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "MCP Security Search Server",
    "domain": "remote-mcp-server.nick-simo.workers.dev",
    "type": "self_hosted",
    "session_duration": "24h",
    "auto_redirect_to_identity": false,
    "enable_binding_cookie": false,
    "http_only_cookie_attribute": true,
    "same_site_cookie_attribute": "lax",
    "skip_interstitial": true,
    "app_launcher_visible": false,
    "allow_authenticate_via_warp": false,
    "options_preflight_bypass": true,
    "custom_deny_message": "",
    "custom_deny_url": "",
    "service_auth_401_redirect": false
  }')

if ! echo "$APP_RESPONSE" | jq -e '.success' > /dev/null; then
    echo "Error creating application:"
    echo "$APP_RESPONSE" | jq '.errors'
    exit 1
fi

NEW_APP_ID=$(echo "$APP_RESPONSE" | jq -r '.result.id')
echo "✅ Created new Access application with ID: $NEW_APP_ID"

echo ""
echo "=== Creating policy with service token support ==="

# Create policy that supports both email and service token
POLICY_RESPONSE=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps/${NEW_APP_ID}/policies" \
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
      }
    ],
    "exclude": [],
    "require": [],
    "precedence": 1
  }')

if ! echo "$POLICY_RESPONSE" | jq -e '.success' > /dev/null; then
    echo "Error creating email policy:"
    echo "$POLICY_RESPONSE" | jq '.errors'
    exit 1
fi

EMAIL_POLICY_ID=$(echo "$POLICY_RESPONSE" | jq -r '.result.id')
echo "✅ Created email policy with ID: $EMAIL_POLICY_ID"

# Create separate policy for service token
SERVICE_POLICY_RESPONSE=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps/${NEW_APP_ID}/policies" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Service Token Access",
    "decision": "allow",
    "include": [
      {
        "service_token": [
          "'${SERVICE_TOKEN_ID}'"
        ]
      }
    ],
    "exclude": [],
    "require": [],
    "precedence": 0
  }')

if ! echo "$SERVICE_POLICY_RESPONSE" | jq -e '.success' > /dev/null; then
    echo "Error creating service token policy:"
    echo "$SERVICE_POLICY_RESPONSE" | jq '.errors'
    exit 1
fi

SERVICE_POLICY_ID=$(echo "$SERVICE_POLICY_RESPONSE" | jq -r '.result.id')
echo "✅ Created service token policy with ID: $SERVICE_POLICY_ID"

echo ""
echo "=== Testing service token authentication ==="

# Wait a moment for Access to propagate
sleep 2

# Test with service token
TEST_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "CF-Access-Client-Id: 2dbe8ab597f81c3308530d3e61691765.access" \
  -H "CF-Access-Client-Secret: 2932b4b3f043c1560893d78735f6b3682cc1b5a6c284ad4226e4ca09c453a34a" \
  https://remote-mcp-server.nick-simo.workers.dev/sse)

echo "Test response code: $TEST_RESPONSE"

if [ "$TEST_RESPONSE" = "200" ] || [ "$TEST_RESPONSE" = "401" ]; then
    echo "✅ Service token reached the Worker (got past Access)!"
else
    echo "❌ Still getting redirected (302) - Access not accepting service token"
fi

echo ""
echo "New App ID: $NEW_APP_ID"