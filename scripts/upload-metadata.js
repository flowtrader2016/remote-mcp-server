#!/usr/bin/env node

/**
 * Script to upload search_metadata.json to Cloudflare R2
 * 
 * Prerequisites:
 * 1. Create R2 bucket: npx wrangler r2 bucket create security-article-search-data
 * 2. Run this script: node scripts/upload-metadata.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function uploadMetadata() {
  console.log('📤 Uploading search metadata to R2...\n');
  
  const metadataPath = path.join(__dirname, '../../security_article_search_mcp/search_metadata.json');
  
  if (!fs.existsSync(metadataPath)) {
    console.error('❌ Error: search_metadata.json not found at:', metadataPath);
    console.log('Please ensure the file exists at the expected location.');
    process.exit(1);
  }
  
  const stats = fs.statSync(metadataPath);
  const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  
  console.log(`📊 File Details:`);
  console.log(`   Path: ${metadataPath}`);
  console.log(`   Size: ${fileSizeMB} MB\n`);
  
  try {
    console.log('🪣 Creating R2 bucket if it doesn\'t exist...');
    try {
      execSync('npx wrangler r2 bucket create security-article-search-data', { stdio: 'inherit' });
      console.log('✅ R2 bucket created successfully\n');
    } catch (e) {
      console.log('ℹ️  R2 bucket already exists or creation skipped\n');
    }
    
    console.log('⬆️  Uploading file to R2...');
    console.log('   📍 Uploading to REMOTE R2 (production)...');
    const uploadCommand = `npx wrangler r2 object put security-article-search-data/search_metadata.json --file="${metadataPath}" --remote`;
    
    execSync(uploadCommand, { stdio: 'inherit' });
    
    console.log('\n✅ Successfully uploaded search_metadata.json to R2!');
    console.log('\n📋 Next Steps:');
    console.log('   1. Run "npm run dev" to test locally');
    console.log('   2. Run "npm run deploy" to deploy to Cloudflare Workers');
    console.log('   3. Configure Claude Desktop with your Worker URL');
    
  } catch (error) {
    console.error('❌ Upload failed:', error.message);
    console.log('\n🔧 Troubleshooting:');
    console.log('   1. Ensure you are logged in: npx wrangler login');
    console.log('   2. Check your Cloudflare account has R2 enabled');
    console.log('   3. Verify the wrangler.jsonc configuration');
    process.exit(1);
  }
}

async function validateMetadata() {
  console.log('🔍 Validating metadata file...\n');
  
  const metadataPath = path.join(__dirname, '../../security_article_search_mcp/search_metadata.json');
  
  try {
    const content = fs.readFileSync(metadataPath, 'utf-8');
    const metadata = JSON.parse(content);
    
    console.log('📈 Metadata Statistics:');
    console.log(`   Total Articles: ${metadata.total_articles || metadata.articles?.length || 0}`);
    console.log(`   Generated At: ${metadata.generated_at || 'Unknown'}`);
    console.log(`   Last Update: ${metadata.last_update || 'Unknown'}`);
    
    if (metadata.articles && metadata.articles.length > 0) {
      const firstArticle = metadata.articles[0];
      const fields = Object.keys(firstArticle);
      console.log(`   Fields per Article: ${fields.length}`);
      console.log(`   Sample Fields: ${fields.slice(0, 5).join(', ')}...`);
    }
    
    console.log('\n✅ Metadata validation passed!\n');
    return true;
  } catch (error) {
    console.error('❌ Metadata validation failed:', error.message);
    return false;
  }
}

async function main() {
  console.log('🚀 Security Article Search MCP - R2 Upload Script\n');
  console.log('=' .repeat(50) + '\n');
  
  const isValid = await validateMetadata();
  
  if (!isValid) {
    console.log('Please fix the metadata file before uploading.');
    process.exit(1);
  }
  
  await uploadMetadata();
}

main().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});