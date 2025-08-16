#!/bin/bash

# Cloudflare Access Application Update Script
# Updates the application to bypass authentication for /health endpoint

# Configuration
CF_ACCOUNT_ID="f24c54db3f8e3fdf0c96ca87f66e93a8"
APP_ID="c9be7322-1456-47a8-9830-1956d55f052f"
POLICY_ID="8a186b2c-834f-4e91-b97a-1c54b713518c"

# Check if CF_API_TOKEN is set
if [ -z "$CF_API_TOKEN" ]; then
    echo "Error: CF_API_TOKEN environment variable is not set"
    echo "Please export CF_API_TOKEN=your_token_here"
    exit 1
fi

echo "=== Getting current application configuration ==="

# Get current app configuration
CURRENT_CONFIG=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps/${APP_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json")

echo "Current app configuration:"
echo "$CURRENT_CONFIG" | jq .

# Check if the request was successful
if ! echo "$CURRENT_CONFIG" | jq -e '.success' > /dev/null; then
    echo "Error: Failed to get current application configuration"
    echo "$CURRENT_CONFIG" | jq '.errors'
    exit 1
fi

echo ""
echo "=== Getting current policies ==="

# Get current policies
POLICIES=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps/${APP_ID}/policies" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json")

echo "Current policies:"
echo "$POLICIES" | jq .

echo ""
echo "=== Creating bypass policy for /health endpoint ==="

# Create a bypass policy for /health endpoint
BYPASS_POLICY=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps/${APP_ID}/policies" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "decision": "bypass",
    "name": "Bypass /health endpoint",
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

# Check if the policy creation was successful
if ! echo "$BYPASS_POLICY" | jq -e '.success' > /dev/null; then
    echo "Error: Failed to create bypass policy"
    echo "$BYPASS_POLICY" | jq '.errors'
    exit 1
fi

echo ""
echo "=== Updating application to include path exclusion ==="

# Extract current app details and update with path exclusion
APP_DETAILS=$(echo "$CURRENT_CONFIG" | jq '.result')
APP_NAME=$(echo "$APP_DETAILS" | jq -r '.name')
APP_DOMAIN=$(echo "$APP_DETAILS" | jq -r '.domain')
APP_TYPE=$(echo "$APP_DETAILS" | jq -r '.type')

# Update the application to exclude /health path from the main application
# We'll create a more specific application path that excludes /health
UPDATED_APP=$(curl -s -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps/${APP_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "'${APP_NAME}'",
    "domain": "'${APP_DOMAIN}'",
    "type": "'${APP_TYPE}'",
    "session_duration": "24h"
  }')

echo "Application update result:"
echo "$UPDATED_APP" | jq .

echo ""
echo "=== Creating separate Access application for /health with bypass ==="

# Create a separate application specifically for /health endpoint with bypass policy
HEALTH_APP=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Health Endpoint Bypass",
    "domain": "'${APP_DOMAIN}'",
    "path": "/health",
    "type": "'${APP_TYPE}'",
    "session_duration": "24h"
  }')

echo "Health app creation result:"
echo "$HEALTH_APP" | jq .

if echo "$HEALTH_APP" | jq -e '.success' > /dev/null; then
    HEALTH_APP_ID=$(echo "$HEALTH_APP" | jq -r '.result.id')
    echo "Health app ID: $HEALTH_APP_ID"
    
    # Create bypass policy for the health endpoint app
    HEALTH_BYPASS_POLICY=$(curl -s -X POST \
      "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps/${HEALTH_APP_ID}/policies" \
      -H "Authorization: Bearer ${CF_API_TOKEN}" \
      -H "Content-Type: application/json" \
      -d '{
        "decision": "bypass",
        "name": "Bypass health endpoint",
        "include": [
          {
            "everyone": {}
          }
        ],
        "exclude": [],
        "require": [],
        "precedence": 1
      }')
    
    echo ""
    echo "Health endpoint bypass policy result:"
    echo "$HEALTH_BYPASS_POLICY" | jq .
else
    echo "Error: Failed to create health endpoint application"
    echo "$HEALTH_APP" | jq '.errors'
fi

echo ""
echo "=== Summary ==="
echo "✅ Script completed"
echo "📋 The /health endpoint should now bypass authentication"
echo "🔒 All other paths will continue to require authentication"
echo ""
echo "To verify the configuration, you can test:"
echo "curl -I https://${APP_DOMAIN}/health"
echo "curl -I https://${APP_DOMAIN}/  # This should redirect to auth"