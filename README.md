# Security Article Search MCP Server on Cloudflare

A remote MCP server that provides access to 4000+ security articles with advanced search capabilities, deployed on Cloudflare Workers with OAuth authentication.

## Features

- 🔍 **Advanced Search**: Query 4000+ security articles across 40+ fields
- 🛡️ **OAuth Authentication**: Secure access with Cloudflare OAuth Provider  
- ☁️ **Cloudflare R2 Storage**: Efficient storage for large metadata
- 🚀 **6 Powerful Tools**:
  - `get_workflow_instructions`: Learn the correct search workflow
  - `show_searchable_fields`: Discover all searchable fields
  - `get_field_values`: Get exact field values for filtering
  - `query_articles`: Search articles with complex filters
  - `get_article_details`: Get full article information
  - `show_field_values`: Compatibility alias for field values

## Prerequisites

- Node.js 18+ installed
- Cloudflare account with Workers and R2 enabled
- Wrangler CLI (`npm install -g wrangler`)
- The original `search_metadata.json` file from your Python MCP

## Setup & Installation

```bash
# 1. Install dependencies
npm install

# 2. Login to Cloudflare
npx wrangler login

# 3. Upload metadata to R2 (creates bucket automatically)
npm run setup

# 4. Run locally for testing
npm run dev
```

You should be able to open [`http://localhost:8787/`](http://localhost:8787/) in your browser

## Connect the MCP inspector to your server

To explore your new MCP api, you can use the [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector).

- Start it with `npx @modelcontextprotocol/inspector`
- [Within the inspector](http://localhost:5173), switch the Transport Type to `SSE` and enter `http://localhost:8787/sse` as the URL of the MCP server to connect to, and click "Connect"
- You will navigate to a (mock) user/password login screen. Input any email and pass to login.
- You should be redirected back to the MCP Inspector and you can now list and call any defined tools!

<div align="center">
  <img src="img/mcp-inspector-sse-config.png" alt="MCP Inspector with the above config" width="600"/>
</div>

<div align="center">
  <img src="img/mcp-inspector-successful-tool-call.png" alt="MCP Inspector with after a tool call" width="600"/>
</div>

## Connect Claude Desktop to your local MCP server

The MCP inspector is great, but we really want to connect this to Claude! Follow [Anthropic's Quickstart](https://modelcontextprotocol.io/quickstart/user) and within Claude Desktop go to Settings > Developer > Edit Config to find your configuration file.

Open the file in your text editor and replace it with this configuration:

```json
{
  "mcpServers": {
    "security-search": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:8787/sse"
      ]
    }
  }
}
```

This will run a local proxy and let Claude talk to your MCP server over HTTP

When you open Claude a browser window should open and allow you to login. You should see the tools available in the bottom right. Given the right prompt Claude should ask to call the tool.

<div align="center">
  <img src="img/available-tools.png" alt="Clicking on the hammer icon shows a list of available tools" width="600"/>
</div>

<div align="center">
  <img src="img/claude-does-math-the-fancy-way.png" alt="Claude answers the prompt 'I seem to have lost my calculator and have run out of fingers. Could you use the math tool to add 23 and 19?' by invoking the MCP add tool" width="600"/>
</div>

## Deploy to Cloudflare

```bash
# 1. Create KV namespace for OAuth (if not already created)
npx wrangler kv namespace create OAUTH_KV
# Update the ID in wrangler.jsonc if needed

# 2. Ensure R2 bucket exists and data is uploaded
npm run upload-data

# 3. Deploy to Cloudflare Workers
npm run deploy
```

After deployment, you'll receive a URL like: `https://security-article-search-mcp.<your-subdomain>.workers.dev`

## Call your newly deployed remote MCP server from a remote MCP client

Just like you did above in "Develop locally", run the MCP inspector:

`npx @modelcontextprotocol/inspector@latest`

Then enter the `workers.dev` URL (ex: `worker-name.account-name.workers.dev/sse`) of your Worker in the inspector as the URL of the MCP server to connect to, and click "Connect".

You've now connected to your MCP server from a remote MCP client.

## Connect Claude Desktop to your remote MCP server

Update the Claude configuration file to point to your `workers.dev` URL and restart Claude.

**IMPORTANT**: 
- Use `mcp-remote` (NOT `@cloudflare/mcp-server-cloudflare`)
- Replace `your-account` with your actual Cloudflare account name
- Remove any local Python MCP configs to avoid duplicate tools

```json
{
  "mcpServers": {
    "security-search-remote": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://remote-mcp-server.your-account.workers.dev/sse"
      ]
    }
  }
}
```

## Debugging

Should anything go wrong it can be helpful to restart Claude, or to try connecting directly to your
MCP server on the command line with the following command.

```bash
npx mcp-remote http://localhost:8787/sse
```

In some rare cases it may help to clear the files added to `~/.mcp-auth`

```bash
rm -rf ~/.mcp-auth
```
