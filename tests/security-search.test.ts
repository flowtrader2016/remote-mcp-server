import { describe, it, expect, beforeEach } from 'vitest';
import { SecuritySearchEngine } from '../src/security-search';
import { mockEnv, mockMetadata, mockArticles } from './fixtures/mock-data';

describe('SecuritySearchEngine - Fixed Tests', () => {
  let searchEngine: SecuritySearchEngine;

  beforeEach(() => {
    searchEngine = new SecuritySearchEngine(mockEnv as any);
  });

  describe('loadMetadata', () => {
    it('should load metadata from R2 storage', async () => {
      const metadata = await searchEngine.loadMetadata();
      
      expect(metadata).toBeDefined();
      expect(metadata.total_articles).toBe(3);
      expect(metadata.articles).toHaveLength(3);
      expect(metadata.generated_at).toBe("2025-08-14T11:37:17.199014Z");
    });
  });

  describe('getSearchableFields', () => {
    it('should return searchable fields with correct structure', async () => {
      const result = await searchEngine.getSearchableFields();
      
      // Check the structure
      expect(result).toHaveProperty('total_fields');
      expect(result).toHaveProperty('dataset_info');
      expect(result).toHaveProperty('field_categories');
      expect(result).toHaveProperty('fields');
      
      // Check dataset info
      expect(result.dataset_info.total_articles).toBe(3);
      
      // Check that fields array exists and has items
      expect(Array.isArray(result.fields)).toBe(true);
      expect(result.fields.length).toBeGreaterThan(0);
      
      // Check field structure
      const firstField = result.fields[0];
      expect(firstField).toHaveProperty('field');
      expect(firstField).toHaveProperty('type');
      expect(firstField).toHaveProperty('description');
      expect(firstField).toHaveProperty('total_unique_values');
      expect(firstField).toHaveProperty('examples');
    });
  });

  describe('getFieldValues', () => {
    it('should return field values with correct structure', async () => {
      const result = await searchEngine.getFieldValues('vendor');
      
      // Check structure
      expect(result).toHaveProperty('field_name');
      expect(result).toHaveProperty('metadata');
      expect(result).toHaveProperty('values_with_counts');
      expect(result).toHaveProperty('total_values');
      
      // Check field name
      expect(result.field_name).toBe('vendor');
      
      // Check values
      expect(result.values_with_counts).toHaveProperty('Sophos');
      expect(result.values_with_counts).toHaveProperty('Microsoft');
      expect(result.values_with_counts).toHaveProperty('SolarWinds');
      
      // Check counts
      expect(result.values_with_counts['Sophos']).toBe(1);
      expect(result.values_with_counts['Microsoft']).toBe(1);
      expect(result.values_with_counts['SolarWinds']).toBe(1);
    });

    it('should throw error for non-existent field', async () => {
      await expect(searchEngine.getFieldValues('invalid_field'))
        .rejects.toThrow("Field 'invalid_field' not found");
    });
  });

  describe('searchArticles', () => {
    it('should filter by vendor', async () => {
      // searchArticles(filters, sinceDate, limit, summaryMode)
      const results = await searchEngine.searchArticles(
        { vendor: ['Microsoft'] },
        undefined,
        10,
        false
      );
      
      expect(results).toHaveLength(1);
      expect(results[0].vendor).toBe('Microsoft');
    });

    it('should filter by article_type', async () => {
      const results = await searchEngine.searchArticles(
        { article_type: ['Ransomware'] },
        undefined,
        10,
        false
      );
      
      expect(results).toHaveLength(1);
      expect(results[0].article_type).toBe('Ransomware');
    });

    it('should filter by multiple criteria', async () => {
      const results = await searchEngine.searchArticles(
        { 
          article_type: ['APTActivity'],
          severity_level: ['Critical']
        },
        undefined,
        10,
        false
      );
      
      expect(results).toHaveLength(1);
      expect(results[0].article_type).toBe('APTActivity');
      expect(results[0].severity_level).toBe('Critical');
    });

    it('should return all articles when no filters', async () => {
      const results = await searchEngine.searchArticles(
        {},
        undefined,
        10,
        false
      );
      
      expect(results).toHaveLength(3);
    });

    it('should respect max_results limit', async () => {
      const results = await searchEngine.searchArticles(
        {},
        undefined,
        2,
        false
      );
      
      expect(results).toHaveLength(2);
    });

    it('should return summaries when summaryMode is true', async () => {
      const results = await searchEngine.searchArticles(
        {},
        undefined,
        10,
        true
      );
      
      expect(results).toHaveLength(3);
      // In summary mode, articles should have limited fields
      const firstResult = results[0];
      expect(firstResult).toHaveProperty('article_id');
      expect(firstResult).toHaveProperty('title');
      expect(firstResult).toHaveProperty('url');
      expect(firstResult).toHaveProperty('article_date');
      expect(firstResult).toHaveProperty('severity_level');
    });
  });

  describe('getArticleDetails', () => {
    it('should return full article details by URL', async () => {
      const url = mockArticles[0].url;
      const article = await searchEngine.getArticleDetails(url);
      
      expect(article).toBeDefined();
      expect(article?.url).toBe(url);
      expect(article?.title).toBe(mockArticles[0].title);
      expect(article?.vendor).toBe('Sophos');
    });

    it('should throw error for non-existent article', async () => {
      await expect(searchEngine.getArticleDetails('https://nonexistent.com/article'))
        .rejects.toThrow('Article not found');
    });
  });
});