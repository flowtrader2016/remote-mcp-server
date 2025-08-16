import { Container, getRandom } from "@cloudflare/containers";
import { verifyAccessJWT } from "./access-auth";

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
 * Simple MCP implementation that handles HTTP streaming
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    // Health check endpoint
    if (url.pathname === "/health") {
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
    
    // SSE endpoint for MCP - handle as HTTP streaming
    if (url.pathname === "/sse" && request.method === "POST") {
      // Skip auth for testing
      // const user = await verifyAccessJWT(request, env);
      // if (!user) {
      //   return new Response("Unauthorized", { status: 401 });
      // }
      
      try {
        const body = await request.json();
        const container = getRandom(env.MCP_CONTAINER);
        
        // Handle MCP protocol messages
        if (body.method === "initialize") {
          const response = {
            jsonrpc: "2.0",
            id: body.id,
            result: {
              protocolVersion: "2025-06-18",
              capabilities: {
                tools: {}
              },
              serverInfo: {
                name: "security-search-remote",
                version: "1.0.0"
              }
            }
          };
          
          return new Response(JSON.stringify(response), {
            headers: { 
              "Content-Type": "application/json",
              "Transfer-Encoding": "chunked"
            }
          });
        }
        
        if (body.method === "tools/list") {
          const response = {
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [
                {
                  name: "show_searchable_fields",
                  description: "Show all searchable fields and their descriptions",
                  inputSchema: {
                    type: "object",
                    properties: {}
                  }
                },
                {
                  name: "get_field_values",
                  description: "Get all unique values for a specific field",
                  inputSchema: {
                    type: "object",
                    properties: {
                      field: {
                        type: "string",
                        description: "The field name to get values for"
                      }
                    },
                    required: ["field"]
                  }
                },
                {
                  name: "query_articles",
                  description: "Search for security articles using field filters",
                  inputSchema: {
                    type: "object",
                    properties: {
                      filters: {
                        type: "object",
                        description: "Field-value pairs to filter by"
                      },
                      limit: {
                        type: "number",
                        description: "Maximum number of results (default 10)",
                        default: 10
                      }
                    },
                    required: ["filters"]
                  }
                },
                {
                  name: "get_article_details",
                  description: "Get full details of a specific article by ID",
                  inputSchema: {
                    type: "object",
                    properties: {
                      article_id: {
                        type: "string",
                        description: "The article ID"
                      }
                    },
                    required: ["article_id"]
                  }
                }
              ]
            }
          };
          
          return new Response(JSON.stringify(response), {
            headers: { 
              "Content-Type": "application/json",
              "Transfer-Encoding": "chunked"
            }
          });
        }
        
        if (body.method === "tools/call") {
          const { name, arguments: args } = body.params;
          
          let containerResponse: Response;
          
          switch (name) {
            case "show_searchable_fields":
              containerResponse = await container.fetch(new Request("http://container/show_searchable_fields"));
              break;
              
            case "get_field_values":
              containerResponse = await container.fetch(new Request(`http://container/get_field_values/${args.field}`));
              break;
              
            case "query_articles":
              containerResponse = await container.fetch(new Request("http://container/query_articles", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(args)
              }));
              break;
              
            case "get_article_details":
              containerResponse = await container.fetch(new Request(`http://container/get_article_details/${args.article_id}`));
              break;
              
            default:
              return new Response(JSON.stringify({
                jsonrpc: "2.0",
                id: body.id,
                error: {
                  code: -32601,
                  message: `Unknown tool: ${name}`
                }
              }), {
                headers: { "Content-Type": "application/json" }
              });
          }
          
          if (!containerResponse.ok) {
            return new Response(JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              error: {
                code: -32603,
                message: `Container error: ${containerResponse.status}`
              }
            }), {
              headers: { "Content-Type": "application/json" }
            });
          }
          
          const result = await containerResponse.json();
          
          const response = {
            jsonrpc: "2.0",
            id: body.id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result, null, 2)
                }
              ]
            }
          };
          
          return new Response(JSON.stringify(response), {
            headers: { 
              "Content-Type": "application/json",
              "Transfer-Encoding": "chunked"
            }
          });
        }
        
        // Unknown method
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          error: {
            code: -32601,
            message: `Method not found: ${body.method}`
          }
        }), {
          headers: { "Content-Type": "application/json" }
        });
        
      } catch (error: any) {
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32700,
            message: `Parse error: ${error.message}`
          }
        }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
    
    // Home page
    if (url.pathname === "/") {
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
            ✅ Server Running (Auth Temporarily Disabled for Testing)
          </div>
          
          <h2>Architecture</h2>
          <div class="info">
            <strong>Simple HTTP + Container Architecture:</strong>
            <ul>
              <li>Worker handles MCP protocol (HTTP POST)</li>
              <li>Container processes data (4GB memory)</li>
              <li>R2 storage for metadata</li>
              <li>No WebSocket complexity</li>
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
    
    return new Response("Not Found", { status: 404 });
  }
};