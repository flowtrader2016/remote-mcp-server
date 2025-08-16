import { Hono } from "hono";
import { verifyAccessJWT } from "./access-auth";

export type Bindings = Env;

const app = new Hono<{
	Bindings: Bindings;
}>();

// Basic homepage with auth status
app.get("/", async (c) => {
	const user = await verifyAccessJWT(c.req.raw, c.env);
	
	if (user) {
		return c.html(`
			<!DOCTYPE html>
			<html>
			<head>
				<title>MCP Security Search Server</title>
				<style>
					body { font-family: system-ui; padding: 2rem; max-width: 600px; margin: 0 auto; }
					.status { padding: 1rem; background: #10b981; color: white; border-radius: 0.5rem; }
				</style>
			</head>
			<body>
				<h1>MCP Security Search Server</h1>
				<div class="status">
					✅ Authenticated as: ${user.email || user.sub}
				</div>
				<p>You have access to the MCP server. Configure your Claude Desktop with:</p>
				<pre style="background: #f3f4f6; padding: 1rem; border-radius: 0.5rem; overflow-x: auto;">
"security-search-remote": {
  "command": "npx",
  "args": ["mcp-remote", "https://remote-mcp-server.nick-simo.workers.dev/sse"]
}
				</pre>
			</body>
			</html>
		`);
	}
	
	return c.html(`
		<!DOCTYPE html>
		<html>
		<head>
			<title>MCP Security Search Server - Access Required</title>
			<style>
				body { font-family: system-ui; padding: 2rem; max-width: 600px; margin: 0 auto; }
				.status { padding: 1rem; background: #ef4444; color: white; border-radius: 0.5rem; }
				a { color: #3b82f6; }
			</style>
		</head>
		<body>
			<h1>MCP Security Search Server</h1>
			<div class="status">
				🔒 Authentication Required
			</div>
			<p>This MCP server is protected by Cloudflare Access.</p>
			<p>You need to authenticate through Cloudflare Access to use this server.</p>
		</body>
		</html>
	`);
});

// Health check endpoint
app.get("/health", async (c) => {
	const user = await verifyAccessJWT(c.req.raw, c.env);
	return c.json({
		status: "ok",
		authenticated: !!user,
		user: user ? { email: user.email, sub: user.sub } : null
	});
});

export default app;
