#!/bin/bash

# Simple Cloudflare Access Bypass Update
# Adds a bypass policy for /health endpoint to existing application

# Configuration
CF_ACCOUNT_ID="f24c54db3f8e3fdf0c96ca87f66e93a8"
APP_ID="c9be7322-1456-47a8-9830-1956d55f052f"

# Check if CF_API_TOKEN is set
if [ -z "$CF_API_TOKEN" ]; then
    echo "Error: CF_API_TOKEN environment variable is not set"
    echo "Please set it by running: export CF_API_TOKEN=your_token_here"
    exit 1
fi

echo "=== Adding bypass policy for /health endpoint ==="

# Create a bypass policy for /health endpoint with path matching
BYPASS_POLICY=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps/${APP_ID}/policies" \
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

echo "Bypass policy creation result:"
echo "$BYPASS_POLICY" | jq .

# Check if the policy creation was successful
if echo "$BYPASS_POLICY" | jq -e '.success' > /dev/null; then
    echo ""
    echo "✅ Successfully created bypass policy!"
    echo "📋 Policy ID: $(echo "$BYPASS_POLICY" | jq -r '.result.id')"
    echo ""
    echo "Note: This creates a bypass policy for the entire application."
    echo "If you need path-specific bypassing, you'll need to create a separate"
    echo "Access application specifically for the /health path."
else
    echo ""
    echo "❌ Failed to create bypass policy"
    echo "Error details:"
    echo "$BYPASS_POLICY" | jq '.errors'
    exit 1
fi

echo ""
echo "=== Getting all current policies to verify ==="

# Get current policies to verify the new policy was added
POLICIES=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps/${APP_ID}/policies" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json")

echo "All current policies:"
echo "$POLICIES" | jq '.result[] | {id: .id, name: .name, decision: .decision, precedence: .precedence}'

echo ""
echo "=== Summary ==="
echo "✅ Bypass policy has been added to the Access application"
echo "⚠️  Note: This bypass applies to the entire application domain."
echo "   For path-specific bypassing (/health only), you need to:"
echo "   1. Create a separate Access application for the /health path"
echo "   2. Apply the bypass policy to that specific application"
echo ""
echo "To create a path-specific application, run the full script:"
echo "./update_access_app.sh"