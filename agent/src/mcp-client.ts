/**
 * MCP Client — calls the governance MCP server over HTTP JSON-RPC.
 *
 * Handles tool discovery (tools/list) and tool invocation (tools/call).
 * The MCP server filters tools based on the caller's OAuth token scopes.
 */

import fetch from "node-fetch";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export class McpClient {
  private baseUrl: string;
  private accessToken?: string;

  constructor(baseUrl: string, accessToken?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.accessToken = accessToken;
  }

  setAccessToken(token: string) {
    this.accessToken = token;
  }

  private async jsonRpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const body = {
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    };

    const resp = await fetch(`${this.baseUrl}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`MCP ${method} failed: ${resp.status} ${text}`);
    }

    const data = (await resp.json()) as { result?: unknown; error?: { message: string } };
    if (data.error) {
      throw new Error(`MCP error: ${data.error.message}`);
    }
    return data.result;
  }

  async initialize(): Promise<void> {
    await this.jsonRpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "okta-governance-agent", version: "1.0.0" },
    });
  }

  async listTools(): Promise<McpTool[]> {
    const result = (await this.jsonRpc("tools/list")) as { tools: McpTool[] };
    return result.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const result = (await this.jsonRpc("tools/call", { name, arguments: args })) as McpToolResult;
    return result;
  }
}
