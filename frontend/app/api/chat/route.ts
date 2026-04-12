/**
 * API Route: /api/chat
 *
 * Chat interface with LiteLLM orchestration for governance assistant
 *
 * Features:
 * - LiteLLM as orchestration layer
 * - Tool calling for read-only MCP tools
 * - Strict grounding in actual tool results (no hallucination)
 * - Authorization context passed to model
 * - Tools executed through existing /api/mcp/call route
 * - Temperature 0.0 for factual accuracy
 *
 * Allowed Tools (read-only):
 * - list_manageable_apps
 * - generate_app_activity_report
 * - generate_access_review_candidates
 * - get_tool_requirements
 * - list_available_tools_for_current_user
 *
 * Grounding Rules:
 * - Assistant may ONLY state facts from tool results
 * - No invented app names, user counts, or metrics
 * - Write operations explicitly marked as "not enabled in chat"
 * - Unavailable tools clearly distinguished from nonexistent tools
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { config } from '@/lib/config';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

// Read-only tools allowed in chat
const ALLOWED_TOOLS = [
  'list_manageable_apps',
  'generate_app_activity_report',
  'generate_access_review_candidates',
  'get_tool_requirements',
  'list_available_tools_for_current_user',
];

// Tool definitions for LiteLLM (OpenAI format)
const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'list_manageable_apps',
      description: 'List applications manageable in your current authorization scope (all apps for organization-wide access, owned apps for scoped access)',
      parameters: {
        type: 'object',
        properties: {
          includeInactive: {
            type: 'boolean',
            description: 'Include inactive applications (default: false)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_app_activity_report',
      description: 'Generate activity and audit reports from system logs for applications within your authorization scope',
      parameters: {
        type: 'object',
        properties: {
          appId: {
            type: 'string',
            description: 'Application ID (e.g., 0oa123456)',
          },
          days: {
            type: 'number',
            description: 'Number of days to include in report (default: 60, max: 90)',
          },
          includeDetails: {
            type: 'boolean',
            description: 'Include full event details (default: false)',
          },
        },
        required: ['appId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_access_review_candidates',
      description: 'Generate risk-ranked candidates for access review based on activity analysis within your authorization scope',
      parameters: {
        type: 'object',
        properties: {
          appId: {
            type: 'string',
            description: 'Application ID',
          },
          inactiveDays: {
            type: 'number',
            description: 'Number of days of inactivity to flag (default: 90)',
          },
        },
        required: ['appId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_tool_requirements',
      description: 'Get scope and capability requirements for a specific tool',
      parameters: {
        type: 'object',
        properties: {
          toolName: {
            type: 'string',
            description: 'Name of the tool to get requirements for',
          },
        },
        required: ['toolName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_available_tools_for_current_user',
      description: 'List all tools available to the current user based on authorization',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
];

/**
 * Execute tool through MCP server directly using session token
 */
async function executeTool(
  toolName: string,
  toolArgs: Record<string, unknown>,
  mcpAccessToken: string,
  mcpEndpoint: string
): Promise<string> {
  try {
    const response = await fetch(mcpEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mcpAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: toolName,
        arguments: toolArgs,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return JSON.stringify({
        error: true,
        message: `Tool execution failed: ${errorText.substring(0, 200)}`,
      });
    }

    const data = await response.json();

    if (data.content) {
      // Extract text content from MCP response
      const textContent = data.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');

      return textContent;
    }

    return JSON.stringify({ error: true, message: 'No result returned' });
  } catch (error) {
    return JSON.stringify({
      error: true,
      message: error instanceof Error ? error.message : 'Tool execution failed',
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log('[Chat] Starting chat request');

    // 1. Verify user has MCP access token
    const session = await getSession();

    if (!session.mcpAccessToken) {
      return NextResponse.json(
        {
          error: 'Not authenticated',
          message: 'Please complete the authentication flow first',
        },
        { status: 401 }
      );
    }

    // 2. Parse request
    const { messages } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        {
          error: 'Invalid request',
          message: 'Messages array is required',
        },
        { status: 400 }
      );
    }

    console.log('[Chat] Processing chat with', messages.length, 'messages');

    // 3. Build system message with strict grounding rules
    const systemMessage = {
      role: 'system',
      content: `You are an Okta Governance AI assistant. Your role is to help users understand their governance scope by calling tools and presenting the results.

Current User Context:
- User ID: ${session.userId || 'unknown'}
- User Email: ${session.userEmail || 'unknown'}

Available Tools in This Chat Interface:
- list_manageable_apps: List apps you can manage
- generate_app_activity_report: Generate activity reports for apps
- generate_access_review_candidates: Find users who should be reviewed for access removal
- get_tool_requirements: Get requirements for any tool
- list_available_tools_for_current_user: See all available tools

STRICT GROUNDING RULES (CRITICAL):
1. NEVER fabricate or invent specific details:
   - Do NOT make up application names, IDs, or counts
   - Do NOT invent user names, email addresses, or user counts
   - Do NOT create risk scores, inactive days, or activity metrics
   - Do NOT guess at data that was not explicitly returned by a tool

2. ONLY state facts that appear in tool results:
   - If a tool returns "3 applications", say exactly that - not "approximately 3" or "several"
   - If a tool returns specific app names, list only those names
   - If a tool returns no data, explicitly say "no data was returned"

3. When you don't have information:
   - Say "I don't have that information" or "I would need to call [tool name] to find that out"
   - NEVER fill in gaps with plausible-sounding data

4. For actions not in the available tools list:
   - If user asks about write operations (create, update, delete, assign, etc.), respond:
     "This action is not enabled in the chat assistant yet. You can use the main interface for write operations."
   - Do NOT claim a tool "doesn't exist" - it may exist but not be enabled in chat

5. For unavailable tools:
   - If a tool call fails with "not available for chat execution", say:
     "That tool is not enabled in this chat interface."
   - Do NOT speculate about why or invent authorization explanations

6. Response format:
   - Present tool results clearly and accurately
   - Use bullet points or lists for clarity
   - Quote exact counts, names, and IDs from tool output
   - If tool output is empty or unclear, say so explicitly

Remember: You are a data presentation layer, not a decision-making system. Stick to the facts.`,
    };

    // 4. Call LiteLLM (using OpenAI-compatible API)
    const litellmEndpoint = process.env.LITELLM_API_BASE;
    const litellmModel = process.env.LITELLM_MODEL;
    const litellmApiKey = process.env.LITELLM_API_KEY;

    if (!litellmEndpoint || !litellmModel) {
      console.error('[Chat] LiteLLM not configured:', {
        hasEndpoint: !!litellmEndpoint,
        hasModel: !!litellmModel,
        hasApiKey: !!litellmApiKey,
      });
      return NextResponse.json(
        {
          error: 'LiteLLM not configured',
          message: 'LITELLM_API_BASE and LITELLM_MODEL environment variables are required',
        },
        { status: 500 }
      );
    }

    console.log('[Chat] LiteLLM configuration:', {
      endpoint: litellmEndpoint,
      model: litellmModel,
      hasApiKey: !!litellmApiKey,
    });

    let allMessages = [systemMessage, ...messages];
    let toolCalls: ToolCall[] = [];
    let iterations = 0;
    const maxIterations = 5; // Prevent infinite loops

    // Tool calling loop
    while (iterations < maxIterations) {
      iterations++;

      console.log('[Chat] Calling LiteLLM (iteration', iterations, ')');

      let llmResponse;
      try {
        llmResponse = await fetch(`${litellmEndpoint}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(litellmApiKey && { Authorization: `Bearer ${litellmApiKey}` }),
          },
          body: JSON.stringify({
            model: litellmModel,
            messages: allMessages,
            tools: TOOL_DEFINITIONS,
            tool_choice: 'auto',
            temperature: 0.0, // Zero temperature for strict factual grounding
            max_tokens: 2000,
          }),
        });
      } catch (fetchError) {
        console.error('[Chat] LiteLLM connection failed:', {
          error: fetchError instanceof Error ? fetchError.message : 'Unknown error',
          endpoint: `${litellmEndpoint}/v1/chat/completions`,
        });
        return NextResponse.json(
          {
            error: 'LiteLLM connection failed',
            message: 'Unable to reach LLM endpoint. Please check LITELLM_API_BASE configuration.',
          },
          { status: 503 }
        );
      }

      if (!llmResponse.ok) {
        const errorText = await llmResponse.text();
        console.error('[Chat] LiteLLM error:', {
          status: llmResponse.status,
          statusText: llmResponse.statusText,
          error: errorText.substring(0, 200),
        });
        return NextResponse.json(
          {
            error: 'LLM request failed',
            message: 'Failed to get response from language model',
            status: llmResponse.status,
          },
          { status: llmResponse.status }
        );
      }

      const llmData = await llmResponse.json();
      const choice = llmData.choices?.[0];

      if (!choice) {
        return NextResponse.json(
          {
            error: 'Invalid LLM response',
            message: 'No response choice returned',
          },
          { status: 500 }
        );
      }

      const assistantMessage = choice.message;

      // Check if model wants to call tools
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        console.log('[Chat] Model requested', assistantMessage.tool_calls.length, 'tool calls');

        // Add assistant message with tool calls
        allMessages.push(assistantMessage);

        // Execute each tool call
        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments);

          console.log('[Chat] Executing tool:', toolName);

          // Validate tool is allowed in chat
          if (!ALLOWED_TOOLS.includes(toolName)) {
            console.error('[Chat] Tool not in chat allowlist:', toolName);

            // Provide specific error based on tool name pattern
            let errorMessage: string;
            if (toolName.startsWith('manage_') || toolName.startsWith('create_') || toolName === 'manage_app_entitlements' || toolName === 'manage_app_labels' || toolName === 'manage_app_bundles' || toolName === 'manage_app_campaigns' || toolName === 'create_delegated_access_request' || toolName === 'manage_app_workflows') {
              // Write operation - not enabled in chat
              errorMessage = `Tool '${toolName}' is not enabled in the chat assistant. Write operations must be performed through the main interface.`;
            } else {
              // Read operation or unknown - not in allowlist
              errorMessage = `Tool '${toolName}' is not enabled in this chat interface.`;
            }

            allMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({
                error: true,
                message: errorMessage,
              }),
            });
            continue;
          }

          // Execute tool through MCP server
          const toolResult = await executeTool(
            toolName,
            toolArgs,
            session.mcpAccessToken!,
            config.mcp.endpoints.toolsCall
          );

          // Add tool result to messages
          allMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResult,
          });
        }

        // Continue loop to get final response
        continue;
      }

      // No more tool calls - return final response
      console.log('[Chat] Returning final response:', {
        hasContent: !!assistantMessage.content,
        iterations,
      });

      return NextResponse.json({
        message: assistantMessage.content,
        toolCalls: toolCalls.length,
      });
    }

    // Max iterations reached
    console.error('[Chat] Max iterations reached:', maxIterations);
    return NextResponse.json(
      {
        error: 'Max iterations reached',
        message: 'Too many tool calls. Please try a simpler question.',
      },
      { status: 500 }
    );
  } catch (error) {
    console.error('[Chat] Error:', error);

    return NextResponse.json(
      {
        error: 'Chat failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
