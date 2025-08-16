import { Container, getContainer, getRandom } from "@cloudflare/containers";
import { verifyAccessJWT } from "./access-auth";
import { handleSSEEndpoint } from "./container-mcp-bridge";

/**
 * MCP Container configuration
 */
export class MCPContainer extends Container {
  defaultPort = 3000;  // Port the Express server runs on
  sleepAfter = "10m";  // Stop container after 10 minutes of inactivity
  instanceType = "standard";  // 4GB memory instance
  
  // Pass R2 URL as environment variable
  environment = {
    R2_PUBLIC_URL: "https://pub-7e17005f86444e028bc6c091baa4e227.r2.dev"
  };
}

/**
 * Main Worker handler
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    // Health check endpoint (no auth required)
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", worker: true }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // SSE endpoint for MCP protocol (Claude Desktop)
    if (url.pathname === "/sse") {
      // Get container instance for proxying
      const container = getRandom(env.MCP_CONTAINER);
      return handleSSEEndpoint(request, env, container);
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
              <strong>Container-based Architecture:</strong>
              <ul>
                <li>4GB memory Container for data processing</li>
                <li>R2 storage for metadata persistence</li>
                <li>Smart caching (in-memory + disk)</li>
                <li>Auto-scales based on demand</li>
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
            
            <h2>API Endpoints</h2>
            <ul>
              <li>GET /show_searchable_fields</li>
              <li>GET /get_field_values/:field</li>
              <li>POST /query_articles</li>
              <li>GET /get_article_details/:id</li>
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
    
    // API endpoints (excluding /health and /) require authentication
    if (url.pathname !== "/health" && url.pathname !== "/") {
      const user = await verifyAccessJWT(request, env);
      if (!user) {
        return new Response("Unauthorized", { status: 401 });
      }
    }
    
    // Get or create a container instance
    // Using getRandom() for load balancing across multiple instances
    const container = getRandom(env.MCP_CONTAINER);
    
    // Forward the request to the container
    // The container runs the Express server with all MCP endpoints
    return container.fetch(request);
  }
};