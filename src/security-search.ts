import { Article, SearchMetadata, FieldInfo, SearchFilters } from './types';

export class SecuritySearchEngine {
  private cachedMetadata: SearchMetadata | null = null;
  private cacheTime: number = 0;
  private readonly CACHE_TTL = 60000; // Cache for 1 minute

  constructor(private env: any) {}

  async loadMetadata(): Promise<SearchMetadata> {
    // Return cached data if it's still fresh
    if (this.cachedMetadata && (Date.now() - this.cacheTime) < this.CACHE_TTL) {
      console.log('Using cached metadata');
      return this.cachedMetadata;
    }
    try {
      console.log('Loading metadata from R2...');
      const object = await this.env.SEARCH_DATA.get('search_metadata.json');
      if (!object) {
        throw new Error('Metadata file not found in R2');
      }
      
      console.log('Fetching text from R2 object...');
      const text = await object.text();
      console.log(`Got ${text.length} bytes of text`);
      
      console.log('Parsing JSON...');
      const metadata = JSON.parse(text);
      console.log(`Parsed ${metadata.articles.length} articles`);
      
      // Cache the metadata
      this.cachedMetadata = metadata;
      this.cacheTime = Date.now();
      console.log('Metadata cached for 1 minute');
      
      return metadata;
    } catch (error) {
      console.error('Failed to load metadata:', error);
      throw new Error(`Failed to load search metadata: ${error}`);
    }
  }


  async getSearchableFields(): Promise<any> {
    const metadata = await this.loadMetadata();
    
    const fieldCategories = {
      content_summary: ['summary', 'article_text_md_original', 'ciso_summary_key_points'],
      threat_intelligence: ['threat_types', 'threat_actor_name', 'severity_level', 'cve_identifiers', 'related_incidents'],
      cloud_technology: ['cloud_platforms', 'products_impacted'],
      business_context: ['sectors', 'regions', 'affected_organizations', 'article_type'],
      temporal: ['title', 'article_date', 'date_original'],
      sources: ['original_source_name', 'original_source_url']
    };

    const fields: FieldInfo[] = [];
    const fieldValueSamples = new Map<string, Set<string>>();
    
    // Just collect a few samples for each field, don't build full cache
    for (const article of metadata.articles.slice(0, 100)) { // Only sample first 100 articles
      for (const [category, fieldNames] of Object.entries(fieldCategories)) {
        for (const fieldName of fieldNames) {
          if (!fieldValueSamples.has(fieldName)) {
            fieldValueSamples.set(fieldName, new Set());
          }
          
          const fieldData = article[fieldName];
          if (fieldData) {
            const samples = fieldValueSamples.get(fieldName)!;
            if (Array.isArray(fieldData)) {
              for (const item of fieldData) {
                if (item != null && samples.size < 3) {
                  samples.add(String(item));
                }
              }
            } else if (samples.size < 3) {
              samples.add(String(fieldData));
            }
          }
        }
      }
    }
    
    for (const [category, fieldNames] of Object.entries(fieldCategories)) {
      for (const fieldName of fieldNames) {
        const samples = fieldValueSamples.get(fieldName);
        if (samples && samples.size > 0) {
          fields.push({
            field: fieldName,
            type: category,
            description: this.getFieldDescription(fieldName),
            total_unique_values: 0, // We don't know without full scan
            examples: Array.from(samples)
          });
        }
      }
    }

    return {
      total_fields: fields.length,
      dataset_info: {
        total_articles: metadata.total_articles,
        date_range: this.getDateRange(metadata),
        last_update: metadata.last_update
      },
      field_categories: fieldCategories,
      fields: fields
    };
  }

  async getFieldValues(fieldName: string, searchTerm?: string): Promise<any> {
    const metadata = await this.loadMetadata();
    
    // Build value counts on demand - no cache
    const valueCounts: Map<string, number> = new Map();
    let fieldFound = false;
    
    for (const article of metadata.articles) {
      const fieldValue = article[fieldName];
      
      if (fieldValue !== undefined) {
        fieldFound = true;
      }
      
      if (Array.isArray(fieldValue)) {
        for (const val of fieldValue) {
          if (val != null) {
            const strVal = String(val);
            valueCounts.set(strVal, (valueCounts.get(strVal) || 0) + 1);
          }
        }
      } else if (fieldValue != null) {
        const strVal = String(fieldValue);
        valueCounts.set(strVal, (valueCounts.get(strVal) || 0) + 1);
      }
    }
    
    if (!fieldFound) {
      throw new Error(`Field '${fieldName}' not found`);
    }

    let filteredValues = Array.from(valueCounts.entries());
    
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filteredValues = filteredValues.filter(([value]) => 
        value.toLowerCase().includes(term)
      );
    }

    filteredValues.sort((a, b) => b[1] - a[1]);

    const valuesWithCounts: { [key: string]: number } = {};
    for (const [value, count] of filteredValues) {
      valuesWithCounts[value] = count;
    }

    return {
      field_name: fieldName,
      metadata: {
        total_unique_values: valueCounts.size,
        filter_applied: searchTerm || null,
        total_values_after_filter: filteredValues.length
      },
      values_with_counts: valuesWithCounts,
      total_values: filteredValues.length
    };
  }

  async searchArticles(
    filters?: SearchFilters,
    sinceDate?: string,
    limit: number = 30,
    summaryMode: boolean = true
  ): Promise<any> {
    const metadata = await this.loadMetadata();
    
    let results = [...metadata.articles];
    
    if (sinceDate) {
      results = results.filter(article => this.matchDate(article, sinceDate));
    }
    
    if (filters) {
      const platforms = filters.cloud_platforms || [];
      const products = filters.products_impacted || [];
      
      const otherFilters: SearchFilters = { ...filters };
      delete otherFilters.cloud_platforms;
      delete otherFilters.products_impacted;
      
      if (platforms.length > 0) {
        results = results.filter(article => this.matchPlatforms(article, platforms));
      }
      
      if (products.length > 0) {
        results = results.filter(article => this.matchProducts(article, products));
      }
      
      for (const [fieldName, terms] of Object.entries(otherFilters)) {
        if (terms && terms.length > 0) {
          results = results.filter(article => this.matchField(article, fieldName, terms));
        }
      }
    }
    
    results = results.slice(0, Math.min(limit, 1000));
    
    if (summaryMode) {
      return results.map(article => ({
        article_id: article.s3_path_html || article.url || '',
        title: article.title || 'No title',
        url: article.url || 'No URL',
        article_date: article.article_date || 'Unknown date',
        severity_level: article.severity_level || 'Unknown'
      }));
    }
    
    return results;
  }

  async getArticleDetails(articleId: string): Promise<any> {
    const metadata = await this.loadMetadata();
    
    const article = metadata.articles.find(art => 
      articleId === art.s3_path_html || 
      articleId === art.url ||
      (art.s3_path_html && art.s3_path_html.includes(articleId)) ||
      (art.url && art.url.includes(articleId))
    );
    
    if (!article) {
      throw new Error(`Article not found: ${articleId}`);
    }
    
    return article;
  }

  private matchDate(article: Article, sinceDate: string): boolean {
    const articleDate = article.date_original || article.article_date || '';
    if (!articleDate) return true;
    
    try {
      const datePart = articleDate.split(' ')[0] || articleDate;
      return datePart >= sinceDate;
    } catch {
      return true;
    }
  }

  private matchPlatforms(article: Article, platforms: string[]): boolean {
    if (!article.cloud_platforms) return false;
    
    const articlePlatforms = article.cloud_platforms.map(p => p.toLowerCase());
    return platforms.some(p => articlePlatforms.includes(p.toLowerCase()));
  }

  private matchProducts(article: Article, products: string[]): boolean {
    if (!article.products_impacted) return false;
    
    const productText = article.products_impacted.join(' ').toLowerCase();
    return products.some(p => productText.includes(p.toLowerCase()));
  }

  private matchField(article: Article, fieldName: string, terms: string[]): boolean {
    const fieldValue = article[fieldName];
    
    if (!fieldValue) return false;
    
    const validTerms = terms.filter(t => t && t.trim());
    if (validTerms.length === 0) return false;
    
    let valueText: string;
    if (Array.isArray(fieldValue)) {
      valueText = fieldValue.join(' ');
    } else {
      valueText = String(fieldValue);
    }
    
    valueText = valueText.toLowerCase();
    
    return validTerms.some(term => {
      if (fieldName === 'summary' || fieldName === 'title' || fieldName === 'article_text_md_original') {
        return valueText.includes(term.toLowerCase());
      }
      
      if (Array.isArray(fieldValue)) {
        return fieldValue.some(v => String(v).toLowerCase() === term.toLowerCase());
      }
      
      return String(fieldValue).toLowerCase() === term.toLowerCase();
    });
  }

  private getFieldDescription(fieldName: string): string {
    const descriptions: { [key: string]: string } = {
      summary: 'Article summary for quick understanding',
      article_text_md_original: 'Full markdown text of the article',
      ciso_summary_key_points: 'Executive-level key points',
      threat_types: 'Types of security threats',
      threat_actor_name: 'Named threat actors or groups',
      severity_level: 'Severity classification of the threat',
      cve_identifiers: 'CVE identifiers referenced',
      related_incidents: 'Links to related security incidents',
      cloud_platforms: 'Cloud platforms affected',
      products_impacted: 'Products or services impacted',
      sectors: 'Industry sectors affected',
      regions: 'Geographic regions impacted',
      affected_organizations: 'Organizations mentioned',
      article_type: 'Classification of article type',
      title: 'Article title',
      article_date: 'Publication date',
      date_original: 'Original publication date',
      original_source_name: 'Original source name',
      original_source_url: 'Original source URL'
    };
    
    return descriptions[fieldName] || `Field: ${fieldName}`;
  }

  private getDateRange(metadata: SearchMetadata): string {
    if (!metadata) return 'Unknown';
    
    const dates = metadata.articles
      .map(a => a.date_original || a.article_date)
      .filter(d => d && d.match(/^\d{4}-\d{2}-\d{2}/))
      .sort();
    
    if (dates.length === 0) return 'Unknown';
    
    return `${dates[0]} to ${dates[dates.length - 1]}`;
  }
}