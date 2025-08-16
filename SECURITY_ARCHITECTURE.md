# Security Architecture Documentation
## MCP Security Search Server - Complete Security Implementation

### Table of Contents
1. [Overview](#overview)
2. [Authentication Architecture](#authentication-architecture)
3. [Service Token Implementation](#service-token-implementation)
4. [Worker Security Layer](#worker-security-layer)
5. [Data Protection](#data-protection)
6. [Network Security](#network-security)
7. [Implementation Details](#implementation-details)
8. [Recreation Guide](#recreation-guide)
9. [Security Checklist](#security-checklist)

---

## Overview

### System Architecture
```
Claude Desktop → MCP-Remote Client → Cloudflare Worker → Container → R2 Storage
                     ↓                      ↓              ↓
              Service Token Auth    Token Validation   4GB Memory
```

### Key Security Components
- **Authentication**: Service Token (API Key/Secret pair)
- **Authorization**: Hardcoded token validation in Worker
- **Data Storage**: Private R2 bucket (not public)
- **Compute**: Cloudflare Workers with Containers
- **Transport**: HTTPS with token headers

---

## Authentication Architecture

### Service Token Details
```
Client ID: 2dbe8ab597f81c3308530d3e61691765.access
Client Secret: 2932b4b3f043c1560893d78735f6b3682cc1b5a6c284ad4226e4ca09c453a34a
Token ID: a16ceef8-3078-4f39-b722-79cb87f55b9a
Duration: 8760 hours (1 year)
Created: 2025-08-16
```

### Authentication Flow
1. **Claude Desktop** starts MCP-Remote with environment config
2. **MCP-Remote** adds headers to all requests:
   - `CF-Access-Client-Id: <CLIENT_ID>`
   - `CF-Access-Client-Secret: <CLIENT_SECRET>`
3. **Cloudflare Worker** receives request at `/sse` endpoint
4. **Worker validates** tokens directly (no Cloudflare Access layer)
5. **If valid**: Proceeds to container
6. **If invalid**: Returns 401 Unauthorized

---

## Service Token Implementation

### 1. Service Token Creation
**File**: `create-service-token.sh`
```bash
#!/bin/bash
CF_ACCOUNT_ID="f24c54db3f8e3fdf0c96ca87f66e93a8"

# Create service token via API
curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/service_tokens" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "MCP Server Claude Desktop",
    "duration": "8760h"
  }'
```

### 2. Claude Desktop Configuration
**File**: `~/Library/Application Support/Claude/claude_desktop_config.json`
```json
{
  "mcpServers": {
    "security-search-remote": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://remote-mcp-server.nick-simo.workers.dev/sse",
        "--header",
        "CF-Access-Client-Id: 2dbe8ab597f81c3308530d3e61691765.access",
        "--header", 
        "CF-Access-Client-Secret: 2932b4b3f043c1560893d78735f6b3682cc1b5a6c284ad4226e4ca09c453a34a"
      ]
    }
  }
}
```

### 3. MCP-Remote Header Injection
- Uses `--header` flag to add authentication headers
- Headers sent with every request to the Worker
- No browser-based auth needed

---

## Worker Security Layer

### Token Validation Implementation
**File**: `src/container-mcp-bridge.ts` (Lines 8-23)
```typescript
export async function handleSSEEndpoint(request: Request, env: Env, container: any): Promise<Response> {
  // Verify authentication
  // Check if service token headers are present
  const clientId = request.headers.get('CF-Access-Client-Id');
  const clientSecret = request.headers.get('CF-Access-Client-Secret');
  
  if (clientId === '2dbe8ab597f81c3308530d3e61691765.access' && 
      clientSecret === '2932b4b3f043c1560893d78735f6b3682cc1b5a6c284ad4226e4ca09c453a34a') {
    // Valid service token - allow access
    console.log('Authenticated via service token');
  } else {
    // Check for JWT from browser auth (fallback)
    const user = await verifyAccessJWT(request, env);
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }
  }
  
  // Continue with SSE stream setup...
}
```

### Endpoint Security Matrix
| Endpoint | Authentication | Public Access | Response |
|----------|---------------|---------------|----------|
| `/sse` | Service Token Required | ❌ No | 401 if no token |
| `/health` | None | ✅ Yes | `{"status":"ok"}` |
| `/` | JWT Check | ✅ Yes | Shows auth status |
| `/api/*` | JWT Required | ❌ No | 401 if no JWT |

---

## Data Protection

### R2 Bucket Configuration
```json
{
  "binding": "SEARCH_DATA",
  "bucket_name": "security-article-search-data",
  "public_url": "https://pub-7e17005f86444e028bc6c091baa4e227.r2.dev"
}
```

### R2 Security Settings
- **Public Access**: Disabled (401 on direct access)
- **Access Method**: Only via Worker R2 binding
- **CORS**: Not configured (not needed)
- **Data**: `search_metadata.json` (large security articles dataset)

### Data Flow Security
1. **Worker** has R2 binding (`env.SEARCH_DATA`)
2. **Worker** fetches data from R2 on container startup
3. **Container** receives data via internal POST to `/load-data`
4. **Container** caches in memory and disk (`/app/cache/`)
5. **No direct R2 access** from internet

**Implementation in** `src/container-mcp-bridge.ts` (Lines 52-66):
```typescript
// Load data from R2 through Worker binding
const r2Object = await env.SEARCH_DATA.get("search_metadata.json");
if (r2Object) {
  const loadResponse = await container.fetch(new Request("http://container/load-data", {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      "Content-Length": r2Object.size?.toString() || "0"
    },
    body: r2Object.body
  }));
}
```

---

## Network Security

### Cloudflare Services Used
1. **Cloudflare Workers** (Paid $5/month plan)
   - Runs authentication logic
   - Proxies to containers
   - Handles R2 access

2. **Cloudflare Containers** (Durable Objects)
   - 4GB memory instances
   - Isolated execution
   - Auto-scaling (max 5 instances)

3. **Cloudflare R2 Storage**
   - Object storage for data
   - Private by default
   - Accessed only via Worker bindings

### Container Configuration
**File**: `wrangler-container.jsonc`
```json
{
  "name": "remote-mcp-server",
  "main": "src/container-index.ts",
  "compatibility_date": "2024-01-01",
  
  "containers": [
    {
      "class_name": "MCPContainer",
      "image": "./Dockerfile",
      "instance_type": "standard",  // 4GB memory
      "max_instances": 5
    }
  ],
  
  "durable_objects": {
    "bindings": [
      {
        "name": "MCP_CONTAINER",
        "class_name": "MCPContainer"
      }
    ]
  },
  
  "r2_buckets": [
    {
      "binding": "SEARCH_DATA",
      "bucket_name": "security-article-search-data"
    }
  ]
}
```

### Container Dockerfile
**File**: `Dockerfile`
```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY src ./src
RUN mkdir -p /app/cache
EXPOSE 3000
CMD ["node", "src/container-server.js"]
```

---

## Implementation Details

### Key Files and Their Roles

#### 1. Worker Entry Point
**File**: `src/container-index.ts`
- Main Worker handler
- Routes requests to appropriate handlers
- Manages Durable Object instances

#### 2. SSE Bridge with Auth
**File**: `src/container-mcp-bridge.ts`
- Handles MCP protocol over SSE
- **Contains authentication logic** (Lines 8-23)
- Bridges SSE to container HTTP calls
- Loads R2 data into container

#### 3. Container Server
**File**: `src/container-server.js`
- Express.js server in container
- Processes search queries
- Manages data caching
- Endpoints:
  - `/health` - Health check
  - `/load-data` - Receive data from Worker
  - `/show_searchable_fields` - MCP tool
  - `/get_field_values/:field` - MCP tool
  - `/query_articles` - MCP tool
  - `/get_article_details/:id` - MCP tool

#### 4. JWT Verification (Backup Auth)
**File**: `src/access-auth.ts`
- Verifies Cloudflare Access JWTs
- Used for browser-based access
- Fallback if service token fails

### Environment Variables
```bash
# In ~/.zshrc
export CLOUDFLARE_API_TOKEN="gpun92xiIenVcoTmcpRVn-8iZ95tzmRP3KfeJWXq"
export CLOUDFLARE_ACCOUNT_ID="f24c54db3f8e3fdf0c96ca87f66e93a8"
```

### API Token Permissions Required
- Account: Zero Trust:Edit
- Account: Access: Service Tokens:Edit
- Account: Workers Scripts:Edit
- Account: Workers R2 Storage:Edit
- Account: Containers:Edit

---

## Recreation Guide

### Step 1: Create Service Token
```bash
source ~/.zshrc
./create-service-token.sh
# Save the Client ID and Secret!
```

### Step 2: Update Worker Auth
Edit `src/container-mcp-bridge.ts` lines 13-14:
```typescript
if (clientId === 'YOUR_CLIENT_ID' && 
    clientSecret === 'YOUR_CLIENT_SECRET') {
```

### Step 3: Deploy Container-Enabled Worker
```bash
# Build and push Docker image
docker build -t remote-mcp-server-mcpcontainer .

# Deploy with container config
npx wrangler deploy --config wrangler-container.jsonc
```

### Step 4: Configure Claude Desktop
Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
"security-search-remote": {
  "command": "npx",
  "args": [
    "mcp-remote",
    "https://remote-mcp-server.nick-simo.workers.dev/sse",
    "--header",
    "CF-Access-Client-Id: YOUR_CLIENT_ID",
    "--header", 
    "CF-Access-Client-Secret: YOUR_CLIENT_SECRET"
  ]
}
```

### Step 5: Upload Data to R2
```bash
# Create bucket if needed
wrangler r2 bucket create security-article-search-data

# Upload data
wrangler r2 object put security-article-search-data/search_metadata.json \
  --file ./data/search_metadata.json
```

---

## Security Checklist

### ✅ Authentication
- [x] Service token created with 1-year expiration
- [x] Token validation hardcoded in Worker
- [x] Headers required for all `/sse` requests
- [x] 401 returned for unauthorized requests

### ✅ Data Protection
- [x] R2 bucket not publicly accessible
- [x] Data only accessible via Worker binding
- [x] Container caches data in memory/disk
- [x] No direct internet access to data

### ✅ Network Security
- [x] All traffic over HTTPS
- [x] Worker validates before container access
- [x] Container isolated in Durable Object
- [x] No CORS headers (not needed)

### ✅ Access Control
- [x] Service token required for MCP access
- [x] JWT fallback for browser access
- [x] Health endpoint public (no sensitive data)
- [x] Root page shows auth status only

### ⚠️ Security Considerations
1. **Token Storage**: Service token is hardcoded in Worker
   - Pro: Simple and secure
   - Con: Requires redeploy to rotate

2. **Token Rotation**: Manual process
   - Create new token
   - Update Worker code
   - Update Claude config
   - Delete old token

3. **Monitoring**: Check Worker logs for auth failures
   ```bash
   wrangler tail --format pretty
   ```

---

## Testing Security

### Test Unauthorized Access
```bash
# Should return 401
curl -I https://remote-mcp-server.nick-simo.workers.dev/sse

# Should return 401
curl https://pub-7e17005f86444e028bc6c091baa4e227.r2.dev/search_metadata.json
```

### Test Authorized Access
```bash
# Should return 200 with SSE stream
curl -H "CF-Access-Client-Id: 2dbe8ab597f81c3308530d3e61691765.access" \
     -H "CF-Access-Client-Secret: 2932b4b3f043c1560893d78735f6b3682cc1b5a6c284ad4226e4ca09c453a34a" \
     https://remote-mcp-server.nick-simo.workers.dev/sse
```

### Test Claude Desktop
1. Kill existing MCP processes:
   ```bash
   ps aux | grep mcp-remote | awk '{print $2}' | xargs kill
   ```
2. Check logs:
   ```bash
   tail -f ~/Library/Logs/Claude/mcp-server-security-search-remote.log
   ```
3. Look for: `Server started and connected successfully`

---

## Troubleshooting

### Common Issues and Solutions

1. **"Container is not enabled"**
   - Deploy with `wrangler-container.jsonc` not `wrangler.jsonc`
   - Ensure Cloudflare Workers paid plan ($5/month)

2. **"Unauthorized" response**
   - Check service token in Claude config matches Worker
   - Verify headers are being sent by mcp-remote
   - Check Worker logs: `wrangler tail`

3. **"Failed to load data"**
   - Check R2 bucket name matches config
   - Verify R2 binding in wrangler config
   - Check container logs in Worker tail

4. **MCP tools not appearing in Claude**
   - Restart Claude Desktop
   - Check MCP log for connection errors
   - Verify all 4 tools are registered

---

## Cost Summary
- **Workers**: $5/month (paid plan required for containers)
- **Containers**: Included in Workers paid plan
- **R2 Storage**: Free tier (10GB storage, 1M requests)
- **Service Tokens**: Free (part of Zero Trust free tier)
- **Total**: $5/month

---

## Contact and Support
- **Cloudflare Account ID**: f24c54db3f8e3fdf0c96ca87f66e93a8
- **Worker Name**: remote-mcp-server
- **R2 Bucket**: security-article-search-data
- **Container Class**: MCPContainer

Last Updated: 2025-08-16
Security Review: Complete ✅