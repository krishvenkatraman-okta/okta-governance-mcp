/**
 * Bedrock Claude client — handles the agentic loop with tool use.
 *
 * Sends messages to Claude via Bedrock, handles tool_use responses by
 * calling the MCP server, and feeds results back until Claude produces
 * a final text response.
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

When you don't have enough information, ask clarifying questions rather than guessing.

## Generating Custom Certification UIs

When the user asks you to build, create, or show a dashboard/view/UI for their certification reviews, generate custom HTML that will be rendered in a dashboard panel. The user's cert review data will be included in the message as JSON context.

**How to generate a UI:** Wrap your generated HTML in special markers:
<!--CERT_UI_START-->
(your HTML here)
<!--CERT_UI_END-->

The HTML renders inside an iframe with these available:
- \`certData\` — JavaScript variable with the full cert review JSON
- \`approveItem(reviewId, itemId)\` — function to approve an item
- \`revokeItem(reviewId, itemId)\` — function to revoke an item (prompts for justification)

**Rules for generated HTML:**
- Include all CSS inline via <style> tags (no external stylesheets)
- Use modern, clean design: rounded corners, shadows, color-coded risk levels
- Risk colors: LOW=#22c55e, MEDIUM=#f59e0b, HIGH=#ef4444, CRITICAL=#7c3aed
- Include approve/revoke buttons that call the provided JavaScript functions
- Use \`data-item="itemId"\` attributes on action buttons for status feedback
- Parse the \`certData\` variable in a <script> tag to render dynamically
- Make the UI responsive and professional-looking

**Example styles the user might request:**
- Table view with sortable columns
- Kanban board (columns: Pending, Approved, Revoked)
- Card grid grouped by department or risk level
- Summary dashboard with stats cards at top + detail table below
- Timeline view showing access grant dates

Always confirm what you built in the chat message alongside the UI.`;

export class GovernanceAgent {
  private bedrock: BedrockRuntimeClient;
  private mcpClient: McpClient;
  private tools: McpTool[] = [];
  private conversationHistory: Message[] = [];

  constructor(mcpClient: McpClient) {
    this.bedrock = new BedrockRuntimeClient({ region: AWS_REGION });
    this.mcpClient = mcpClient;
  }

  async initialize(): Promise<void> {
    await this.mcpClient.initialize();
    this.tools = await this.mcpClient.listTools();
    console.log(`Agent initialized with ${this.tools.length} MCP tools`);
  }

  private getToolConfig(): ToolConfiguration {
    const tools = this.tools.map((t) => ({
      toolSpec: {
        name: t.name,
        description: t.description,
        inputSchema: {
          json: t.inputSchema,
        },
      },
    }));
    return { tools: tools as Tool[] };
  }

  async chat(userMessage: string): Promise<string> {
    // Add user message to history
    this.conversationHistory.push({
      role: "user",
      content: [{ text: userMessage }],
    });

    // Agentic loop — keep going until we get a final text response
    let iterations = 0;
    const maxIterations = 10;

    while (iterations < maxIterations) {
      iterations++;

      const command = new ConverseCommand({
        modelId: MODEL_ID,
        system: [{ text: SYSTEM_PROMPT }],
        messages: this.conversationHistory,
        toolConfig: this.tools.length > 0 ? this.getToolConfig() : undefined,
      });

      const response = await this.bedrock.send(command);
      const stopReason = response.stopReason;
      const outputContent = response.output?.message?.content || [];

      // Add assistant response to history
      this.conversationHistory.push({
        role: "assistant",
        content: outputContent,
      });

      // If the model wants to use tools, execute them
      if (stopReason === "tool_use") {
        const toolResults: ContentBlock[] = [];

        for (const block of outputContent) {
          if (block.toolUse) {
            const { toolUseId, name, input } = block.toolUse;
            console.log(`  Tool call: ${name}(${JSON.stringify(input).substring(0, 100)}...)`);

            try {
              const result = await this.mcpClient.callTool(
                name!,
                (input as Record<string, unknown>) || {}
              );
              const resultText = result.content
                .map((c) => c.text)
                .join("\n");

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

        // Add tool results as a user message and continue the loop
        this.conversationHistory.push({
          role: "user",
          content: toolResults,
        });

        continue;
      }

      // Model produced a final response — extract text
      const textParts = outputContent
        .filter((b): b is ContentBlock & { text: string } => "text" in b && typeof b.text === "string")
        .map((b) => b.text);

      return textParts.join("\n") || "(No response)";
    }

    return "(Agent reached maximum iterations without a final response)";
  }

  updateMcpToken(token: string): void {
    this.mcpClient.setAccessToken(token);
  }

  resetConversation(): void {
    this.conversationHistory = [];
  }

  getToolCount(): number {
    return this.tools.length;
  }

  getToolNames(): string[] {
    return this.tools.map((t) => t.name);
  }
}
