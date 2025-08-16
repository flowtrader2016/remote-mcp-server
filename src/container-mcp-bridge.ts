import { verifyAccessJWT } from "./access-auth";

/**
 * SSE-to-HTTP Bridge for MCP Protocol
 * Handles SSE connections from Claude Desktop and translates to Container HTTP calls
 */
export async function handleSSEEndpoint(request: Request, env: Env, container: any): Promise<Response> {
  // Verify authentication
  // Check if service token headers are present
  const clientId = request.headers.get('CF-Access-Client-Id');
  const clientSecret = request.headers.get('CF-Access-Client-Secret');
  
  if (clientId === '2dbe8ab597f81c3308530d3e61691765.access' && 
      clientSecret === '2932b4b3f043c1560893d78735f6b3682cc1b5a6c284ad4226e4ca09c453a34a') {
    // Valid service token - allow access
    console.log('Authenticated via service token');
  } else {
    // Check for JWT from browser auth
    const user = await verifyAccessJWT(request, env);
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  // Create SSE response stream
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Send SSE headers
  const headers = new Headers({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  // Handle incoming SSE messages
  const handleRequest = async () => {
    try {
      // Parse the JSON body directly (not SSE format in request)
      const message = await request.json();
      console.log('Received MCP message:', message);
              
              // Handle different message types
              if (message.method === 'initialize') {
                // Send initialization response
                const response = {
                  jsonrpc: "2.0",
                  id: message.id,
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
                await writer.write(encoder.encode(`data: ${JSON.stringify(response)}\n\n`));
              } else if (message.method === 'tools/list') {
                // Return available tools
                const response = {
                  jsonrpc: "2.0",
                  id: message.id,
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
                await writer.write(encoder.encode(`data: ${JSON.stringify(response)}\n\n`));
              } else if (message.method === 'tools/call') {
                // Proxy tool calls to Container
                const { name, arguments: args } = message.params;
                
                try {
                  // First check if container has data loaded
                  const healthCheck = await container.fetch(new Request("http://container/health"));
                  const healthData = await healthCheck.json();
                  
                  if (healthData.articles === 0) {
                    console.log("Container has no data, loading from R2...");
                    
                    // Get data from R2 through Worker binding
                    const r2Object = await env.SEARCH_DATA.get("search_metadata.json");
                    if (r2Object) {
                      // Stream the data to container
                      const loadResponse = await container.fetch(new Request("http://container/load-data", {
                        method: "POST",
                        headers: { 
                          "Content-Type": "application/json",
                          "Content-Length": r2Object.size?.toString() || "0"
                        },
                        body: r2Object.body
                      }));
                      
                      if (!loadResponse.ok) {
                        throw new Error(`Failed to load data into container: ${await loadResponse.text()}`);
                      }
                      console.log("Data loaded successfully into container");
                    } else {
                      throw new Error("search_metadata.json not found in R2");
                    }
                  }
                  
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
                      throw new Error(`Unknown tool: ${name}`);
                  }
                  
                  if (!containerResponse.ok) {
                    throw new Error(`Container returned ${containerResponse.status}: ${await containerResponse.text()}`);
                  }
                  
                  const result = await containerResponse.json();
                  
                  const response = {
                    jsonrpc: "2.0",
                    id: message.id,
                    result: {
                      content: [
                        {
                          type: "text",
                          text: JSON.stringify(result, null, 2)
                        }
                      ]
                    }
                  };
                  
                  await writer.write(encoder.encode(`data: ${JSON.stringify(response)}\n\n`));
                  
                } catch (error: any) {
                  const errorResponse = {
                    jsonrpc: "2.0",
                    id: message.id,
                    error: {
                      code: -32603,
                      message: `Error calling container: ${error.message}`
                    }
                  };
                  await writer.write(encoder.encode(`data: ${JSON.stringify(errorResponse)}\n\n`));
                }
              }
    } catch (error) {
      console.error("SSE handler error:", error);
      const errorResponse = {
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: `Internal error: ${error.message}`
        }
      };
      await writer.write(encoder.encode(`data: ${JSON.stringify(errorResponse)}\n\n`));
    } finally {
      await writer.close();
    }
  };

  // Start handling requests in background
  handleRequest();

  return new Response(readable, { headers });
}