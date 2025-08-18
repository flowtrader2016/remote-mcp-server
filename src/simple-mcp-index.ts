import { Container } from "@cloudflare/containers";
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

// Export with both names for compatibility
export class MCP_CONTAINER extends MCPContainer {}

/**
 * Simple MCP implementation that handles HTTP streaming
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    
    // Health check endpoint
    if (url.pathname === "/health") {
      try {
        // Get container instance through Durable Object stub
        const id = env.MCP_CONTAINER.idFromName("singleton");
        const container = env.MCP_CONTAINER.get(id);
        
        // Just check container health without loading data
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
        // Get container instance through Durable Object stub
        const id = env.MCP_CONTAINER.idFromName("singleton");
        const container = env.MCP_CONTAINER.get(id);
        
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
                  name: "get_workflow_instructions",
                  description: "START HERE - Get the correct workflow for searching security articles. Returns mandatory 3-step process that prevents failed searches.",
                  inputSchema: {
                    type: "object",
                    properties: {}
                  }
                },
                {
                  name: "show_searchable_fields",
                  description: "STEP 1: Discover all 40+ searchable fields in the database. Use this to understand what data is available for querying.",
                  inputSchema: {
                    type: "object",
                    properties: {}
                  }
                },
                {
                  name: "get_field_values",
                  description: "STEP 2: Get EXACT values for any field you want to filter on. Critical: Values are case-sensitive! Always use this before querying.",
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
                  description: "STEP 3: Search articles using exact values from step 2. Filters must use arrays even for single values, e.g., {'severity_level': ['Critical']}",
                  inputSchema: {
                    type: "object",
                    properties: {
                      filters: {
                        type: "object",
                        description: "Field-value pairs to filter by. Values must be arrays."
                      },
                      limit: {
                        type: "number",
                        description: "Maximum number of results (default 10)",
                        default: 10
                      },
                      since_date: {
                        type: "string",
                        description: "Filter articles published after this date (YYYY-MM-DD)"
                      },
                      summary_mode: {
                        type: "boolean",
                        description: "Return summaries only (default true)",
                        default: true
                      }
                    },
                    required: ["filters"]
                  }
                },
                {
                  name: "get_article_details",
                  description: "Get full details of a specific article by ID (from query results)",
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
                },
                {
                  name: "show_field_values",
                  description: "Alias for get_field_values - Get EXACT values for a field (for compatibility)",
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
          
          // Ensure container has data loaded before processing
          const containerHealth = await container.fetch(new Request("http://container/health"));
          const healthData = await containerHealth.json();
          
          if (healthData.articles === 0) {
            console.log("Loading data into container from R2...");
            // Get the R2 object
            const metadata = await env.SEARCH_DATA.get("search_metadata.json");
            if (metadata) {
              // Stream directly from R2 to Container without loading into Worker memory
              const stream = metadata.body;
              if (stream) {
                try {
                  const loadResponse = await container.fetch(new Request("http://container/load-data", {
                    method: "POST",
                    headers: { 
                      "Content-Type": "application/json",
                      "Content-Length": metadata.size?.toString() || "0"
                    },
                    body: stream  // Stream directly without parsing
                  }));
                  
                  if (!loadResponse.ok) {
                    let errorText = "";
                    try {
                      errorText = await loadResponse.text();
                    } catch (e) {
                      errorText = `Status ${loadResponse.status}`;
                    }
                    console.error("Failed to load data into container:", errorText);
                    
                    return new Response(JSON.stringify({
                      jsonrpc: "2.0",
                      id: body.id,
                      error: {
                        code: -32603,
                        message: `Failed to load data into container: ${errorText}`
                      }
                    }), {
                      headers: { "Content-Type": "application/json" }
                    });
                  }
                  
                  console.log("Data loaded successfully into container");
                } catch (loadError: any) {
                  console.error("Error loading data into container:", loadError);
                  return new Response(JSON.stringify({
                    jsonrpc: "2.0",
                    id: body.id,
                    error: {
                      code: -32603,
                      message: `Error loading data: ${loadError.message || String(loadError)}`
                    }
                  }), {
                    headers: { "Content-Type": "application/json" }
                  });
                }
              }
            } else {
              console.error("search_metadata.json not found in R2");
              return new Response(JSON.stringify({
                jsonrpc: "2.0",
                id: body.id,
                error: {
                  code: -32603,
                  message: "Data not found in R2 storage"
                }
              }), {
                headers: { "Content-Type": "application/json" }
              });
            }
          }
          
          // Handle get_workflow_instructions without calling container
          if (name === "get_workflow_instructions") {
            const workflowInstructions = {
              workflow: "MANDATORY 3-STEP WORKFLOW - DO NOT SKIP",
              steps: [
                {
                  step: 1,
                  tool: "show_searchable_fields()",
                  purpose: "Discover available fields and categories",
                  required: true
                },
                {
                  step: 2,
                  tool: "get_field_values('field_name')",
                  purpose: "Get EXACT values for any field you want to filter on",
                  note: "Case-sensitive! Use exact strings returned",
                  required: true
                },
                {
                  step: 3,
                  tool: "query_articles(filters={...})",
                  purpose: "Use exact values from step 2",
                  example: '{"severity_level": ["Critical"], "cloud_platforms": ["AWS"]}',
                  note: "Filter values MUST be arrays, even for single values",
                  required: true
                }
              ],
              critical_warning: "⚠️ Guessing field values will fail. Always use step 2 to get exact values.",
              example_sequence: {
                user_request: "Find critical AWS ransomware issues",
                assistant_actions: [
                  "1. show_searchable_fields() → see all fields",
                  "2. get_field_values('severity_level') → get ['Critical', 'High', ...]",
                  "3. get_field_values('cloud_platforms') → get ['AWS', 'Azure', ...]",
                  "4. get_field_values('threat_types') → get ['Ransomware', 'Malware', ...]",
                  "5. query_articles(filters={'severity_level':['Critical'], 'cloud_platforms':['AWS'], 'threat_types':['Ransomware']})"
                ]
              },
              common_mistakes: [
                "Skipping step 1 - leads to unknown field errors",
                "Guessing values instead of using step 2 - leads to no results",
                "Wrong case - 'critical' vs 'Critical'",
                "Passing string instead of array - 'AI' vs ['AI']",
                "Using non-existent parameters - only use filters, since_date, limit, summary_mode"
              ],
              next_step: "Run show_searchable_fields() to begin"
            };
            
            return new Response(JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(workflowInstructions, null, 2)
                  }
                ]
              }
            }), {
              headers: { "Content-Type": "application/json" }
            });
          }
          
          let containerResponse: Response;
          
          switch (name) {
            case "show_searchable_fields":
              containerResponse = await container.fetch(new Request("http://container/show_searchable_fields"));
              break;
              
            case "get_field_values":
            case "show_field_values":  // Alias for compatibility
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
            // Try to get error message from response body
            let errorMessage = `Container error: ${containerResponse.status}`;
            try {
              const errorText = await containerResponse.text();
              if (errorText) {
                errorMessage = `Container error: ${errorText}`;
              }
            } catch (e) {
              // If we can't read the error, use the status code
            }
            
            return new Response(JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              error: {
                code: -32603,
                message: errorMessage
              }
            }), {
              headers: { "Content-Type": "application/json" }
            });
          }
          
          // Try to parse JSON response, handle non-JSON responses
          let result;
          try {
            result = await containerResponse.json();
          } catch (jsonError) {
            // If response is not JSON, try to read as text
            let responseText = "";
            try {
              // Clone the response since we might have already consumed it
              responseText = await containerResponse.text();
            } catch (e) {
              responseText = "Unable to read response";
            }
            
            // Return error in proper JSON-RPC format
            return new Response(JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              error: {
                code: -32603,
                message: `Container returned non-JSON response: ${responseText}`
              }
            }), {
              headers: { "Content-Type": "application/json" }
            });
          }
          
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