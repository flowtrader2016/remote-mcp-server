import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { verifyAccessJWT } from "./access-auth";
import { Container, getRandom } from "@cloudflare/containers";

/**
 * MCP Container configuration
 */
export class MCPContainer extends Container {
  defaultPort = 3000;
  sleepAfter = "10m";
  instanceType = "standard";  // 4GB memory
  
  environment = {
    R2_PUBLIC_URL: "https://pub-7e17005f86444e028bc6c091baa4e227.r2.dev"
  };
}

/**
 * MCP Durable Object that handles SSE protocol and proxies to Container
 */
export class HybridMCP extends McpAgent {
  server = new McpServer({
    name: "Security Article Search",
    version: "1.0.0",
  });
  
  private container: any = null;

  async init() {
    // Get container instance for data processing
    this.container = getRandom(this.env.MCP_CONTAINER);
    
    // Register MCP tools that proxy to Container
    
    this.server.tool(
      "show_searchable_fields",
      {},
      async () => {
        try {
          const response = await this.container.fetch(
            new Request("http://container/show_searchable_fields")
          );
          
          if (!response.ok) {
            throw new Error(`Container error: ${response.status}`);
          }
          
          const result = await response.json();
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }]
          };
        }
      }
    );
    
    this.server.tool(
      "get_field_values",
      {
        field: z.string().describe("The field name to get values for"),
        search_term: z.string().optional().describe("Optional substring to filter values")
      },
      async ({ field, search_term }) => {
        try {
          const url = search_term 
            ? `http://container/get_field_values/${field}?search_term=${encodeURIComponent(search_term)}`
            : `http://container/get_field_values/${field}`;
            
          const response = await this.container.fetch(new Request(url));
          
          if (!response.ok) {
            throw new Error(`Container error: ${response.status}`);
          }
          
          const result = await response.json();
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }]
          };
        }
      }
    );
    
    this.server.tool(
      "query_articles",
      {
        filters: z.record(z.any()).describe("Field-value pairs to filter by"),
        limit: z.number().optional().describe("Maximum number of results (default 10)"),
        since_date: z.string().optional().describe("Filter articles published after this date (YYYY-MM-DD)"),
        summary_mode: z.boolean().optional().describe("Return summaries instead of full articles")
      },
      async (args) => {
        try {
          const response = await this.container.fetch(
            new Request("http://container/query_articles", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(args)
            })
          );
          
          if (!response.ok) {
            throw new Error(`Container error: ${response.status}`);
          }
          
          const result = await response.json();
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }]
          };
        }
      }
    );
    
    this.server.tool(
      "get_article_details",
      {
        article_id: z.string().describe("The article ID")
      },
      async ({ article_id }) => {
        try {
          const response = await this.container.fetch(
            new Request(`http://container/get_article_details/${article_id}`)
          );
          
          if (!response.ok) {
            throw new Error(`Container error: ${response.status}`);
          }
          
          const result = await response.json();
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }]
          };
        }
      }
    );
  }

  /**
   * Override fetch to add authentication check
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    // Health check (no auth)
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", hybrid: true }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // SSE endpoint - temporarily bypass auth for testing
    // TODO: Re-enable after service token is configured
    if (url.pathname === "/sse") {
      // const user = await verifyAccessJWT(request, this.env);
      // if (!user) {
      //   return new Response("Unauthorized", { status: 401 });
      // }
      console.log("SSE endpoint accessed - auth temporarily bypassed for testing");
    }
    
    // Let parent class handle MCP protocol
    return super.fetch(request);
  }
}

/**
 * Main Worker handler
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    // Health check endpoint (no auth required)
    if (url.pathname === "/health") {
      // Check container health
      const container = getRandom(env.MCP_CONTAINER);
      try {
        const containerHealth = await container.fetch(new Request("http://container/health"));
        const healthData = await containerHealth.json();
        return new Response(JSON.stringify({ 
          status: "ok", 
          worker: true,
          container: healthData
        }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (error) {
        return new Response(JSON.stringify({ 
          status: "ok", 
          worker: true,
          container: { status: "error", message: String(error) }
        }), {
          headers: { "Content-Type": "application/json" }
        });
      }
    }
    
    // Home page (auth-aware)
    if (url.pathname === "/") {
      const user = await verifyAccessJWT(request, env);
      
      if (user) {
        return new Response(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>MCP Security Search Server</title>
            <style>
              body { font-family: system-ui; padding: 2rem; max-width: 800px; margin: 0 auto; }
              .status { padding: 1rem; background: #10b981; color: white; border-radius: 0.5rem; margin: 1rem 0; }
              pre { background: #f3f4f6; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; }
              .info { background: #eff6ff; padding: 1rem; border-radius: 0.5rem; margin: 1rem 0; }
            </style>
          </head>
          <body>
            <h1>🔐 MCP Security Search Server</h1>
            <div class="status">
              ✅ Authenticated as: ${user.email || user.sub}
            </div>
            
            <h2>Architecture</h2>
            <div class="info">
              <strong>Hybrid Architecture:</strong>
              <ul>
                <li>Worker handles MCP protocol (SSE)</li>
                <li>Container processes data (4GB memory)</li>
                <li>R2 storage for metadata</li>
                <li>Smart caching throughout</li>
              </ul>
            </div>
            
            <h2>Claude Desktop Configuration</h2>
            <p>Add this to your Claude Desktop config:</p>
            <pre>
"security-search-remote": {
  "command": "npx",
  "args": ["mcp-remote", "https://remote-mcp-server.nick-simo.workers.dev/sse"]
}
            </pre>
            
            <h2>Available Tools</h2>
            <ul>
              <li>show_searchable_fields() - List all searchable fields</li>
              <li>get_field_values(field) - Get values for a field</li>
              <li>query_articles(filters) - Search articles</li>
              <li>get_article_details(article_id) - Get full article</li>
            </ul>
          </body>
          </html>
        `, {
          headers: { "Content-Type": "text/html" }
        });
      }
      
      return new Response(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>MCP Security Search Server - Access Required</title>
          <style>
            body { font-family: system-ui; padding: 2rem; max-width: 600px; margin: 0 auto; }
            .status { padding: 1rem; background: #ef4444; color: white; border-radius: 0.5rem; }
          </style>
        </head>
        <body>
          <h1>MCP Security Search Server</h1>
          <div class="status">
            🔒 Authentication Required
          </div>
          <p>This MCP server is protected by Cloudflare Access.</p>
        </body>
        </html>
      `, {
        headers: { "Content-Type": "text/html" }
      });
    }
    
    // All other paths go to the MCP Durable Object
    const id = env.HYBRID_MCP.idFromName("singleton");
    const stub = env.HYBRID_MCP.get(id);
    return stub.fetch(request);
  }
};