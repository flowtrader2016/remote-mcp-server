import app from "./app";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { verifyAccessJWT } from "./access-auth";
import { SecuritySearchEngine } from "./security-search";

export class MyMCP extends McpAgent {
	server = new McpServer({
		name: "Security Article Search",
		version: "1.0.0",
	});
	
	private searchEngine: SecuritySearchEngine | null = null;

	async init() {
		this.searchEngine = new SecuritySearchEngine(this.env);
		
		this.server.tool(
			"get_workflow_instructions",
			{},
			async () => {
				const instructions = {
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
						"Jumping straight to query_articles() without preparation",
						"Using non-existent parameters - only use filters, since_date, limit, summary_mode"
					],
					next_step: "Run show_searchable_fields() to begin"
				};
				
				return {
					content: [{ type: "text", text: JSON.stringify(instructions, null, 2) }]
				};
			}
		);
		
		this.server.tool(
			"show_searchable_fields",
			{},
			async () => {
				try {
					const fields = await this.searchEngine!.getSearchableFields();
					return {
						content: [{ type: "text", text: JSON.stringify(fields, null, 2) }]
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
				field_name: z.string().describe("The field to explore"),
				search_term: z.string().optional().describe("Optional substring to filter values")
			},
			async ({ field_name, search_term }) => {
				try {
					if (!field_name || !field_name.trim()) {
						return {
							content: [{ 
								type: "text", 
								text: JSON.stringify({
									error: "field_name is required",
									tip: "Use show_searchable_fields() to see all available field names."
								}, null, 2)
							}]
						};
					}
					
					console.log(`Getting field values for: ${field_name}, search_term: ${search_term}`);
					const values = await this.searchEngine!.getFieldValues(field_name.trim(), search_term);
					console.log(`Got ${Object.keys(values.values_with_counts || {}).length} values`);
					return {
						content: [{ type: "text", text: JSON.stringify(values, null, 2) }]
					};
				} catch (error: any) {
					console.error(`Error in get_field_values: ${error.message}`, error);
					return {
						content: [{ 
							type: "text", 
							text: JSON.stringify({
								error: `Field '${field_name}' not found or invalid: ${error.message}`,
								tip: "Use show_searchable_fields() to see all available field names."
							}, null, 2)
						}]
					};
				}
			}
		);
		
		this.server.tool(
			"show_field_values",
			{
				field_name: z.string().describe("The field to explore"),
				search_term: z.string().optional().describe("Optional substring to filter values")
			},
			async ({ field_name, search_term }) => {
				try {
					const values = await this.searchEngine!.getFieldValues(field_name.trim(), search_term);
					return {
						content: [{ type: "text", text: JSON.stringify(values, null, 2) }]
					};
				} catch (error: any) {
					return {
						content: [{ 
							type: "text", 
							text: JSON.stringify({
								error: `Field '${field_name}' not found: ${error.message}`
							}, null, 2)
						}]
					};
				}
			}
		);
		
		this.server.tool(
			"query_articles",
			{
				filters: z.record(z.array(z.string())).optional().describe("Field filters using exact values"),
				since_date: z.string().optional().describe("YYYY-MM-DD format to filter articles on/after this date"),
				limit: z.number().min(1).max(1000).default(30).describe("Number of results to return"),
				summary_mode: z.boolean().default(true).describe("True for summaries, false for full details")
			},
			async ({ filters, since_date, limit, summary_mode }) => {
				try {
					if (since_date) {
						const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
						if (!dateRegex.test(since_date)) {
							return {
								content: [{ 
									type: "text", 
									text: JSON.stringify({
										error: `Invalid date format: ${since_date}`,
										required_format: "YYYY-MM-DD"
									}, null, 2)
								}]
							};
						}
					}
					
					const results = await this.searchEngine!.searchArticles(
						filters,
						since_date,
						limit,
						summary_mode
					);
					
					const response = {
						metadata: {
							mode: summary_mode ? "summary" : "detailed",
							total_results: Array.isArray(results) ? results.length : 0,
							search_parameters: {
								filters,
								since_date,
								limit
							}
						},
						articles: results
					};
					
					if (summary_mode) {
						response.metadata['next_step'] = "Use get_article_details(article_id) for full information.";
					}
					
					return {
						content: [{ type: "text", text: JSON.stringify(response, null, 2) }]
					};
				} catch (error: any) {
					return {
						content: [{ 
							type: "text", 
							text: JSON.stringify({
								error: `Query failed: ${error.message}`,
								tip: "Verify field names and values using show_searchable_fields() and get_field_values()."
							}, null, 2)
						}]
					};
				}
			}
		);
		
		this.server.tool(
			"get_article_details",
			{
				article_id: z.string().describe("The unique article identifier from query results")
			},
			async ({ article_id }) => {
				try {
					if (!article_id || !article_id.trim()) {
						return {
							content: [{ 
								type: "text", 
								text: JSON.stringify({ error: "article_id is required" }, null, 2)
							}]
						};
					}
					
					const article = await this.searchEngine!.getArticleDetails(article_id.trim());
					
					return {
						content: [{ 
							type: "text", 
							text: JSON.stringify({
								metadata: {
									article_id: article_id,
									mode: "full_details"
								},
								article
							}, null, 2)
						}]
					};
				} catch (error: any) {
					return {
						content: [{ 
							type: "text", 
							text: JSON.stringify({
								error: `Failed to get article details: ${error.message}`
							}, null, 2)
						}]
					};
				}
			}
		);
	}
}

// Create a wrapper for the SSE endpoint with Access authentication
const sseHandler = async (request: Request, env: Env, ctx: ExecutionContext) => {
	// Check Access authentication
	const user = await verifyAccessJWT(request, env);
	
	if (!user) {
		return new Response('Unauthorized - Please authenticate through Cloudflare Access', { 
			status: 401,
			headers: {
				'Content-Type': 'text/plain'
			}
		});
	}
	
	// If authenticated, pass to the MCP handler
	const mcpHandler = MyMCP.mount("/sse");
	return mcpHandler(request, env, ctx);
};

// Export the main handler
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		
		// Handle SSE endpoint with authentication
		if (url.pathname === "/sse") {
			return sseHandler(request, env, ctx);
		}
		
		// Handle all other routes with the app
		return app.fetch(request, env, ctx);
	}
};
