# Architecture Redesign for Large Data

## Current Problem
- 57MB JSON file + parsing = >128MB memory usage
- Workers have hard 128MB limit
- No container option like AWS Lambda

## Recommended Architecture

### Option 1: D1 Database (Recommended)
Convert search_metadata.json to SQLite database:
- **Unlimited storage** (up to 10GB free tier)
- **SQL queries** instead of loading everything in memory
- **Indexed searches** - much faster
- **Pagination** built-in

```sql
CREATE TABLE articles (
  id TEXT PRIMARY KEY,
  title TEXT,
  severity_level TEXT,
  cloud_platforms TEXT,
  published_date TEXT,
  content TEXT
);

CREATE INDEX idx_severity ON articles(severity_level);
CREATE INDEX idx_platform ON articles(cloud_platforms);
```

### Option 2: R2 + Streaming
Keep R2 but use streaming:
- Stream JSON in chunks
- Process line-by-line
- Never load full file in memory

### Option 3: Vectorize (for semantic search)
Use Cloudflare Vectorize:
- Convert articles to embeddings
- Semantic search capabilities
- Built for this use case

### Option 4: KV Namespace
Split data across multiple KV entries:
- Each article as separate KV entry
- Index in separate KV for fast lookup
- 25MB per value, unlimited entries

## Migration Plan

### Step 1: Convert to D1
```javascript
// upload-to-d1.js
const sqlite3 = require('sqlite3');
const data = require('./search_metadata.json');

const db = new sqlite3.Database('./articles.db');

// Create table
db.run(`CREATE TABLE IF NOT EXISTS articles (...)`);

// Insert data
data.forEach(article => {
  db.run(`INSERT INTO articles VALUES (?, ?, ?, ...)`, [...]);
});
```

### Step 2: Update Worker
```typescript
// Use D1 instead of R2
const results = await env.DB.prepare(
  "SELECT * FROM articles WHERE severity_level = ? LIMIT ?"
).bind(severity, limit).all();
```

### Step 3: Benefits
- **No memory issues** - D1 handles everything
- **Faster queries** - SQL indexes
- **Better scaling** - Can grow to millions of articles
- **Cost effective** - D1 free tier is generous

## Cost Comparison

### Current (R2 + Workers):
- R2 Storage: ~free for 57MB
- R2 Operations: $0.36/million requests
- Workers: $0.50/million requests
- **Problem**: Memory limit blocks us

### With D1:
- D1 Storage: Free (up to 10GB)
- D1 Reads: Free (up to 5 million/day)
- D1 Writes: Free (up to 100k/day)
- Workers: $0.50/million requests
- **Benefit**: No memory issues

### With AWS Lambda Containers:
- Lambda: $0.20/million requests
- Lambda Memory: $0.0000166667/GB-second
- S3 Storage: $0.023/GB
- **Problem**: Higher latency, cold starts

## Recommendation

**Use D1 Database** - it's built for this exact use case:
1. No memory constraints
2. Better performance with indexes
3. Free for your usage level
4. Native Cloudflare integration
5. SQL queries are more flexible

Want me to help you migrate to D1?