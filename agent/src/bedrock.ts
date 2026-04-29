/**
 * Bedrock Claude client — handles the agentic loop with tool use.
 *
 * Stateless per-request design: conversation history is passed in and
 * returned (stored in the caller's session, not here). The MCP token
 * is set per-request so different users get different tool access.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type ContentBlock,
  type ToolConfiguration,
  type Tool,
} from "@aws-sdk/client-bedrock-runtime";
import type { McpClient, McpTool } from "./mcp-client.js";

const MODEL_ID = process.env.BEDROCK_MODEL_ID || "anthropic.claude-sonnet-4-6";
const AWS_REGION = process.env.AWS_REGION || "us-west-2";

const SYSTEM_PROMPT = `You are an AI governance assistant for Okta Identity Governance. You help managers and administrators with:

1. **Access Review & Certification** — Identify inactive users, generate review candidates, analyze app activity. Help managers understand who has access and whether it's still needed.

2. **Access Suggestions & Role Mining** — Analyze access patterns across users in similar roles/departments. Suggest appropriate access levels for new users based on their peers. Identify outlier access that deviates from the norm.

3. **Access Management** — Help with access requests, group membership changes, and delegated administration. Guide users through the proper channels for requesting or revoking access.

4. **App Governance** — Assess the overall access structure of applications. Identify over-provisioned users, unused entitlements, and opportunities to tighten security posture.

When analyzing data, be specific with numbers and names. Present findings in clear tables when appropriate. Always explain the "why" behind your recommendations. If you need to look up a user or app first, do so before making recommendations.

When you don't have enough information, ask clarifying questions rather than guessing.`;

export interface ChatResult {
  response: string;
  history: Message[];
}

export class GovernanceAgent {
  private bedrock: BedrockRuntimeClient;
  private mcpClient: McpClient;
  private tools: McpTool[] = [];
  private toolConfig: ToolConfiguration | undefined;

  constructor(mcpClient: McpClient) {
    this.bedrock = new BedrockRuntimeClient({ region: AWS_REGION });
    this.mcpClient = mcpClient;
  }

  async initialize(): Promise<void> {
    await this.mcpClient.initialize();
    this.tools = await this.mcpClient.listTools();
    this.toolConfig = this.buildToolConfig();
    console.log(`Agent initialized with ${this.tools.length} MCP tools`);
  }

  private buildToolConfig(): ToolConfiguration | undefined {
    if (this.tools.length === 0) return undefined;
    const tools = this.tools.map((t) => ({
      toolSpec: {
        name: t.name,
        description: t.description,
        inputSchema: { json: t.inputSchema },
      },
    }));
    return { tools: tools as Tool[] };
  }

  /**
   * Chat with the agent. Stateless: caller provides history and gets
   * updated history back. Token is set per-request for user isolation.
   */
  async chat(
    userMessage: string,
    history: Message[],
    accessToken?: string,
  ): Promise<ChatResult> {
    // Set the token for this request's MCP calls
    if (accessToken) {
      this.mcpClient.setAccessToken(accessToken);
    }

    // Clone history to avoid mutating the caller's array mid-loop
    const messages = [...history];

    // Add user message
    messages.push({
      role: "user",
      content: [{ text: userMessage }],
    });

    // Agentic loop
    let iterations = 0;
    const maxIterations = 10;

    while (iterations < maxIterations) {
      iterations++;

      const command = new ConverseCommand({
        modelId: MODEL_ID,
        system: [{ text: SYSTEM_PROMPT }],
        messages,
        toolConfig: this.toolConfig,
      });

      const response = await this.bedrock.send(command);
      const stopReason = response.stopReason;
      const outputContent = response.output?.message?.content || [];

      // Add assistant response
      messages.push({ role: "assistant", content: outputContent });

      // Tool use — execute and continue
      if (stopReason === "tool_use") {
        const toolResults: ContentBlock[] = [];

        for (const block of outputContent) {
          if (block.toolUse) {
            const { toolUseId, name, input } = block.toolUse;
            console.log(`  Tool: ${name}(${JSON.stringify(input).substring(0, 100)})`);

            try {
              const result = await this.mcpClient.callTool(
                name!,
                (input as Record<string, unknown>) || {}
              );
              const resultText = result.content.map((c) => c.text).join("\n");

              toolResults.push({
                toolResult: {
                  toolUseId: toolUseId!,
                  content: [{ text: resultText }],
                  status: result.isError ? "error" : "success",
                },
              });
            } catch (err) {
              toolResults.push({
                toolResult: {
                  toolUseId: toolUseId!,
                  content: [{ text: `Error: ${err}` }],
                  status: "error",
                },
              });
            }
          }
        }

        messages.push({ role: "user", content: toolResults });
        continue;
      }

      // Final text response
      const textParts = outputContent
        .filter((b): b is ContentBlock & { text: string } => "text" in b && typeof b.text === "string")
        .map((b) => b.text);

      return {
        response: textParts.join("\n") || "(No response)",
        history: messages,
      };
    }

    return {
      response: "(Agent reached maximum iterations without a final response)",
      history: messages,
    };
  }

  getToolCount(): number {
    return this.tools.length;
  }

  getToolNames(): string[] {
    return this.tools.map((t) => t.name);
  }
}
