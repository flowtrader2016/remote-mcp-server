#!/usr/bin/env node

/**
 * Script to verify the MCP server deployment is working correctly
 * Checks R2 data, Worker status, and MCP connectivity
 */

const { execSync } = require('child_process');
const https = require('https');

const CHECKS = {
  R2_LOCAL: false,
  R2_REMOTE: false,
  WORKER_DEPLOYED: false,
  WORKER_RESPONSIVE: false,
  MCP_CONNECTABLE: false
};

function runCommand(command) {
  try {
    return execSync(command, { encoding: 'utf-8', stdio: 'pipe' });
  } catch (error) {
    return null;
  }
}

async function checkR2Local() {
  console.log('📦 Checking LOCAL R2 bucket...');
  const result = runCommand('npx wrangler r2 object get security-article-search-data/search_metadata.json --local --pipe 2>/dev/null | head -1');
  
  if (result && result.includes('generated_at')) {
    console.log('   ✅ Local R2 has metadata');
    CHECKS.R2_LOCAL = true;
  } else {
    console.log('   ⚠️  No metadata in local R2 (OK for production)');
  }
}

async function checkR2Remote() {
  console.log('📦 Checking REMOTE R2 bucket...');
  const result = runCommand('npx wrangler r2 object get security-article-search-data/search_metadata.json --remote --pipe 2>/dev/null | head -1');
  
  if (result && result.includes('generated_at')) {
    console.log('   ✅ Remote R2 has metadata');
    CHECKS.R2_REMOTE = true;
  } else {
    console.log('   ❌ No metadata in remote R2 - DEPLOYMENT WILL FAIL');
    console.log('   Fix: npm run upload-data');
  }
}

async function checkWorkerDeployment() {
  console.log('🌐 Checking Worker deployment...');
  
  // Get worker URL from wrangler
  const workerInfo = runCommand('npx wrangler deployments list 2>/dev/null | head -3');
  
  if (workerInfo && workerInfo.includes('remote-mcp-server')) {
    console.log('   ✅ Worker is deployed');
    CHECKS.WORKER_DEPLOYED = true;
    
    // Extract URL if possible
    const urlMatch = workerInfo.match(/https:\/\/[^\s]+workers\.dev/);
    if (urlMatch) {
      return urlMatch[0];
    }
  } else {
    console.log('   ❌ Worker not deployed');
    console.log('   Fix: npm run deploy');
  }
  
  return null;
}

async function checkWorkerResponse(url) {
  if (!url) {
    // Try to construct URL from account info
    const accountInfo = runCommand('npx wrangler whoami 2>/dev/null');
    if (accountInfo) {
      const accountMatch = accountInfo.match(/Account Name\s+│\s+([^│]+)/);
      if (accountMatch) {
        const accountName = accountMatch[1].trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
        url = `https://remote-mcp-server.${accountName}.workers.dev`;
      }
    }
  }
  
  if (!url) {
    console.log('🔗 Could not determine Worker URL');
    return null;
  }
  
  console.log(`🔗 Checking Worker at: ${url}`);
  
  return new Promise((resolve) => {
    https.get(url, (res) => {
      if (res.statusCode === 200) {
        console.log('   ✅ Worker is responsive');
        CHECKS.WORKER_RESPONSIVE = true;
        resolve(url);
      } else {
        console.log(`   ⚠️  Worker returned status ${res.statusCode}`);
        resolve(url);
      }
    }).on('error', (err) => {
      console.log('   ❌ Worker not reachable:', err.message);
      resolve(null);
    });
  });
}

async function checkMCPConnection(url) {
  if (!url) return;
  
  console.log('🔌 Checking MCP SSE endpoint...');
  const sseUrl = url + '/sse';
  
  return new Promise((resolve) => {
    https.get(sseUrl, (res) => {
      if (res.statusCode === 401 || res.statusCode === 403) {
        console.log('   ✅ MCP endpoint requires authentication (expected)');
        CHECKS.MCP_CONNECTABLE = true;
      } else if (res.statusCode === 200) {
        console.log('   ✅ MCP endpoint is accessible');
        CHECKS.MCP_CONNECTABLE = true;
      } else {
        console.log(`   ⚠️  MCP endpoint returned status ${res.statusCode}`);
      }
      resolve();
    }).on('error', (err) => {
      console.log('   ❌ MCP endpoint not reachable:', err.message);
      resolve();
    });
  });
}

async function printSummary(workerUrl) {
  console.log('\n' + '='.repeat(50));
  console.log('📊 DEPLOYMENT STATUS SUMMARY\n');
  
  const allChecks = Object.values(CHECKS);
  const passedChecks = allChecks.filter(c => c).length;
  
  console.log(`Overall: ${passedChecks}/${allChecks.length} checks passed\n`);
  
  if (CHECKS.R2_REMOTE && CHECKS.WORKER_DEPLOYED && CHECKS.MCP_CONNECTABLE) {
    console.log('✅ Your MCP server is fully deployed and ready!');
    
    if (workerUrl) {
      console.log('\n📝 Add to Claude Desktop config:');
      console.log(JSON.stringify({
        "mcpServers": {
          "security-search-remote": {
            "command": "npx",
            "args": [
              "mcp-remote",
              `${workerUrl}/sse`
            ]
          }
        }
      }, null, 2));
    }
  } else {
    console.log('⚠️  Deployment issues detected. See above for fixes.');
    
    if (!CHECKS.R2_REMOTE) {
      console.log('\n🔧 Critical: Upload data to remote R2:');
      console.log('   npm run upload-data');
    }
    
    if (!CHECKS.WORKER_DEPLOYED) {
      console.log('\n🔧 Critical: Deploy the Worker:');
      console.log('   npm run deploy');
    }
  }
  
  console.log('\n💡 Test with MCP Inspector:');
  console.log('   npx @modelcontextprotocol/inspector');
  console.log(`   URL: ${workerUrl || 'https://remote-mcp-server.your-account.workers.dev'}/sse`);
}

async function main() {
  console.log('🔍 MCP Server Deployment Verification\n');
  console.log('='.repeat(50) + '\n');
  
  await checkR2Local();
  await checkR2Remote();
  
  const workerUrl = await checkWorkerDeployment();
  const finalUrl = await checkWorkerResponse(workerUrl);
  await checkMCPConnection(finalUrl);
  
  await printSummary(finalUrl);
}

main().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});