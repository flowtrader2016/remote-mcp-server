#!/bin/bash

# Optimal Cloudflare Access Health Endpoint Bypass
# Creates a separate Access application for /health path with bypass policy

# Configuration
CF_ACCOUNT_ID="f24c54db3f8e3fdf0c96ca87f66e93a8"
MAIN_APP_ID="c9be7322-1456-47a8-9830-1956d55f052f"

# Check if CF_API_TOKEN is set
if [ -z "$CF_API_TOKEN" ]; then
    echo "Error: CF_API_TOKEN environment variable is not set"
    echo "Please set it by running: export CF_API_TOKEN=your_token_here"
    exit 1
fi

echo "=== Getting main application details ==="

# Get main application details to extract domain
MAIN_APP=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps/${MAIN_APP_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json")

if ! echo "$MAIN_APP" | jq -e '.success' > /dev/null; then
    echo "❌ Failed to get main application details"
    echo "$MAIN_APP" | jq '.errors'
    exit 1
fi

APP_DOMAIN=$(echo "$MAIN_APP" | jq -r '.result.domain')
APP_TYPE=$(echo "$MAIN_APP" | jq -r '.result.type // "self_hosted"')

echo "📋 Main application domain: $APP_DOMAIN"
echo "📋 Application type: $APP_TYPE"

echo ""
echo "=== Creating dedicated /health Access application ==="

# Create a dedicated Access application for /health path
HEALTH_APP=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Health Endpoint - Bypass",
    "domain": "'${APP_DOMAIN}'",
    "path": "/health",
    "type": "'${APP_TYPE}'",
    "session_duration": "24h",
    "auto_redirect_to_identity": false
  }')

echo "Health application creation result:"
echo "$HEALTH_APP" | jq .

if ! echo "$HEALTH_APP" | jq -e '.success' > /dev/null; then
    echo "❌ Failed to create health endpoint application"
    echo "$HEALTH_APP" | jq '.errors'
    exit 1
fi

HEALTH_APP_ID=$(echo "$HEALTH_APP" | jq -r '.result.id')
echo "✅ Created health application with ID: $HEALTH_APP_ID"

echo ""
echo "=== Creating bypass policy for /health application ==="

# Create bypass policy for the health application
BYPASS_POLICY=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps/${HEALTH_APP_ID}/policies" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "decision": "bypass",
    "name": "Health endpoint bypass - no authentication required",
    "include": [
      {
        "everyone": {}
      }
    ],
    "exclude": [],
    "require": [],
    "precedence": 1
  }')

echo "Bypass policy creation result:"
echo "$BYPASS_POLICY" | jq .

if ! echo "$BYPASS_POLICY" | jq -e '.success' > /dev/null; then
    echo "❌ Failed to create bypass policy"
    echo "$BYPASS_POLICY" | jq '.errors'
    exit 1
fi

POLICY_ID=$(echo "$BYPASS_POLICY" | jq -r '.result.id')
echo "✅ Created bypass policy with ID: $POLICY_ID"

echo ""
echo "=== Verification ==="

# List all applications for this domain to show the setup
echo "All Access applications for domain $APP_DOMAIN:"
ALL_APPS=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json")

echo "$ALL_APPS" | jq --arg domain "$APP_DOMAIN" '.result[] | select(.domain == $domain) | {id: .id, name: .name, domain: .domain, path: .path}'

echo ""
echo "=== Summary ==="
echo "✅ Successfully configured health endpoint bypass!"
echo ""
echo "📋 Configuration details:"
echo "   • Main app ID: $MAIN_APP_ID (requires authentication)"
echo "   • Health app ID: $HEALTH_APP_ID (bypasses authentication)"
echo "   • Health policy ID: $POLICY_ID"
echo "   • Domain: $APP_DOMAIN"
echo ""
echo "🔒 Access behavior:"
echo "   • https://$APP_DOMAIN/health → No authentication required (bypassed)"
echo "   • https://$APP_DOMAIN/* → Authentication required"
echo ""
echo "🧪 Test commands:"
echo "   curl -I https://$APP_DOMAIN/health  # Should return 200 without redirect"
echo "   curl -I https://$APP_DOMAIN/        # Should return 302 redirect to auth"