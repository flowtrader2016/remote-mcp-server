# Migrating MCP Server to Cloudflare Containers

## Why Containers?

### Current Problems with Workers:
- **128MB memory limit** - Can't load 57MB JSON
- **No way to increase** - Hard limit

### Containers Solution:
- **Up to 4GB memory** (standard instance)
- **Full filesystem** support
- **Any runtime** (Python, Node, etc.)
- **Only pay when running** ($5/month Workers Paid includes generous free tier)

## Instance Types Available:

| Type | Memory | vCPU | Disk | Use Case |
|------|--------|------|------|----------|
| dev | 256 MiB | 1/16 | 2 GB | Testing |
| basic | 1 GiB | 1/4 | 4 GB | Light workloads |
| **standard** | **4 GiB** | **1/2** | **4 GB** | **Perfect for your 57MB JSON** |

## Migration Steps

### 1. Create Dockerfile for MCP Server

```dockerfile
# Dockerfile
FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --production

# Copy source and data
COPY src ./src
COPY search_metadata.json ./

# MCP server runs on port 3000
EXPOSE 3000

CMD ["node", "src/container-server.js"]
```

### 2. Create Container Server

```javascript
// src/container-server.js
import express from 'express';
import { SecuritySearchEngine } from './security-search.js';
import fs from 'fs';

const app = express();
const PORT = 3000;

// Load the full JSON in memory - we have 4GB!
const metadata = JSON.parse(fs.readFileSync('./search_metadata.json', 'utf8'));
const searchEngine = new SecuritySearchEngine(metadata);

app.use(express.json());

// MCP endpoints
app.post('/search', async (req, res) => {
  const results = await searchEngine.searchArticles(req.body);
  res.json(results);
});

app.get('/fields', async (req, res) => {
  const fields = await searchEngine.getSearchableFields();
  res.json(fields);
});

app.listen(PORT, () => {
  console.log(`MCP Container running on port ${PORT}`);
});
```

### 3. Update Worker to Call Container

```javascript
// src/index.ts
import { Container, getContainer } from "@cloudflare/containers";

export class MCPContainer extends Container {
  defaultPort = 3000;
  sleepAfter = "10m"; // Stop if idle for 10 minutes
  instanceType = "standard"; // 4GB memory
}

export default {
  async fetch(request, env, ctx) {
    // Verify Access JWT
    const user = await verifyAccessJWT(request, env);
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Get container instance (one per user for isolation)
    const container = getContainer(env.MCP_CONTAINER, user.sub);
    
    // Forward request to container
    return container.fetch(request);
  }
};
```

### 4. Update wrangler.toml

```toml
name = "remote-mcp-server"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[containers]]
class_name = "MCPContainer"
image = "./Dockerfile"
instance_type = "standard"  # 4GB memory
max_instances = 10

[[durable_objects.bindings]]
name = "MCP_CONTAINER"
class_name = "MCPContainer"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["MCPContainer"]
```

### 5. Deploy

```bash
# Build and deploy
wrangler deploy

# Container will:
# 1. Build Docker image locally
# 2. Push to Cloudflare Registry
# 3. Deploy globally
```

## Cost Analysis

### Workers Paid Plan ($5/month includes):
- **375 vCPU-minutes/month** free
- **25 GiB-hours/month** memory free
- **200 GB-hours/month** disk free

### Your Usage (estimate):
- Container runs when called, sleeps after 10m idle
- Assuming 100 requests/day, 30s per request:
  - **50 minutes/month** CPU usage
  - **3.3 GiB-hours/month** memory (4GB × 50min)
  - **All within free tier!**

### Comparison:
- **AWS Lambda with containers**: Would cost ~$10-20/month
- **Cloudflare Containers**: $5/month (likely all in free tier)

## Benefits

1. **No memory limits** - Load entire 57MB JSON
2. **Better performance** - No parsing on each request
3. **Python support** - Could run original Python code
4. **Auto-scaling** - Cloudflare handles it
5. **Global deployment** - Runs at edge locations
6. **Pay per use** - Only charged when running

## Next Steps

1. Enable Workers Paid plan ($5/month)
2. Create the Dockerfile
3. Convert MCP server to Express/HTTP
4. Deploy with `wrangler deploy`
5. Test with full dataset

Want me to start the migration?