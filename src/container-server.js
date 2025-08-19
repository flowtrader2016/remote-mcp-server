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
  
  searchFullText({ query, search_mode = 'exact', filters = {}, since_date = null, case_sensitive = false, whole_word = false, limit = 30, highlight = true }) {
    if (!query || query.trim() === '') {
      return { total_results: 0, query: query, results: [] };
    }
    
    const results = [];
    let searchTerms = [];
    
    // Handle different search modes
    if (search_mode === 'any_word' || search_mode === 'all_words') {
      // Split query into individual words, removing extra spaces
      searchTerms = query.trim().split(/\s+/).map(term => 
        case_sensitive ? term : term.toLowerCase()
      );
    } else {
      // Default: exact phrase search
      searchTerms = [case_sensitive ? query.trim() : query.trim().toLowerCase()];
    }
    
    // Helper function to escape regex special characters
    const escapeRegex = (str) => {
      return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    };
    
    // Helper function to extract context around match - improved to show ALL matching terms
    const extractContext = (text, contextLength = 300) => {
      if (!text) return '';
      
      const searchIn = case_sensitive ? text : text.toLowerCase();
      let allMatches = [];
      
      // Find ALL matching terms and their positions
      if (search_mode === 'exact') {
        const index = searchIn.indexOf(searchTerms[0]);
        if (index !== -1) {
          allMatches.push({ term: query, index: index, length: query.length });
        }
      } else {
        // For any_word or all_words, find ALL terms that match
        searchTerms.forEach(term => {
          let index = searchIn.indexOf(term);
          while (index !== -1) {
            allMatches.push({ term: term, index: index, length: term.length });
            // Look for more occurrences
            index = searchIn.indexOf(term, index + 1);
          }
        });
      }
      
      if (allMatches.length === 0) {
        return '';
      }
      
      // Sort matches by position
      allMatches.sort((a, b) => a.index - b.index);
      
      // Find the best range that includes as many matches as possible
      let bestStart = 0;
      let bestEnd = text.length;
      let maxMatches = 0;
      
      // Try centering around each match to see which gives the most coverage
      for (const match of allMatches) {
        const start = Math.max(0, match.index - contextLength / 2);
        const end = Math.min(text.length, match.index + match.length + contextLength / 2);
        
        // Count how many matches fall within this range
        const matchesInRange = allMatches.filter(m => m.index >= start && (m.index + m.length) <= end).length;
        
        if (matchesInRange > maxMatches) {
          maxMatches = matchesInRange;
          bestStart = start;
          bestEnd = end;
        }
      }
      
      // If we can't fit all matches in one snippet, create a multi-part snippet
      if (maxMatches < allMatches.length && allMatches.length > 1) {
        // Create snippet that shows context around first and last matches
        const firstMatch = allMatches[0];
        const lastMatch = allMatches[allMatches.length - 1];
        
        // If matches are far apart, show context around each
        if (lastMatch.index - firstMatch.index > contextLength) {
          const firstStart = Math.max(0, firstMatch.index - contextLength / 4);
          const firstEnd = Math.min(text.length, firstMatch.index + firstMatch.length + contextLength / 4);
          const lastStart = Math.max(0, lastMatch.index - contextLength / 4);
          const lastEnd = Math.min(text.length, lastMatch.index + lastMatch.length + contextLength / 4);
          
          let snippet = text.substring(firstStart, firstEnd) + ' ... ' + text.substring(lastStart, lastEnd);
          
          // Add ellipsis if truncated
          if (firstStart > 0) snippet = '...' + snippet;
          if (lastEnd < text.length) snippet = snippet + '...';
          
          // Highlight matches
          if (highlight) {
            if (search_mode === 'exact') {
              const regex = new RegExp(`(${escapeRegex(query)})`, case_sensitive ? 'g' : 'gi');
              snippet = snippet.replace(regex, '<mark>$1</mark>');
            } else {
              searchTerms.forEach(term => {
                const regex = new RegExp(`(${escapeRegex(term)})`, case_sensitive ? 'g' : 'gi');
                snippet = snippet.replace(regex, '<mark>$1</mark>');
              });
            }
          }
          
          return snippet;
        }
      }
      
      // Use the best single range
      let snippet = text.substring(bestStart, bestEnd);
      
      // Add ellipsis if truncated
      if (bestStart > 0) snippet = '...' + snippet;
      if (bestEnd < text.length) snippet = snippet + '...';
      
      // Highlight the matches if requested
      if (highlight) {
        if (search_mode === 'exact') {
          const regex = new RegExp(`(${escapeRegex(query)})`, case_sensitive ? 'g' : 'gi');
          snippet = snippet.replace(regex, '<mark>$1</mark>');
        } else {
          // Highlight all matching terms that appear in the snippet
          searchTerms.forEach(term => {
            const regex = new RegExp(`(${escapeRegex(term)})`, case_sensitive ? 'g' : 'gi');
            snippet = snippet.replace(regex, '<mark>$1</mark>');
          });
        }
      }
      
      return snippet;
    };
    
    // Helper function to check if text matches based on search mode
    const checkMatch = (text, terms, mode) => {
      if (!text) return false;
      const checkText = case_sensitive ? text : text.toLowerCase();
      
      if (mode === 'any_word') {
        return terms.some(term => checkText.includes(term));
      } else if (mode === 'all_words') {
        return terms.every(term => checkText.includes(term));
      } else {
        // exact mode
        return checkText.includes(terms[0]);
      }
    };

    // Helper function to count matches in text
    const countMatches = (text, terms, mode) => {
      if (!text) return 0;
      let count = 0;
      
      if (mode === 'any_word' || mode === 'all_words') {
        terms.forEach(term => {
          const regex = new RegExp(escapeRegex(term), case_sensitive ? 'g' : 'gi');
          const matches = (text.match(regex) || []).length;
          count += matches;
        });
      } else {
        const regex = new RegExp(escapeRegex(query), case_sensitive ? 'g' : 'gi');
        count = (text.match(regex) || []).length;
      }
      
      return count;
    };

    // Score and format results
    const scoreAndFormat = (article) => {
      let relevanceScore = 0;
      let matchCount = 0;
      const matchedIn = [];
      let bestSnippet = '';
      
      // For all_words mode, we need special handling to check across fields
      if (search_mode === 'all_words') {
        // Track which terms we've found across all fields
        const foundTerms = new Set();
        
        // Check title (highest weight)
        const title = article.title || '';
        searchTerms.forEach(term => {
          const compareText = case_sensitive ? title : title.toLowerCase();
          if (compareText.includes(term)) {
            foundTerms.add(term);
            relevanceScore += 10;
            matchCount += countMatches(title, [term], 'any_word');
            if (!matchedIn.includes('title')) {
              matchedIn.push('title');
            }
          }
        });
        
        // Check summary (medium weight)
        const summary = article.summary || '';
        searchTerms.forEach(term => {
          const compareText = case_sensitive ? summary : summary.toLowerCase();
          if (compareText.includes(term)) {
            foundTerms.add(term);
            relevanceScore += 5;
            matchCount += countMatches(summary, [term], 'any_word');
            if (!matchedIn.includes('summary')) {
              matchedIn.push('summary');
            }
            if (!bestSnippet) {
              bestSnippet = extractContext(summary);
            }
          }
        });
        
        // Check main article text (lower weight)
        const articleText = article.article_text_md_original || '';
        searchTerms.forEach(term => {
          const compareText = case_sensitive ? articleText : articleText.toLowerCase();
          if (compareText.includes(term)) {
            foundTerms.add(term);
            relevanceScore += 2;
            matchCount += countMatches(articleText, [term], 'any_word');
            if (!matchedIn.includes('article_text')) {
              matchedIn.push('article_text');
            }
            if (!bestSnippet) {
              bestSnippet = extractContext(articleText);
            }
          }
        });
        
        // Check other fields
        const otherFields = [
          ...(article.affected_organizations || []),
          ...(article.products_impacted || []),
          ...(article.threat_actor_name || []),
          ...(article.ciso_summary_key_points || []),
          ...(article.lessons_learned || [])
        ];
        
        const otherText = otherFields.join(' ');
        if (otherText) {
          searchTerms.forEach(term => {
            const compareText = case_sensitive ? otherText : otherText.toLowerCase();
            if (compareText.includes(term)) {
              foundTerms.add(term);
              relevanceScore += 1;
              matchCount += countMatches(otherText, [term], 'any_word');
              if (!matchedIn.includes('other_fields')) {
                matchedIn.push('other_fields');
              }
              if (!bestSnippet) {
                bestSnippet = extractContext(otherText);
              }
            }
          });
        }
        
        // For all_words mode, we must have found ALL terms across all fields
        if (foundTerms.size !== searchTerms.length) {
          relevanceScore = 0; // Reset score if not all terms found
        }
        
        // For all_words mode, if we didn't get a complete snippet, create a better one
        if (search_mode === 'all_words' && foundTerms.size === searchTerms.length && bestSnippet) {
          // Check if current snippet includes all terms
          const snippetLower = case_sensitive ? bestSnippet : bestSnippet.toLowerCase();
          const missingTerms = searchTerms.filter(term => !snippetLower.includes(term));
          
          if (missingTerms.length > 0) {
            // Find the field that contains the most terms and use it for snippet
            const allFieldTexts = [title, summary, articleText, otherText].filter(Boolean);
            
            let bestFieldText = '';
            let maxTermsFound = 0;
            
            for (const fieldText of allFieldTexts) {
              const fieldLower = case_sensitive ? fieldText : fieldText.toLowerCase();
              const termsInField = searchTerms.filter(term => fieldLower.includes(term)).length;
              if (termsInField > maxTermsFound) {
                maxTermsFound = termsInField;
                bestFieldText = fieldText;
              }
            }
            
            // If we found a better field, use it for the snippet
            if (bestFieldText && maxTermsFound > 0) {
              const newSnippet = extractContext(bestFieldText, 400);
              if (newSnippet) {
                bestSnippet = newSnippet;
              }
            }
          }
        }
        
      } else {
        // Original logic for any_word and exact modes
        // Check title (highest weight)
        const title = article.title || '';
        if (checkMatch(title, searchTerms, search_mode)) {
          relevanceScore += 10;
          matchCount += countMatches(title, searchTerms, search_mode);
          matchedIn.push('title');
        }
        
        // Check summary (medium weight)
        const summary = article.summary || '';
        if (checkMatch(summary, searchTerms, search_mode)) {
          relevanceScore += 5;
          matchCount += countMatches(summary, searchTerms, search_mode);
          matchedIn.push('summary');
          if (!bestSnippet) {
            bestSnippet = extractContext(summary);
          }
        }
        
        // Check main article text (lower weight)
        const articleText = article.article_text_md_original || '';
        if (checkMatch(articleText, searchTerms, search_mode)) {
          relevanceScore += 2;
          matchCount += countMatches(articleText, searchTerms, search_mode);
          matchedIn.push('article_text');
          if (!bestSnippet) {
            bestSnippet = extractContext(articleText);
          }
        }
        
        // Check other fields
        const otherFields = [
          ...(article.affected_organizations || []),
          ...(article.products_impacted || []),
          ...(article.threat_actor_name || []),
          ...(article.ciso_summary_key_points || []),
          ...(article.lessons_learned || [])
        ];
        
        const otherText = otherFields.join(' ');
        if (otherText && checkMatch(otherText, searchTerms, search_mode)) {
          relevanceScore += 1;
          matchCount += countMatches(otherText, searchTerms, search_mode);
          if (!matchedIn.includes('other_fields')) {
            matchedIn.push('other_fields');
          }
          if (!bestSnippet && otherText) {
            bestSnippet = extractContext(otherText);
          }
        }
      }
      
      return {
        article_id: article.title || article.url || 'No title',
        title: article.title || 'No title',
        article_date: article.date_original || article.article_date,
        severity_level: article.severity_level || '',
        summary: article.summary || article.description?.substring(0, 200) || '',
        url: article.url || '',
        original_source_url: article.original_source_url || null,
        relevance_score: relevanceScore,
        match_count: matchCount,
        matched_in: matchedIn,
        snippet: bestSnippet
      };
    };
    
    // Search through all articles
    for (const article of this.articles) {
      // Apply date filter first (same as searchArticles)
      if (since_date) {
        const dateValue = article.date_original || article.article_date;
        if (!dateValue) continue;
        
        // Skip invalid date formats
        if (dateValue === 'YYYYMMDD' || dateValue.includes('২০')) {
          continue;
        }
        
        try {
          const datePart = dateValue.split(' ')[0];
          if (datePart < since_date) {
            continue;
          }
        } catch (e) {
          continue;
        }
      }
      
      // Apply field filters (same as searchArticles)
      let passesFilters = true;
      for (const [field, values] of Object.entries(filters)) {
        if (values && values.length > 0) {
          const articleValue = article[field];
          if (Array.isArray(articleValue)) {
            if (!values.some(v => articleValue.includes(v))) {
              passesFilters = false;
              break;
            }
          } else {
            if (!values.includes(articleValue)) {
              passesFilters = false;
              break;
            }
          }
        }
      }
      if (!passesFilters) continue;
      
      // Now do the text search
      const fullText = [
        article.title,
        article.summary,
        article.article_text_md_original,
        article.ciso_summary_key_points ? article.ciso_summary_key_points.join(' ') : '',
        article.lessons_learned ? article.lessons_learned.join(' ') : '',
        article.affected_organizations ? article.affected_organizations.join(' ') : '',
        article.products_impacted ? article.products_impacted.join(' ') : '',
        article.threat_actor_name ? article.threat_actor_name.join(' ') : ''
      ].filter(Boolean).join(' ');
      
      let matches = false;
      
      if (search_mode === 'any_word') {
        // Check if ANY of the search terms match
        matches = searchTerms.some(term => {
          if (whole_word) {
            const regex = new RegExp(`\\b${escapeRegex(term)}\\b`, case_sensitive ? 'g' : 'gi');
            return regex.test(fullText);
          } else {
            const compareText = case_sensitive ? fullText : fullText.toLowerCase();
            return compareText.includes(term);
          }
        });
      } else if (search_mode === 'all_words') {
        // Check if ALL of the search terms match
        matches = searchTerms.every(term => {
          if (whole_word) {
            const regex = new RegExp(`\\b${escapeRegex(term)}\\b`, case_sensitive ? 'g' : 'gi');
            return regex.test(fullText);
          } else {
            const compareText = case_sensitive ? fullText : fullText.toLowerCase();
            return compareText.includes(term);
          }
        });
      } else {
        // Exact phrase search (default)
        const searchTerm = searchTerms[0];
        if (whole_word) {
          const regex = new RegExp(`\\b${escapeRegex(searchTerm)}\\b`, case_sensitive ? 'g' : 'gi');
          matches = regex.test(fullText);
        } else {
          const compareText = case_sensitive ? fullText : fullText.toLowerCase();
          matches = compareText.includes(searchTerm);
        }
      }
      
      if (matches) {
        const result = scoreAndFormat(article);
        if (result.relevance_score > 0) {
          results.push(result);
        }
      }
    }
    
    // Sort by relevance score (highest first)
    results.sort((a, b) => b.relevance_score - a.relevance_score);
    
    // Apply limit
    const limitedResults = results.slice(0, limit);
    
    return {
      total_results: results.length,
      query: query,
      search_mode: search_mode,
      filters: filters,
      since_date: since_date,
      case_sensitive: case_sensitive,
      whole_word: whole_word,
      results: limitedResults
    };
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

app.post('/search_full_text', async (req, res) => {
  try {
    const metadata = await loadMetadata();
    const engine = new SecuritySearchEngine(metadata);
    const results = engine.searchFullText(req.body);
    res.json(results);
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