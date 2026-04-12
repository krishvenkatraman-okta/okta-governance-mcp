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

/**
 * Pre-router helper: Extract appId pattern from user message
 */
function extractAppId(message: string): string | null {
  const appIdMatch = message.match(/\b(0oa[a-zA-Z0-9]+)\b/);
  return appIdMatch ? appIdMatch[1] : null;
}

/**
 * Pre-router helper: Resolve app name to appId from tool result
 * Uses fuzzy matching: exact → partial → normalized
 */
function resolveAppByName(
  appName: string,
  toolResult: string
): { appId: string | null; matches: string[]; appNames: string[] } {
  try {
    console.log('[DEBUG] Raw app query:', appName);
    console.log('[DEBUG] Raw tool result (first 500 chars):', toolResult.substring(0, 500));

    // Parse tool result - handle different response structures
    let parsed: any;
    try {
      parsed = JSON.parse(toolResult);
    } catch (parseError) {
      console.error('[DEBUG] JSON parse failed:', parseError);
      return { appId: null, matches: [], appNames: [] };
    }

    // Extract apps array from various possible structures
    let apps: any[] = [];
    if (Array.isArray(parsed)) {
      apps = parsed;
    } else if (parsed.apps && Array.isArray(parsed.apps)) {
      apps = parsed.apps;
    } else if (parsed.applications && Array.isArray(parsed.applications)) {
      apps = parsed.applications;
    } else if (parsed.items && Array.isArray(parsed.items)) {
      apps = parsed.items;
    } else if (parsed.data && Array.isArray(parsed.data)) {
      apps = parsed.data;
    } else {
      console.error('[DEBUG] Could not find apps array in parsed result. Keys:', Object.keys(parsed));
      return { appId: null, matches: [], appNames: [] };
    }

    console.log('[DEBUG] Parsed apps array length:', apps.length);
    console.log('[DEBUG] First 3 apps:', apps.slice(0, 3));

    if (apps.length === 0) {
      console.log('[DEBUG] Apps array is empty');
      return { appId: null, matches: [], appNames: [] };
    }

    // Sanitize app name: trim and strip quotes
    const sanitizedAppName = appName
      .trim()
      .replace(/^["']|["']$/g, '');

    console.log('[DEBUG] Sanitized app query:', sanitizedAppName);

    const normalize = (s: string) =>
      s.toLowerCase().replace(/[._\s-]/g, '');

    const normalizedInput = normalize(sanitizedAppName);

    // Try matching strategies in order of specificity
    let matchedApps: any[] = [];

    // 1. Exact label match
    matchedApps = apps.filter((app: any) => app.label === sanitizedAppName);
    if (matchedApps.length === 1) {
      console.log('[DEBUG] Match found (exact label):', matchedApps[0].label);
      return {
        appId: matchedApps[0].id,
        matches: [matchedApps[0].label],
        appNames: [],
      };
    }

    // 2. Exact internal name match
    matchedApps = apps.filter((app: any) => app.name === sanitizedAppName);
    if (matchedApps.length === 1) {
      console.log('[DEBUG] Match found (exact name):', matchedApps[0].label);
      return {
        appId: matchedApps[0].id,
        matches: [matchedApps[0].label],
        appNames: [],
      };
    }

    // 3. Case-insensitive partial label match
    const lowerAppName = sanitizedAppName.toLowerCase();
    matchedApps = apps.filter((app: any) =>
      (app.label || '').toLowerCase().includes(lowerAppName)
    );
    if (matchedApps.length === 1) {
      console.log('[DEBUG] Match found (partial label):', matchedApps[0].label);
      return {
        appId: matchedApps[0].id,
        matches: [matchedApps[0].label],
        appNames: [],
      };
    }

    // 4. Case-insensitive partial internal name match
    matchedApps = apps.filter((app: any) =>
      (app.name || '').toLowerCase().includes(lowerAppName)
    );
    if (matchedApps.length === 1) {
      console.log('[DEBUG] Match found (partial name):', matchedApps[0].label);
      return {
        appId: matchedApps[0].id,
        matches: [matchedApps[0].label],
        appNames: [],
      };
    }

    // 5. Normalized comparison (removes punctuation, dots, underscores, spaces)
    matchedApps = apps.filter((app: any) => {
      const normalizedLabel = normalize(app.label || '');
      const normalizedName = normalize(app.name || '');
      return (
        normalizedLabel.includes(normalizedInput) ||
        normalizedName.includes(normalizedInput)
      );
    });

    if (matchedApps.length === 1) {
      console.log('[DEBUG] Match found (normalized):', matchedApps[0].label);
      return {
        appId: matchedApps[0].id,
        matches: [matchedApps[0].label],
        appNames: [],
      };
    } else if (matchedApps.length > 1) {
      console.log('[DEBUG] Multiple matches found:', matchedApps.length);
      return {
        appId: null,
        matches: [],
        appNames: matchedApps.map((app: any) => app.label),
      };
    }

    console.log('[DEBUG] No matches found after all strategies');
    return { appId: null, matches: [], appNames: [] };
  } catch (error) {
    console.error('[DEBUG] Error in resolveAppByName:', error);
    return { appId: null, matches: [], appNames: [] };
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

    // 3. Deterministic pre-router for app-specific governance requests
    const latestUserMessage = messages[messages.length - 1];
    const userText =
      typeof latestUserMessage?.content === 'string'
        ? latestUserMessage.content
        : '';
    const lowerText = userText.toLowerCase();

    // Check for tool discovery patterns
    const isToolDiscovery =
      lowerText.includes('list all available tools') ||
      lowerText.includes('what tools are available') ||
      lowerText.includes('show my governance tools') ||
      lowerText.includes('what can i do') ||
      (lowerText.includes('available tools') && lowerText.includes('list'));

    if (isToolDiscovery) {
      console.log('[Chat] Pre-router detected tool discovery request');

      const toolResult = await executeTool(
        'list_available_tools_for_current_user',
        {},
        session.mcpAccessToken!,
        config.mcp.endpoints.toolsCall
      );

      return NextResponse.json({
        message: toolResult,
        toolCalls: 1,
      });
    }

    // Check for activity report or access review patterns
    const isActivityReport =
      lowerText.includes('activity report') || lowerText.includes('show activity');
    const isAccessReview =
      lowerText.includes('access review') ||
      lowerText.includes('inactive users') ||
      lowerText.includes('review candidates');

    if (isActivityReport || isAccessReview) {
      console.log('[Chat] Pre-router detected governance request');

      // Extract or resolve appId
      let appId = extractAppId(userText);
      let resolvedAppName: string | null = null;

      if (!appId) {
        // No direct appId - need to resolve by name
        // Extract app name (simple heuristic: text after "for")
        const forMatch = userText.match(/for\s+([^.?!]+)/i);
        if (forMatch) {
          const candidateAppName = forMatch[1].trim();
          console.log('[Chat] Resolving app name:', candidateAppName);

          // Call list_manageable_apps
          const appsResult = await executeTool(
            'list_manageable_apps',
            {},
            session.mcpAccessToken!,
            config.mcp.endpoints.toolsCall
          );

          const { appId: resolved, matches, appNames } = resolveAppByName(
            candidateAppName,
            appsResult
          );

          if (resolved) {
            appId = resolved;
            resolvedAppName = matches[0];
            console.log('[Chat] Resolved to appId:', appId);
          } else if (appNames.length > 1) {
            // Multiple matches - clarification needed
            return NextResponse.json({
              message: `Multiple applications match "${candidateAppName}":\n${appNames.map((n) => `- ${n}`).join('\n')}\n\nPlease specify which application you mean.`,
            });
          } else {
            // No match
            return NextResponse.json({
              message: `No matching application was found for "${candidateAppName}".`,
            });
          }
        }
      }

      if (appId) {
        // Route directly to appropriate tool
        const toolName = isActivityReport
          ? 'generate_app_activity_report'
          : 'generate_access_review_candidates';

        console.log('[Chat] Pre-router calling tool:', toolName, 'with appId:', appId);

        const toolResult = await executeTool(
          toolName,
          { appId },
          session.mcpAccessToken!,
          config.mcp.endpoints.toolsCall
        );

        // Return tool result directly
        const resultMessage = resolvedAppName
          ? `Results for ${resolvedAppName} (${appId}):\n\n${toolResult}`
          : toolResult;

        return NextResponse.json({
          message: resultMessage,
          toolCalls: 1,
        });
      }
    }

    // 4. Build system message with mandatory tool-based grounding
    const systemMessage = {
      role: 'system',
      content: `You are an Okta Governance AI assistant.

Your ONLY responsibility is to:
1. Decide which MCP tool to call
2. Call the tool
3. Return ONLY tool results

You are NOT allowed to answer from memory.

════════════════════════════════════════
CRITICAL TOOL CALLING BEHAVIOR
════════════════════════════════════════

You MUST call a tool for ANY request involving:
- apps
- applications
- users
- access
- activity
- reports
- governance
- review
- risk

If the user provides an appId (starts with "0oa"):
→ CALL TOOL DIRECTLY

If the user provides an app name:
→ FIRST call list_manageable_apps
→ FIND matching app
→ THEN call appropriate tool

════════════════════════════════════════
TOOL SELECTION RULES (STRICT)
════════════════════════════════════════

1. LIST APPS

User: "What apps can I manage?"
→ CALL: list_manageable_apps

User: "List my applications"
→ CALL: list_manageable_apps


2. ACTIVITY REPORT (APP ID)

User: "Generate activity report for 0oa123"
→ CALL: generate_app_activity_report({ appId: "0oa123" })

User: "Show activity for 0oa123"
→ CALL: generate_app_activity_report({ appId: "0oa123" })


3. ACTIVITY REPORT (APP NAME)

User: "Generate activity report for ServiceNow"
Step 1: CALL list_manageable_apps
Step 2: find matching app
Step 3: CALL generate_app_activity_report({ appId })


4. ACCESS REVIEW

User: "Show inactive users for 0oa123"
→ CALL: generate_access_review_candidates({ appId: "0oa123" })

User: "Access review for Salesforce"
→ CALL: generate_access_review_candidates({ appId })


════════════════════════════════════════
ABSOLUTE RULES (NO EXCEPTIONS)
════════════════════════════════════════

- NEVER generate application names
- NEVER generate user data
- NEVER generate counts
- NEVER guess appId
- NEVER answer without tool call

If you do not call a tool → your response is INVALID.

If you cannot determine which tool → respond EXACTLY:
"I cannot determine which tool to call."

════════════════════════════════════════
RESPONSE FORMAT
════════════════════════════════════════

When calling tool:
→ ONLY return tool call

After tool response:
→ ONLY summarize tool result
→ DO NOT add new data

Current User Context:
- User ID: ${session.userId || 'unknown'}
- User Email: ${session.userEmail || 'unknown'}

Available Tools:
- list_manageable_apps
- generate_app_activity_report
- generate_access_review_candidates
- get_tool_requirements
- list_available_tools_for_current_user`,
    };

    // 5. Call LiteLLM (using OpenAI-compatible API)
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
    let toolExecuted = false;

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

const userMessage = messages[messages.length - 1];
const userText =
  typeof userMessage?.content === 'string' ? userMessage.content : '';

if (
  (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) &&
  requiresTool(userText) &&
  !toolExecuted
) {
  console.error('[Chat] BLOCKED: LLM attempted to answer without tool call', {
    userText,
  });

  return NextResponse.json(
    {
      error: 'Ungrounded response blocked',
      message: 'I cannot provide this information without calling the appropriate tool.',
    },
    { status: 400 }
  );
}

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
          toolExecuted = true;

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
function requiresTool(userMessage: string): boolean {
  const msg = userMessage.toLowerCase();

  return (
    msg.includes('list') ||
    msg.includes('show') ||
    msg.includes('get') ||
    msg.includes('generate') ||
    msg.includes('apps can i manage') ||
    msg.includes('manageable apps') ||
    msg.includes('activity report') ||
    msg.includes('access review') ||
    msg.includes('inactive users') ||
    msg.includes('risk') ||
    msg.includes('how many') ||
    msg.includes('count') ||
    msg.includes('details of') ||
    msg.includes('report for')
  );
}
