import express from 'express';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';

const app = express();
const PORT = 3000;
const CACHE_FILE = '/app/cache/search_metadata.json';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour cache

// In-memory cache
let metadataCache = null;
let cacheLoadTime = 0;

// R2 configuration - data will be provided by Worker
const METADATA_PATH = 'search_metadata.json';

/**
 * Load metadata from cache or request from Worker
 */
async function loadMetadata() {
  const now = Date.now();
  
  // Check in-memory cache first
  if (metadataCache && (now - cacheLoadTime) < CACHE_TTL) {
    console.log('Using in-memory cache');
    return metadataCache;
  }
  
  try {
    // Check disk cache
    const cacheExists = await fs.access(CACHE_FILE).then(() => true).catch(() => false);
    if (cacheExists) {
      const stats = await fs.stat(CACHE_FILE);
      const fileAge = now - stats.mtimeMs;
      
      if (fileAge < CACHE_TTL) {
        console.log('Loading from disk cache');
        const data = await fs.readFile(CACHE_FILE, 'utf8');
        metadataCache = JSON.parse(data);
        cacheLoadTime = now;
        return metadataCache;
      }
    }
    
    // No cache available - return empty array for now
    // The Worker will need to provide the data
    console.log('No cached data available, returning empty array');
    return [];
    
  } catch (error) {
    console.error('Error loading metadata:', error);
    
    // Try to use stale cache if available
    if (metadataCache) {
      console.log('Using stale in-memory cache due to error');
      return metadataCache;
    }
    
    // Try stale disk cache
    const cacheExists = await fs.access(CACHE_FILE).then(() => true).catch(() => false);
    if (cacheExists) {
      console.log('Using stale disk cache due to error');
      const data = await fs.readFile(CACHE_FILE, 'utf8');
      return JSON.parse(data);
    }
    
    return [];
  }
}

/**
 * Search implementation
 */
class SecuritySearchEngine {
  constructor(metadata) {
    // Ensure articles is always an array
    this.articles = Array.isArray(metadata) ? metadata : [];
    this.fieldIndex = this.buildFieldIndex();
  }
  
  buildFieldIndex() {
    const index = {};
    
    // Guard against empty or invalid articles
    if (!this.articles || this.articles.length === 0) {
      return index;
    }
    
    this.articles.forEach(article => {
      Object.entries(article).forEach(([field, value]) => {
        if (!index[field]) {
          index[field] = new Set();
        }
        
        if (Array.isArray(value)) {
          value.forEach(v => index[field].add(v));
        } else if (value !== null && value !== undefined) {
          index[field].add(value);
        }
      });
    });
    
    // Convert sets to arrays
    Object.keys(index).forEach(field => {
      index[field] = Array.from(index[field]).sort();
    });
    
    return index;
  }
  
  getSearchableFields() {
    return {
      fields: Object.keys(this.fieldIndex),
      total_articles: this.articles.length,
      sample_values: Object.fromEntries(
        Object.entries(this.fieldIndex)
          .map(([field, values]) => [field, values.slice(0, 5)])
      )
    };
  }
  
  getFieldValues(fieldName, searchTerm = null) {
    const values = this.fieldIndex[fieldName] || [];
    
    if (searchTerm) {
      const filtered = values.filter(v => 
        String(v).toLowerCase().includes(searchTerm.toLowerCase())
      );
      return {
        field: fieldName,
        values: filtered,
        total_count: filtered.length
      };
    }
    
    return {
      field: fieldName,
      values: values,
      total_count: values.length
    };
  }
  
  searchArticles({ filters = {}, since_date = null, limit = 30, summary_mode = true }) {
    let results = [...this.articles];
    
    // Apply filters
    Object.entries(filters).forEach(([field, values]) => {
      if (values && values.length > 0) {
        results = results.filter(article => {
          const articleValue = article[field];
          if (Array.isArray(articleValue)) {
            return values.some(v => articleValue.includes(v));
          }
          return values.includes(articleValue);
        });
      }
    });
    
    // Apply date filter
    if (since_date) {
      results = results.filter(article => {
        // Try date_original first (cleaner data), then article_date
        const dateValue = article.date_original || article.article_date;
        
        if (!dateValue) return false;
        
        // Skip invalid date formats
        if (dateValue === 'YYYYMMDD' || dateValue.includes('২０')) {
          return false; // Exclude articles with bad dates
        }
        
        try {
          // Extract just the date part if there's time info
          const datePart = dateValue.split(' ')[0];
          return datePart >= since_date;
        } catch (e) {
          // If date comparison fails, exclude the article
          return false;
        }
      });
    }
    
    // Sort by date (newest first)
    results.sort((a, b) => {
      const dateA = (a.date_original || a.article_date || '0000-00-00').split(' ')[0];
      const dateB = (b.date_original || b.article_date || '0000-00-00').split(' ')[0];
      return dateB.localeCompare(dateA);
    });
    
    // Apply limit
    results = results.slice(0, limit);
    
    // Return summary or full
    if (summary_mode) {
      return results.map(article => ({
        article_id: article.title,  // Use title as the identifier since articles don't have id field
        title: article.title,
        article_date: article.date_original || article.article_date,
        severity_level: article.severity_level,
        summary: article.summary || article.description?.substring(0, 200),
        url: article.url,
        original_source_url: article.original_source_url
      }));
    }
    
    return results;
  }
  
  getArticleDetails(articleId) {
    // Articles use title as identifier, not id
    const article = this.articles.find(a => a.title === articleId);
    if (!article) {
      throw new Error(`Article ${articleId} not found`);
    }
    return article;
  }
}

// Express middleware
app.use(express.json({ limit: '100mb' })); // Increase limit for large JSON

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    cache: metadataCache ? 'loaded' : 'empty',
    articles: metadataCache ? metadataCache.length : 0
  });
});

// Endpoint for Worker to upload data
app.post('/load-data', async (req, res) => {
  try {
    const data = req.body;
    
    // Extract articles array from the metadata object
    // Handle both formats: direct array or object with articles property
    const articles = Array.isArray(data) ? data : (data.articles || []);
    
    // Save to memory cache
    metadataCache = articles;
    cacheLoadTime = Date.now();
    
    // Save to disk cache
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(articles));
    
    console.log(`Loaded ${articles.length} articles into cache`);
    res.json({ 
      status: 'ok', 
      articles: articles.length 
    });
  } catch (error) {
    console.error('Error loading data:', error);
    res.status(500).json({ error: error.message });
  }
});

// MCP endpoints
app.get('/show_searchable_fields', async (req, res) => {
  try {
    const metadata = await loadMetadata();
    const engine = new SecuritySearchEngine(metadata);
    res.json(engine.getSearchableFields());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/get_field_values/:field', async (req, res) => {
  try {
    const metadata = await loadMetadata();
    const engine = new SecuritySearchEngine(metadata);
    const result = engine.getFieldValues(
      req.params.field,
      req.query.search_term
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/query_articles', async (req, res) => {
  try {
    const metadata = await loadMetadata();
    const engine = new SecuritySearchEngine(metadata);
    const results = engine.searchArticles(req.body);
    res.json({
      metadata: {
        total_results: results.length,
        ...req.body
      },
      articles: results
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/get_article_details/:id', async (req, res) => {
  try {
    const metadata = await loadMetadata();
    const engine = new SecuritySearchEngine(metadata);
    const article = engine.getArticleDetails(req.params.id);
    res.json(article);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Preload metadata on startup
loadMetadata()
  .then(() => console.log('Metadata preloaded successfully'))
  .catch(err => console.error('Failed to preload metadata:', err));

// Start server
app.listen(PORT, () => {
  console.log(`MCP Container Server running on port ${PORT}`);
  console.log(`R2 URL: ${process.env.R2_PUBLIC_URL || 'Not configured'}`);
  console.log(`Cache TTL: ${CACHE_TTL / 1000} seconds`);
});