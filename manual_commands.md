# Manual Cloudflare Access Health Endpoint Bypass Commands

## Prerequisites

Set your API token:
```bash
export CF_API_TOKEN="your_api_token_here"
```

## Configuration Variables
```bash
CF_ACCOUNT_ID="f24c54db3f8e3fdf0c96ca87f66e93a8"
MAIN_APP_ID="c9be7322-1456-47a8-9830-1956d55f052f"
```

## Step 1: Get Main Application Details

```bash
curl -X GET \
  "https://api.cloudflare.com/client/v4/accounts/f24c54db3f8e3fdf0c96ca87f66e93a8/access/apps/c9be7322-1456-47a8-9830-1956d55f052f" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" | jq .
```

## Step 2: Create Health Endpoint Access Application

Replace `YOUR_DOMAIN` with the actual domain from step 1:

```bash
curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/f24c54db3f8e3fdf0c96ca87f66e93a8/access/apps" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Health Endpoint - Bypass",
    "domain": "YOUR_DOMAIN",
    "path": "/health",
    "type": "self_hosted",
    "session_duration": "24h",
    "auto_redirect_to_identity": false
  }'
```

## Step 3: Create Bypass Policy

Replace `HEALTH_APP_ID` with the ID from step 2:

```bash
curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/f24c54db3f8e3fdf0c96ca87f66e93a8/access/apps/HEALTH_APP_ID/policies" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
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
  }'
```

## Verification Commands

List all applications:
```bash
curl -X GET \
  "https://api.cloudflare.com/client/v4/accounts/f24c54db3f8e3fdf0c96ca87f66e93a8/access/apps" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" | jq '.result[] | {id: .id, name: .name, domain: .domain, path: .path}'
```

Test health endpoint (should not require auth):
```bash
curl -I https://YOUR_DOMAIN/health
```

Test main application (should redirect to auth):
```bash
curl -I https://YOUR_DOMAIN/
```

## Alternative: Simple Bypass Policy (Not Path-Specific)

If you prefer to add a bypass policy to the existing application (this will affect the entire domain):

```bash
curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/f24c54db3f8e3fdf0c96ca87f66e93a8/access/apps/c9be7322-1456-47a8-9830-1956d55f052f/policies" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "decision": "bypass",
    "name": "Bypass policy",
    "include": [
      {
        "everyone": {}
      }
    ],
    "exclude": [],
    "require": [],
    "precedence": 1
  }'
```

**Note**: The alternative approach above will bypass authentication for the entire application, not just the `/health` path.