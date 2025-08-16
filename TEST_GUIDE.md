# Security Article Search MCP - Testing Guide

## Overview
Comprehensive unit and integration tests for the Security Article Search MCP server, using real data samples from your search_metadata.json.

## Test Structure

```
tests/
├── fixtures/
│   └── mock-data.ts         # Mock data based on actual articles
├── security-search.test.ts  # Unit tests for SecuritySearchEngine
├── mcp-tools.test.ts        # Tests for MCP tool schemas & responses
└── integration.test.ts      # End-to-end workflow tests
```

## Running Tests

### Install Dependencies
```bash
npm install
```

### Run All Tests
```bash
npm test
```

### Run Tests in Watch Mode
```bash
npm run test:watch
```

### Run with Coverage Report
```bash
npm run test:coverage
```

## Test Coverage

### SecuritySearchEngine Tests (`security-search.test.ts`)
- **loadMetadata()**: Loading from R2, caching, error handling
- **getSearchableFields()**: Field discovery, consistency
- **getFieldValues()**: Unique value extraction, array handling, caching
- **searchArticles()**: Text search, filtering, date ranges, result limits
- **getArticleDetails()**: Full article retrieval, missing articles
- **Edge cases**: Missing fields, special characters, empty arrays

### MCP Tools Tests (`mcp-tools.test.ts`)
- **Tool Schemas**: Validation of input parameters for all 6 tools
- **Response Formatting**: Correct structure of tool responses
- **Error Handling**: Graceful handling of invalid inputs
- **Workflow Instructions**: Verification of help text

### Integration Tests (`integration.test.ts`)
- **Complete Workflows**:
  - Fields → Values → Search → Details
  - Threat actor investigation
  - Ransomware analysis
  - Compliance-focused search
  - Vulnerability research
  - Regional threat analysis
  - CISO summary extraction
  - Cloud security incidents

- **Performance Tests**:
  - Large result sets
  - Caching effectiveness
  - Concurrent operations

- **Error Recovery**:
  - Mixed valid/invalid filters
  - Partial data availability
  - Concurrent searches

## Mock Data

Mock data is based on actual articles from your search_metadata.json:

1. **APT Activity Article** (Sophos/China)
   - CVE-2020-12271
   - Nation-state threat actor
   - Critical severity

2. **Ransomware Article** (Microsoft/Healthcare)
   - LockBit malware
   - HIPAA compliance
   - High severity

3. **Supply Chain Attack** (SolarWinds)
   - APT29 threat actor
   - Global impact
   - Critical severity

## Test Assertions

### Key Test Scenarios

1. **Field Value Discovery**
   ```typescript
   // Verify unique vendor values
   const vendors = await searchEngine.getFieldValues('vendor');
   expect(vendors).toContain('Sophos');
   expect(vendors).toContain('Microsoft');
   ```

2. **Complex Filtering**
   ```typescript
   // Multi-criteria search
   const results = await searchEngine.searchArticles({
     threat_sophistication_level: 'High',
     severity_level: 'Critical',
     article_type: 'APTActivity'
   });
   ```

3. **Date Range Queries**
   ```typescript
   // Q4 2024 incidents
   const results = await searchEngine.searchArticles({
     start_date: '2024-10-01',
     end_date: '2024-12-31'
   });
   ```

4. **CISO Summaries**
   ```typescript
   // Get executive summaries only
   const results = await searchEngine.searchArticles(
     { severity_level: 'Critical' },
     { 
       return_fields: [
         'ciso_summary_key_points',
         'ciso_summary_actionable_takeaways'
       ]
     }
   );
   ```

## Expected Test Results

All tests should pass with:
- ✅ 50+ test cases
- ✅ 100% function coverage for SecuritySearchEngine
- ✅ All 6 MCP tools validated
- ✅ 10+ complete workflow scenarios
- ✅ Performance benchmarks met (<100ms for cached operations)

## Troubleshooting

### If tests fail:

1. **Module not found errors**:
   ```bash
   npm install
   ```

2. **TypeScript errors**:
   ```bash
   npm run type-check
   ```

3. **Vitest not found**:
   ```bash
   npm install -D vitest @vitest/coverage-v8
   ```

## CI/CD Integration

Add to your CI pipeline:

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm ci
      - run: npm test
      - run: npm run test:coverage
```

## Next Steps

1. Run tests locally: `npm test`
2. Review coverage report: `npm run test:coverage`
3. Add more test cases as needed
4. Integrate with CI/CD pipeline
5. Monitor test performance over time