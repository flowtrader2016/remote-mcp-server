# Container Architecture with R2 + Caching

## Architecture Overview

This implementation uses **Cloudflare Containers** with **R2 storage** and **intelligent caching**:

```
┌─────────────────┐
│  Claude Desktop │
└────────┬────────┘
         │ MCP/SSE
         ↓
┌─────────────────┐
│ Cloudflare      │
│ Access Auth     │
└────────┬────────┘
         │ JWT Token
         ↓
┌─────────────────┐      ┌─────────────────┐
│  Worker         │      │  R2 Storage     │
│  (Router)       │      │  (57MB JSON)    │
└────────┬────────┘      └────────┬────────┘
         │                         │
         ↓                         │
┌─────────────────────────────────┴────────┐
│  Container (4GB Memory)                  │
│  ┌────────────────────────────────────┐  │
│  │ Express Server                     │  │
│  ├────────────────────────────────────┤  │
│  │ In-Memory Cache (1hr TTL)          │  │
│  ├────────────────────────────────────┤  │
│  │ Disk Cache (/app/cache)            │  │
│  └────────────────────────────────────┘  │
└───────────────────────────────────────────┘
```

## Why This Architecture?

### Benefits over pure Workers:
1. **No memory limits** - 4GB available vs 128MB
2. **Persistent caching** - Both memory and disk cache
3. **Better performance** - Data stays loaded between requests
4. **Cost effective** - Container sleeps when idle

### Benefits over embedding data:
1. **Flexible updates** - Update R2 without redeploying
2. **Smaller images** - Docker image stays small
3. **Multi-region** - R2 replicates globally
4. **Backup strategy** - R2 provides durability

## Caching Strategy

### Three-tier caching:
1. **In-Memory Cache** (Fastest)
   - TTL: 1 hour
   - Instant access
   - Survives between requests

2. **Disk Cache** (Fast)
   - TTL: 1 hour
   - Survives container restarts
   - Path: `/app/cache/search_metadata.json`

3. **R2 Storage** (Reliable)
   - Always available
   - Source of truth
   - Global replication

### Cache Flow:
```
Request → Memory Cache? → Disk Cache? → R2 Fetch
            ↓ Hit           ↓ Hit         ↓ Success
          Return         Return       Update Caches → Return
```

## Container Configuration

### Instance Type: Standard
- **Memory**: 4 GiB
- **vCPU**: 1/2
- **Disk**: 4 GB
- **Perfect for**: 57MB JSON + processing overhead

### Auto-scaling:
- **Max instances**: 5
- **Sleep after**: 10 minutes idle
- **Wake on**: New request

## Cost Analysis

### Workers Paid Plan ($5/month includes):
- 375 vCPU-minutes free
- 25 GiB-hours memory free  
- 200 GB-hours disk free

### Estimated Usage:
Assuming 100 requests/day, 30s per request:
- **CPU**: ~50 minutes/month (well under 375 free)
- **Memory**: ~3.3 GiB-hours/month (well under 25 free)
- **Disk**: Minimal (well under 200 free)
- **Total cost**: $5/month (all in free tier)

## Deployment

### Prerequisites:
1. Workers Paid plan ($5/month)
2. Docker Desktop installed and running
3. R2 bucket with metadata uploaded

### Deploy Command:
```bash
npm run deploy:container
```

### What happens:
1. Docker builds the container image
2. Wrangler pushes to Cloudflare Registry
3. Container deploys globally
4. Auto-starts on first request

## API Endpoints

All endpoints require Cloudflare Access authentication:

- `GET /health` - Health check (no auth)
- `GET /show_searchable_fields` - List available fields
- `GET /get_field_values/:field` - Get values for a field
- `POST /query_articles` - Search articles
- `GET /get_article_details/:id` - Get full article

## Monitoring

### View Container status:
```bash
# Logs
npx wrangler tail

# Dashboard
open https://dash.cloudflare.com
```

### Metrics available:
- Container instances running
- Memory/CPU usage
- Request count
- Cache hit rates

## Troubleshooting

### Container won't start:
- Check Docker is running: `docker info`
- Check Workers Paid plan is active
- Verify R2 bucket has data

### Memory issues:
- Container has 4GB (plenty for 57MB JSON)
- Check for memory leaks in code
- Monitor with dashboard

### Cache issues:
- Cache TTL is 1 hour
- Manual refresh: Restart container
- Check R2 connectivity

## Future Improvements

1. **Implement cache warming** - Preload on container start
2. **Add compression** - Gzip responses
3. **Implement streaming** - Stream large results
4. **Add metrics** - Track cache hit rates
5. **Optimize indexes** - Pre-build search indexes