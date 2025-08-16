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

// R2 configuration from environment variables
const R2_URL = process.env.R2_PUBLIC_URL || 'https://pub-7e17005f86444e028bc6c091baa4e227.r2.dev';
const METADATA_PATH = 'search_metadata.json';

/**
 * Load metadata from R2 or cache
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
    
    // Fetch from R2
    console.log('Fetching from R2:', `${R2_URL}/${METADATA_PATH}`);
    const response = await fetch(`${R2_URL}/${METADATA_PATH}`);
    
    if (!response.ok) {
      throw new Error(`R2 fetch failed: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Save to disk cache
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(data));
    
    // Update in-memory cache
    metadataCache = data;
    cacheLoadTime = now;
    
    console.log(`Loaded ${data.length} articles from R2`);
    return data;
    
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
    
    throw error;
  }
}

/**
 * Search implementation
 */
class SecuritySearchEngine {
  constructor(metadata) {
    this.articles = metadata;
    this.fieldIndex = this.buildFieldIndex();
  }
  
  buildFieldIndex() {
    const index = {};
    
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
        if (!article.published_date) return false;
        return article.published_date >= since_date;
      });
    }
    
    // Sort by date (newest first)
    results.sort((a, b) => {
      const dateA = a.published_date || '0000-00-00';
      const dateB = b.published_date || '0000-00-00';
      return dateB.localeCompare(dateA);
    });
    
    // Apply limit
    results = results.slice(0, limit);
    
    // Return summary or full
    if (summary_mode) {
      return results.map(article => ({
        id: article.id,
        title: article.title,
        published_date: article.published_date,
        severity_level: article.severity_level,
        summary: article.summary || article.description?.substring(0, 200)
      }));
    }
    
    return results;
  }
  
  getArticleDetails(articleId) {
    const article = this.articles.find(a => a.id === articleId);
    if (!article) {
      throw new Error(`Article ${articleId} not found`);
    }
    return article;
  }
}

// Express middleware
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    cache: metadataCache ? 'loaded' : 'empty',
    articles: metadataCache ? metadataCache.length : 0
  });
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
  console.log(`R2 URL: ${R2_URL}`);
  console.log(`Cache TTL: ${CACHE_TTL / 1000} seconds`);
});