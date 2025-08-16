# Deployment Checklist for Security Article Search MCP

## Prerequisites
- [ ] Node.js 18+ installed
- [ ] Cloudflare account with **R2 enabled** (IMPORTANT!)
- [ ] Wrangler CLI installed (`npm install -g wrangler`)
- [ ] Original `search_metadata.json` file from Python MCP

## Step-by-Step Deployment

### 1. Initial Setup
```bash
# Clone and install
cd /Users/nicksimpson/Desktop/cloudflare/remote-mcp-server
npm install

# Login to Cloudflare with R2 permissions
npx wrangler login
# When browser opens, ensure you grant R2 permissions!
```

### 2. Create Resources
```bash
# Create KV namespace for OAuth
npx wrangler kv namespace create OAUTH_KV

# Create R2 bucket (may fail if no R2 permissions)
npx wrangler r2 bucket create security-article-search-data
```

**⚠️ IMPORTANT**: If R2 bucket creation fails with "Please enable R2", you need to:
1. Go to Cloudflare Dashboard
2. Enable R2 in your account
3. Re-login with `npx wrangler login`

### 3. Update Configuration
After creating KV namespace, update `wrangler.jsonc`:
```json
"kv_namespaces": [
  {
    "binding": "OAUTH_KV",
    "id": "YOUR_NEW_KV_ID_HERE"
  }
]
```

### 4. Upload Data to REMOTE R2
```bash
# This now uploads to REMOTE R2 automatically
npm run upload-data

# Or manually:
npx wrangler r2 object put security-article-search-data/search_metadata.json \
  --file="../security_article_search_mcp/search_metadata.json" \
  --remote  # CRITICAL: Use --remote flag!
```

### 5. Deploy to Workers
```bash
npm run deploy
```

Your worker will be deployed to: `https://remote-mcp-server.[your-account].workers.dev`

### 6. Configure Claude Desktop

**IMPORTANT**: Only use ONE MCP server to avoid conflicts!

Edit Claude Desktop config:
```json
{
  "mcpServers": {
    "security-search-remote": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://remote-mcp-server.[your-account].workers.dev/sse"
      ]
    }
  }
}
```

**Note**: Use `mcp-remote` NOT `@cloudflare/mcp-server-cloudflare`

### 7. Test & Verify
1. Restart Claude Desktop (Cmd+R)
2. Browser should open for OAuth (any email/password works for now)
3. Check for the hammer icon showing available tools
4. Test with: "Search for the 5 latest security articles"

## Common Issues & Solutions

### Issue: "Metadata file not found in R2"
**Cause**: Data uploaded to LOCAL R2 instead of REMOTE
**Solution**: 
```bash
npx wrangler r2 object put security-article-search-data/search_metadata.json \
  --file="../security_article_search_mcp/search_metadata.json" \
  --remote
```

### Issue: "Server disconnected" in Claude
**Cause**: Wrong MCP client package or missing permissions
**Solution**: 
- Use `mcp-remote` in config (not other packages)
- Ensure R2 is enabled in Cloudflare account
- Re-login with `npx wrangler login`

### Issue: Duplicate tools appearing
**Cause**: Multiple MCP servers with same tools configured
**Solution**: Remove local Python MCP from Claude config, keep only remote

### Issue: KV namespace not found
**Cause**: KV ID in wrangler.jsonc doesn't match created namespace
**Solution**: Update wrangler.jsonc with correct KV namespace ID from creation output

## Verification Commands

```bash
# Check if data is in REMOTE R2
npx wrangler r2 object get security-article-search-data/search_metadata.json --remote --pipe | head -10

# Test MCP connection locally
npx @modelcontextprotocol/inspector
# Enter: http://localhost:8787/sse (for local)
# Or: https://remote-mcp-server.[your-account].workers.dev/sse (for remote)

# Check Worker logs for errors
npx wrangler tail remote-mcp-server --format pretty
```

## Scripts Added

- `npm run upload-data` - Now uploads to REMOTE R2 automatically
- `npm run deploy` - Deploys to Cloudflare Workers
- `npm run dev` - Run locally for testing

## Important Notes

1. **Always use --remote flag** when uploading to R2 for production
2. **R2 must be enabled** in your Cloudflare account before deployment
3. **Use mcp-remote** package in Claude config, not other variants
4. **Remove local MCP configs** to avoid confusion with duplicate tools