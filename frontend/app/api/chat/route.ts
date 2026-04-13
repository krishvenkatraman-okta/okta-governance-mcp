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
 * Detect if a tool response indicates stub/mock implementation
 * Returns true if the response is not a real execution
 */
function isStubResponse(toolResult: string): boolean {
  const lowerResult = toolResult.toLowerCase();
  const stubIndicators = [
    'not implemented',
    'not yet implemented',
    'stub',
    'mock',
    'placeholder',
    'coming soon',
    'not available',
    'not enabled',
  ];

  return stubIndicators.some(indicator => lowerResult.includes(indicator));
}

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
): {
  appId: string | null;
  matches: string[];
  appNames: string[];
  candidateApps: Array<{ id: string; label: string; name: string }>;
} {
  try {
    console.log('[DEBUG] Raw app query:', appName);
    console.log('[DEBUG] Raw tool result (first 500 chars):', toolResult.substring(0, 500));

    // Parse tool result - handle different response structures
    let parsed: any;
    try {
      parsed = JSON.parse(toolResult);
    } catch (parseError) {
      console.error('[DEBUG] JSON parse failed:', parseError);
      return { appId: null, matches: [], appNames: [], candidateApps: [] };
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
      return { appId: null, matches: [], appNames: [], candidateApps: [] };
    }

    console.log('[DEBUG] Parsed apps array length:', apps.length);
    console.log('[DEBUG] First 3 apps:', apps.slice(0, 3));

    if (apps.length === 0) {
      console.log('[DEBUG] Apps array is empty');
      return { appId: null, matches: [], appNames: [], candidateApps: [] };
    }

    // Sanitize app name: trim and strip quotes
    const sanitizedAppName = appName.trim().replace(/^["']|["']$/g, '');

    console.log('[DEBUG] ═══════════════════════════════════════════════════════');
    console.log('[DEBUG] 🔬 APP NAME RESOLUTION DIAGNOSTIC');
    console.log('[DEBUG] ═══════════════════════════════════════════════════════');
    console.log('[DEBUG] Raw input:', appName);
    console.log('[DEBUG] Sanitized:', sanitizedAppName);
    console.log('[DEBUG] Search length:', sanitizedAppName.length, 'characters');
    console.log('[DEBUG] Total apps available:', apps.length);

    // ========== DEBUG: Show all available apps ==========
    console.log('[DEBUG] 🔍 ALL AVAILABLE APPS IN LIST:');
    apps.forEach((app: any, idx: number) => {
      console.log(`[DEBUG]   ${idx + 1}. label="${app.label}" name="${app.name}" id="${app.id}"`);
    });
    console.log(`[DEBUG] 🎯 SEARCHING FOR: "${sanitizedAppName}"`);
    console.log('[DEBUG] ========================================');

    // ========== DEBUG: Show apps containing search substring ==========
    const searchKeyword = sanitizedAppName.toLowerCase().split(/[\s.]+/)[0]; // Extract first word
    const relatedApps = apps.filter((app: any) =>
      (app.label || '').toLowerCase().includes(searchKeyword)
    );
    if (relatedApps.length > 0) {
      console.log(`[DEBUG] 📋 Apps containing "${searchKeyword}":`);
      relatedApps.forEach((app: any, idx: number) => {
        console.log(`[DEBUG]   ${idx + 1}. label="${app.label}"`);
        console.log(`[DEBUG]      name="${app.name}"`);
        console.log(`[DEBUG]      Exact label match? ${app.label === sanitizedAppName ? '✅ YES' : '❌ NO'}`);
        console.log(`[DEBUG]      Case-insensitive label match? ${(app.label || '').toLowerCase() === sanitizedAppName.toLowerCase() ? '✅ YES' : '❌ NO'}`);
      });
      console.log('[DEBUG] ========================================');
    }

    // ========== EXACT MATCHING STRATEGIES (HIGH PRIORITY) ==========

    let matchedApps: any[] = [];

    // Strategy 1: Exact label match (case-sensitive)
    console.log('[DEBUG] 🔍 Strategy 1: Exact label match (case-sensitive)');
    console.log(`[DEBUG]    Comparing: app.label === "${sanitizedAppName}"`);
    matchedApps = apps.filter((app: any) => app.label === sanitizedAppName);
    console.log(`[DEBUG]    Result: ${matchedApps.length} matches`);
    if (matchedApps.length === 1) {
      console.log('[DEBUG] ✅ SUCCESS - Found exact match:', matchedApps[0].label);
      return {
        appId: matchedApps[0].id,
        matches: [matchedApps[0].label],
        appNames: [],
        candidateApps: [],
      };
    }
    if (matchedApps.length > 1) {
      console.log('[DEBUG] ⚠️ MULTIPLE EXACT MATCHES FOUND:');
      matchedApps.forEach((app: any, idx: number) => {
        console.log(`[DEBUG]      ${idx + 1}. "${app.label}" (id: ${app.id})`);
      });
      console.log('[DEBUG] ❌ Returning ambiguity - user must choose');
      return {
        appId: null,
        matches: [],
        appNames: matchedApps.map((app: any) => app.label),
        candidateApps: matchedApps.map((app: any) => ({
          id: app.id,
          label: app.label,
          name: app.name,
        })),
      };
    }
    console.log('[DEBUG] ❌ Strategy 1 failed: No exact label match, continuing...');

    // Strategy 2: Exact name match (case-sensitive)
    console.log('[DEBUG] Trying exact name match (case-sensitive)...');
    matchedApps = apps.filter((app: any) => app.name === sanitizedAppName);
    console.log(`[DEBUG] Strategy 2 result: ${matchedApps.length} matches`);
    if (matchedApps.length === 1) {
      console.log('[DEBUG] ✅ Match found (exact name):', matchedApps[0].label);
      return {
        appId: matchedApps[0].id,
        matches: [matchedApps[0].label],
        appNames: [],
        candidateApps: [],
      };
    }
    if (matchedApps.length > 1) {
      console.log('[DEBUG] Multiple exact name matches:', matchedApps.map((a: any) => a.label));
      return {
        appId: null,
        matches: [],
        appNames: matchedApps.map((app: any) => app.label),
        candidateApps: matchedApps.map((app: any) => ({
          id: app.id,
          label: app.label,
          name: app.name,
        })),
      };
    }
    console.log('[DEBUG] Strategy 2: No exact name match, continuing...');

    // Strategy 3: Exact label match (case-INsensitive)
    console.log('[DEBUG] Trying exact label match (case-insensitive)...');
    matchedApps = apps.filter((app: any) =>
      (app.label || '').toLowerCase() === sanitizedAppName.toLowerCase()
    );
    console.log(`[DEBUG] Strategy 3 result: ${matchedApps.length} matches`);
    if (matchedApps.length === 1) {
      console.log('[DEBUG] ✅ Match found (exact label, case-insensitive):', matchedApps[0].label);
      return {
        appId: matchedApps[0].id,
        matches: [matchedApps[0].label],
        appNames: [],
        candidateApps: [],
      };
    }
    if (matchedApps.length > 1) {
      console.log('[DEBUG] Multiple exact label matches (case-insensitive):', matchedApps.map((a: any) => a.label));
      return {
        appId: null,
        matches: [],
        appNames: matchedApps.map((app: any) => app.label),
        candidateApps: matchedApps.map((app: any) => ({
          id: app.id,
          label: app.label,
          name: app.name,
        })),
      };
    }
    console.log('[DEBUG] Strategy 3: No exact label match (case-insensitive), continuing...');

    // Strategy 4: Exact name match (case-INsensitive) - ONLY if input looks like an app name
    // Skip this strategy if input looks like a label (has uppercase or spaces)
    // App names are typically lowercase with underscores (e.g., "salesforce", "box_admin")
    const looksLikeAppName =
      sanitizedAppName === sanitizedAppName.toLowerCase() && // All lowercase
      !sanitizedAppName.includes(' '); // No spaces

    if (looksLikeAppName) {
      console.log('[DEBUG] 🔍 Strategy 4: Exact name match (case-insensitive)');
      console.log('[DEBUG]    Input looks like an app name (lowercase, no spaces)');
      console.log(`[DEBUG]    Comparing: app.name.toLowerCase() === "${sanitizedAppName.toLowerCase()}"`);
      matchedApps = apps.filter((app: any) =>
        (app.name || '').toLowerCase() === sanitizedAppName.toLowerCase()
      );
      console.log(`[DEBUG]    Result: ${matchedApps.length} matches`);
      if (matchedApps.length === 1) {
        console.log('[DEBUG] ✅ SUCCESS - Found exact name match:', matchedApps[0].label);
        return {
          appId: matchedApps[0].id,
          matches: [matchedApps[0].label],
          appNames: [],
          candidateApps: [],
        };
      }
      if (matchedApps.length > 1) {
        console.log('[DEBUG] ⚠️ MULTIPLE EXACT NAME MATCHES:');
        matchedApps.forEach((app: any, idx: number) => {
          console.log(`[DEBUG]      ${idx + 1}. "${app.label}" (name: ${app.name})`);
        });
        return {
          appId: null,
          matches: [],
          appNames: matchedApps.map((app: any) => app.label),
          candidateApps: matchedApps.map((app: any) => ({
            id: app.id,
            label: app.label,
            name: app.name,
          })),
        };
      }
      console.log('[DEBUG] ❌ Strategy 4 failed: No exact name match');
    } else {
      console.log('[DEBUG] ⏭️  Strategy 4: SKIPPED');
      console.log('[DEBUG]    Reason: Input looks like a LABEL, not an app name');
      console.log(`[DEBUG]    - Has uppercase? ${sanitizedAppName !== sanitizedAppName.toLowerCase() ? '✅ YES' : '❌ NO'}`);
      console.log(`[DEBUG]    - Has spaces? ${sanitizedAppName.includes(' ') ? '✅ YES' : '❌ NO'}`);
      console.log('[DEBUG]    App names are typically lowercase with underscores (e.g., "salesforce", "box_admin")');
      console.log('[DEBUG]    Skipping name matching to avoid false matches');
    }

    // ========== PARTIAL MATCHING STRATEGIES (LOWER PRIORITY) ==========

    console.log('[DEBUG] ⚠️ ALL EXACT MATCHING STRATEGIES FAILED');
    console.log('[DEBUG] Exact match strategies tried:');
    console.log('[DEBUG]   1. Exact label (case-sensitive): 0 matches');
    console.log('[DEBUG]   2. Exact name (case-sensitive): 0 matches');
    console.log('[DEBUG]   3. Exact label (case-insensitive): 0 matches');
    console.log('[DEBUG]   4. Exact name (case-insensitive): 0 matches');
    console.log('[DEBUG] Now falling back to PARTIAL matching...');
    console.log('[DEBUG] ========================================');

    // Strategy 5: Case-insensitive partial label match (ONLY if exact didn't match)
    console.log('[DEBUG] 🔍 Strategy 5: Partial label match (case-insensitive)');
    const lowerAppName = sanitizedAppName.toLowerCase();
    console.log(`[DEBUG]    Comparing: app.label.toLowerCase().includes("${lowerAppName}")`);
    matchedApps = apps.filter((app: any) =>
      (app.label || '').toLowerCase().includes(lowerAppName)
    );
    console.log(`[DEBUG]    Result: ${matchedApps.length} matches`);
    if (matchedApps.length === 1) {
      console.log('[DEBUG] ✅ SUCCESS - Found partial match:', matchedApps[0].label);
      return {
        appId: matchedApps[0].id,
        matches: [matchedApps[0].label],
        appNames: [],
        candidateApps: [],
      };
    }
    if (matchedApps.length > 1) {
      console.log('[DEBUG] ⚠️ MULTIPLE PARTIAL MATCHES FOUND:');
      matchedApps.forEach((app: any, idx: number) => {
        console.log(`[DEBUG]      ${idx + 1}. "${app.label}"`);
        console.log(`[DEBUG]         Why matched: "${app.label.toLowerCase()}" contains "${lowerAppName}"`);
      });
      console.log('[DEBUG] ❌ Returning ambiguity - this is likely the problem!');
      console.log('[DEBUG] DIAGNOSIS: Partial matching is too greedy. Search term matches multiple apps.');
      return {
        appId: null,
        matches: [],
        appNames: matchedApps.map((app: any) => app.label),
        candidateApps: matchedApps.map((app: any) => ({
          id: app.id,
          label: app.label,
          name: app.name,
        })),
      };
    }

    // Strategy 6: Case-insensitive partial internal name match
    console.log('[DEBUG] Trying partial name match...');
    matchedApps = apps.filter((app: any) =>
      (app.name || '').toLowerCase().includes(lowerAppName)
    );
    if (matchedApps.length === 1) {
      console.log('[DEBUG] ✅ Match found (partial name):', matchedApps[0].label);
      return {
        appId: matchedApps[0].id,
        matches: [matchedApps[0].label],
        appNames: [],
        candidateApps: [],
      };
    }
    if (matchedApps.length > 1) {
      console.log('[DEBUG] Multiple matches found (partial name):', matchedApps.length, matchedApps.map((a: any) => a.label));
      return {
        appId: null,
        matches: [],
        appNames: matchedApps.map((app: any) => app.label),
        candidateApps: matchedApps.map((app: any) => ({
          id: app.id,
          label: app.label,
          name: app.name,
        })),
      };
    }

    // Strategy 7: Normalized comparison (removes punctuation, dots, underscores, spaces)
    console.log('[DEBUG] Trying normalized match...');
    const normalize = (str: string) =>
      str
        .toLowerCase()
        .replace(/[.\-_\s]/g, '')
        .replace(/cloud/g, '');

    const normalizedInput = normalize(sanitizedAppName);
    matchedApps = apps.filter((app: any) => {
      const normalizedLabel = normalize(app.label || '');
      const normalizedName = normalize(app.name || '');
      return (
        normalizedLabel === normalizedInput ||
        normalizedName === normalizedInput
      );
    });
    if (matchedApps.length === 1) {
      console.log('[DEBUG] ✅ Match found (normalized):', matchedApps[0].label);
      return {
        appId: matchedApps[0].id,
        matches: [matchedApps[0].label],
        appNames: [],
        candidateApps: [],
      };
    }

    // If multiple matches or no match, return ambiguity
    if (matchedApps.length > 1) {
      console.log('[DEBUG] Multiple matches found (normalized):', matchedApps.length);
      return {
        appId: null,
        matches: [],
        appNames: matchedApps.map((app: any) => app.label),
        candidateApps: matchedApps.map((app: any) => ({
          id: app.id,
          label: app.label,
          name: app.name,
        })),
      };
    }

    // No match found
    console.log('[DEBUG] ═══════════════════════════════════════════════════════');
    console.log('[DEBUG] ❌ FINAL RESULT: NO MATCHES FOUND');
    console.log('[DEBUG] ═══════════════════════════════════════════════════════');
    console.log('[DEBUG] Search term:', sanitizedAppName);
    console.log('[DEBUG] All strategies failed - no app matched');
    console.log('[DEBUG] Returning: appId=null, ambiguity');
    return { appId: null, matches: [], appNames: [], candidateApps: [] };
  } catch (error) {
    console.error('[DEBUG] Error in resolveAppByName:', error);
    return { appId: null, matches: [], appNames: [], candidateApps: [] };
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
    const lowerText = userText.toLowerCase().trim();

    // Check for confirmation or cancellation of pending action
    const isConfirmation =
      lowerText === 'confirm' ||
      lowerText === 'yes' ||
      lowerText === 'proceed' ||
      lowerText === 'yes, proceed' ||
      lowerText === 'do it';

    const isCancellation =
      lowerText === 'cancel' ||
      lowerText === 'no' ||
      lowerText === 'nevermind' ||
      lowerText === 'never mind' ||
      lowerText === 'abort';

    if (isConfirmation || isCancellation) {
      // Check if there's a pending action
      if (!session.pendingAction) {
        return NextResponse.json({
          message: 'There is no pending action to confirm or cancel.',
        });
      }

      if (isCancellation) {
        // Clear pending action
        const canceledAction = session.pendingAction.type;
        session.pendingAction = undefined;
        await session.save();

        return NextResponse.json({
          message: `Action canceled. The pending ${canceledAction} operation has been discarded.`,
        });
      }

      // Execute pending action
      const pending = session.pendingAction;
      console.log('[Chat] Executing pending action:', pending.type);

      try {
        let toolResult: string;

        if (pending.type === 'manage_app_labels') {
          // Execute label management
          toolResult = await executeTool(
            'manage_app_labels',
            {
              appId: pending.appId,
              action: pending.action,
              labelName: pending.labelName,
            },
            session.mcpAccessToken!,
            config.mcp.endpoints.toolsCall
          );
        } else if (pending.type === 'manage_app_campaigns') {
          // Execute campaign creation
          toolResult = await executeTool(
            'manage_app_campaigns',
            {
              appId: pending.appId,
              action: pending.action,
              name: pending.campaignName,
            },
            session.mcpAccessToken!,
            config.mcp.endpoints.toolsCall
          );
        } else {
          toolResult = JSON.stringify({
            error: true,
            message: `Unknown pending action type: ${pending.type}`,
          });
        }

        // Clear pending action after execution
        session.pendingAction = undefined;
        await session.save();

        // Check if tool result indicates stub/mock implementation
        const isStub = isStubResponse(toolResult);

        let resultMessage: string;

        if (isStub) {
          // Backend is stub - make it clear no real change was made
          if (pending.type === 'manage_app_labels') {
            resultMessage = `⚠️ **Backend execution is not yet implemented**

The label operation was confirmed, but no change has been made in Okta.

**Action:** Apply label "${pending.labelName}" to ${pending.appName || pending.appId}
**Status:** Guided flow complete, but backend execution is a stub

The label has NOT been applied to the application. Backend implementation is required for real execution.`;
          } else if (pending.type === 'manage_app_campaigns') {
            resultMessage = `⚠️ **Backend execution is not yet implemented**

The campaign was confirmed, but no campaign has been created in Okta.

**Action:** Create campaign "${pending.campaignName}" for ${pending.appName || pending.appId}
**Status:** Guided flow complete, but backend execution is a stub

No campaign was created. Backend implementation is required for real execution.`;
          } else {
            resultMessage = `⚠️ **Backend execution is not yet implemented**

The operation was confirmed, but no change has been made in Okta.

**Action:** ${pending.type} for ${pending.appName || pending.appId}
**Status:** Guided flow complete, but backend execution is a stub

Backend implementation is required for real execution.`;
          }
        } else {
          // Real execution - show success
          resultMessage = pending.appName
            ? `✅ **Operation completed successfully**

**Action:** ${pending.type} for ${pending.appName} (${pending.appId})

**Result:**
${toolResult}`
            : `✅ **Operation completed successfully**

**Result:**
${toolResult}`;
        }

        return NextResponse.json({
          message: resultMessage,
          toolCalls: 1,
        });
      } catch (error) {
        // Clear pending action even on error
        session.pendingAction = undefined;
        await session.save();

        return NextResponse.json({
          message: `Error executing ${pending.type}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }

    // Check for pending app resolution (disambiguation follow-up)
    if (session.pendingAppResolution) {
      console.log('[Chat] Pending app resolution detected:', session.pendingAppResolution.intent);

      const pending = session.pendingAppResolution;
      const userReply = userText.trim();

      // Match user reply against stored candidates only
      const normalize = (s: string) => s.toLowerCase().replace(/[._\s-]/g, '');
      const normalizedReply = normalize(userReply);

      let selectedApp: { id: string; label: string; name: string } | null = null;

      // 1. Exact label match
      for (const candidate of pending.candidates) {
        if (candidate.label === userReply) {
          selectedApp = candidate;
          break;
        }
      }

      // 2. Exact name match
      if (!selectedApp) {
        for (const candidate of pending.candidates) {
          if (candidate.name === userReply) {
            selectedApp = candidate;
            break;
          }
        }
      }

      // 3. Normalized match
      if (!selectedApp) {
        for (const candidate of pending.candidates) {
          if (
            normalize(candidate.label) === normalizedReply ||
            normalize(candidate.name) === normalizedReply
          ) {
            selectedApp = candidate;
            break;
          }
        }
      }

      if (selectedApp) {
        // Clear pending resolution
        session.pendingAppResolution = undefined;
        await session.save();

        console.log('[Chat] App resolved:', selectedApp.label);

        // Execute intended tool deterministically
        let toolResult: string;
        try {
          toolResult = await executeTool(
            pending.intent,
            { appId: selectedApp.id },
            session.mcpAccessToken!,
            config.mcp.endpoints.toolsCall
          );

          return NextResponse.json({
            message: `✅ **${pending.intent.replace(/_/g, ' ')}** for **${selectedApp.label}**\n\n${toolResult}`,
            toolCalls: 1,
          });
        } catch (error) {
          session.pendingAppResolution = undefined;
          await session.save();

          return NextResponse.json({
            message: `Error executing ${pending.intent}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          });
        }
      } else {
        // No match found - ask again or clear
        session.pendingAppResolution = undefined;
        await session.save();

        return NextResponse.json({
          message: `"${userReply}" does not match any of the candidates. Please try again with the exact app name from the list, or ask a new question.`,
        });
      }
    }

    // Check for tool discovery patterns
    const isToolDiscovery =
      lowerText.includes('list all available tools') ||
      lowerText.includes('what tools are available') ||
      lowerText.includes('what governance tools') ||
      lowerText.includes('show my governance tools') ||
      lowerText.includes('list available tools') ||
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

    // Check for app discovery patterns
    const isAppDiscovery =
      lowerText.includes('what apps can i manage') ||
      lowerText.includes('what governance-enabled apps') ||
      lowerText.includes('what applications can i manage') ||
      lowerText.includes('list manageable apps') ||
      lowerText.includes('list my apps') ||
      lowerText.includes('show manageable apps') ||
      lowerText.includes('show my apps');

    if (isAppDiscovery) {
      console.log('[Chat] Pre-router detected app discovery request');

      const toolResult = await executeTool(
        'list_manageable_apps',
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
        // Note: Include dots in app names (e.g., "Salesforce.com")
        const forMatch = userText.match(/for\s+([^?!]+)/i);
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

          const { appId: resolved, matches, appNames, candidateApps } = resolveAppByName(
            candidateAppName,
            appsResult
          );

          if (resolved) {
            appId = resolved;
            resolvedAppName = matches[0];
            console.log('[Chat] Resolved to appId:', appId);
          } else if (appNames.length > 1) {
            // Multiple matches - store in session for deterministic follow-up
            const toolName = isActivityReport
              ? 'generate_app_activity_report'
              : 'generate_access_review_candidates';

            session.pendingAppResolution = {
              type: 'app_resolution',
              intent: toolName,
              originalQuery: userText,
              candidates: candidateApps,
            };
            await session.save();

            return NextResponse.json({
              message: `Multiple applications match "${candidateAppName}":\n${appNames.map((n) => `- ${n}`).join('\n')}\n\nPlease reply with the exact application name you want.`,
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

    // Check for label management patterns
    const isLabelManagement =
      (lowerText.includes('label') || lowerText.includes('mark as')) &&
      (lowerText.includes('create') ||
        lowerText.includes('apply') ||
        lowerText.includes('add') ||
        lowerText.includes('remove') ||
        lowerText.includes('delete') ||
        lowerText.includes('mark'));

    if (isLabelManagement) {
      console.log('[Chat] Pre-router detected label management request');

      // Check if this is a confirmation
      const isConfirmation =
        lowerText === 'confirm' ||
        lowerText === 'yes' ||
        lowerText === 'proceed' ||
        lowerText === 'yes, proceed' ||
        lowerText === 'do it';

      if (isConfirmation) {
        // This is a confirmation without context - need to handle state management
        // For now, inform user they need to restate the action
        return NextResponse.json({
          message:
            'To apply a label, please specify the action. For example:\n"Apply label high-risk to Salesforce"\n"Add compliance label to ServiceNow"',
        });
      }

      // Extract app name or ID
      let appId = extractAppId(userText);
      let resolvedAppName: string | null = null;

      if (!appId) {
        // Try to extract app name from various patterns
        // Note: Include dots in app names (e.g., "Salesforce.com")
        const toMatch = userText.match(/to\s+([^?!]+)/i);
        const forMatch = userText.match(/for\s+([^?!]+)/i);
        const candidateAppName = (toMatch || forMatch)?.[1]?.trim();

        if (candidateAppName) {
          console.log('[Chat] Resolving app name for label:', candidateAppName);

          // Call list_manageable_apps (governance-enabled only)
          const appsResult = await executeTool(
            'list_manageable_apps',
            {},
            session.mcpAccessToken!,
            config.mcp.endpoints.toolsCall
          );

          const { appId: resolved, matches, appNames, candidateApps } = resolveAppByName(
            candidateAppName,
            appsResult
          );

          if (resolved) {
            appId = resolved;
            resolvedAppName = matches[0];
            console.log('[Chat] Resolved to appId:', appId);
          } else if (appNames.length > 1) {
            // For labels, we can't proceed yet because we need to extract label name from original query
            // We'll handle labels differently - just return clarification without storing
            return NextResponse.json({
              message: `Multiple applications match "${candidateAppName}":\n${appNames.map((n) => `- ${n}`).join('\n')}\n\nPlease specify which application and repeat the label operation.`,
            });
          } else {
            return NextResponse.json({
              message: `No matching governance-enabled application was found for "${candidateAppName}".\n\nOnly apps with Entitlement Management enabled can have labels applied.`,
            });
          }
        } else {
          // Missing app name
          return NextResponse.json({
            message:
              'To apply a label, please specify the application.\n\nExample: "Apply label high-risk to Salesforce"',
          });
        }
      }

      // Extract label name/value
      const labelMatch =
        userText.match(/label\s+['"]?([^'"]+)['"]?\s+to/i) ||
        userText.match(/mark\s+\w+\s+as\s+['"]?([^'"]+)['"]?/i) ||
        userText.match(/add\s+['"]?([^'"]+)['"]?\s+label/i);

      const labelName = labelMatch?.[1]?.trim();

      if (!labelName) {
        return NextResponse.json({
          message:
            'To apply a label, please specify the label name.\n\nExample: "Apply label high-risk to Salesforce"',
        });
      }

      // Build draft action summary
      const draftSummary = `I will apply the following label:

**App:** ${resolvedAppName || appId}
**App ID:** ${appId}
**Action:** Apply label
**Label:** ${labelName}

This action will:
- Add the '${labelName}' governance label to ${resolvedAppName || 'the application'}
- Make the app visible in filtered views for this label
- This change may affect governance reports and workflows

⚠️ **This is a write operation that will modify the application configuration.**

To proceed, please reply with "confirm".
To cancel, please reply with "cancel".

ℹ️ **Note:** If backend execution is still a stub, no actual change will be made in Okta.`;

      // Store pending action in session
      session.pendingAction = {
        type: 'manage_app_labels',
        appId,
        appName: resolvedAppName,
        action: 'apply',
        labelName,
      };
      await session.save();

      return NextResponse.json({
        message: draftSummary,
        toolCalls: 0,
      });
    }

    // Check for campaign creation patterns
    const isCampaignCreation =
      (lowerText.includes('campaign') || lowerText.includes('review') || lowerText.includes('certification')) &&
      (lowerText.includes('create') ||
        lowerText.includes('start') ||
        lowerText.includes('launch') ||
        lowerText.includes('set up') ||
        lowerText.includes('setup'));

    if (isCampaignCreation) {
      console.log('[Chat] Pre-router detected campaign creation request');

      // Check if this is a confirmation
      const isConfirmation =
        lowerText === 'confirm' ||
        lowerText === 'yes' ||
        lowerText === 'proceed' ||
        lowerText === 'yes, proceed' ||
        lowerText === 'do it';

      if (isConfirmation) {
        // Confirmation without context - need state management
        return NextResponse.json({
          message:
            'To create a campaign, please specify the action. For example:\n"Create review campaign for Salesforce"\n"Start access certification for ServiceNow"',
        });
      }

      // Extract app name or ID
      let appId = extractAppId(userText);
      let resolvedAppName: string | null = null;

      if (!appId) {
        // Try to extract app name from various patterns
        // Note: Include dots in app names (e.g., "Salesforce.com")
        const forMatch = userText.match(/for\s+([^?!]+)/i);
        const onMatch = userText.match(/on\s+([^?!]+)/i);
        const candidateAppName = (forMatch || onMatch)?.[1]?.trim();

        if (candidateAppName) {
          console.log('[Chat] Resolving app name for campaign:', candidateAppName);

          // Call list_manageable_apps (governance-enabled only)
          const appsResult = await executeTool(
            'list_manageable_apps',
            {},
            session.mcpAccessToken!,
            config.mcp.endpoints.toolsCall
          );

          const { appId: resolved, matches, appNames, candidateApps } = resolveAppByName(
            candidateAppName,
            appsResult
          );

          if (resolved) {
            appId = resolved;
            resolvedAppName = matches[0];
            console.log('[Chat] Resolved to appId:', appId);
          } else if (appNames.length > 1) {
            // For campaigns, we can't proceed yet because we need campaign parameters from original query
            // Ask user to repeat the full operation with specific app name
            return NextResponse.json({
              message: `Multiple applications match "${candidateAppName}":\n${appNames.map((n) => `- ${n}`).join('\n')}\n\nPlease specify which application and repeat the campaign operation.`,
            });
          } else {
            return NextResponse.json({
              message: `No matching governance-enabled application was found for "${candidateAppName}".\n\nOnly apps with Entitlement Management enabled can have campaigns created.`,
            });
          }
        } else {
          // Missing app name
          return NextResponse.json({
            message:
              'To create a campaign, please specify the application.\n\nExample: "Create review campaign for Salesforce"',
          });
        }
      }

      // Extract or generate campaign name
      let campaignName = '';
      const nameMatch = userText.match(/named?\s+['"]([^'"]+)['"]/i) ||
                        userText.match(/called?\s+['"]([^'"]+)['"]/i);

      if (nameMatch) {
        campaignName = nameMatch[1].trim();
      } else {
        // Generate default name
        const currentDate = new Date().toISOString().split('T')[0];
        campaignName = `Access Review - ${resolvedAppName || appId} - ${currentDate}`;
      }

      // Determine campaign type (default to access certification)
      const campaignType = lowerText.includes('inactive') || lowerText.includes('orphan')
        ? 'inactive_users'
        : 'access_certification';

      // Default reviewer type
      const reviewerType = 'app_owner';

      // Default duration
      const duration = '14 days';

      // Build draft campaign summary
      const draftSummary = `I will create the following access certification campaign:

**App:** ${resolvedAppName || appId}
**App ID:** ${appId}
**Campaign Name:** ${campaignName}
**Campaign Type:** ${campaignType === 'access_certification' ? 'Access Certification' : 'Inactive Users Review'}
**Reviewer:** App Owner
**Duration:** ${duration}
**Candidate Selection:** All users with current access to this application

This action will:
- Create a new governance campaign for ${resolvedAppName || 'the application'}
- Campaign will be created in DRAFT status (not launched automatically)
- Reviewers will be assigned based on app ownership
- You can launch the campaign later from the Governance Console

⚠️ **This is a write operation that will create a new campaign.**

To proceed, please reply with "confirm".
To cancel, please reply with "cancel".

ℹ️ **Note:** Campaign creation backend is currently a stub. When you confirm, the guided flow will execute, but no actual campaign will be created in Okta until backend implementation is complete.`;

      // Store pending action in session
      session.pendingAction = {
        type: 'manage_app_campaigns',
        appId,
        appName: resolvedAppName,
        action: 'create',
        campaignName,
        campaignType,
        reviewerType,
        duration,
      };
      await session.save();

      return NextResponse.json({
        message: draftSummary,
        toolCalls: 0,
      });
    }

    // Check for entitlement management patterns
    const isEntitlementManagement =
      lowerText.includes('entitlement') &&
      (lowerText.includes('manage') ||
        lowerText.includes('list') ||
        lowerText.includes('add') ||
        lowerText.includes('remove') ||
        lowerText.includes('assign'));

    if (isEntitlementManagement) {
      console.log('[Chat] Pre-router detected entitlement management request');

      // Check if this is a confirmation
      const isConfirmation =
        lowerText === 'confirm' ||
        lowerText === 'yes' ||
        lowerText === 'proceed' ||
        lowerText === 'yes, proceed' ||
        lowerText === 'do it';

      if (isConfirmation) {
        return NextResponse.json({
          message:
            'To manage entitlements, please specify the action. For example:\n"List entitlements for Salesforce"\n"Manage entitlements for ServiceNow"',
        });
      }

      // Extract app name or ID
      let appId = extractAppId(userText);
      let resolvedAppName: string | null = null;

      if (!appId) {
        const forMatch = userText.match(/for\s+([^?!]+)/i);
        const candidateAppName = forMatch?.[1]?.trim();

        if (candidateAppName) {
          console.log('[Chat] Resolving app name for entitlements:', candidateAppName);

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
            return NextResponse.json({
              message: `Multiple applications match "${candidateAppName}":\n${appNames.map((n) => `- ${n}`).join('\n')}\n\nPlease specify which application and repeat the entitlement operation.`,
            });
          } else {
            return NextResponse.json({
              message: `No matching governance-enabled application was found for "${candidateAppName}".`,
            });
          }
        } else {
          return NextResponse.json({
            message:
              'To manage entitlements, please specify the application.\n\nExample: "List entitlements for Salesforce"',
          });
        }
      }

      // Build draft action summary
      const draftSummary = `I will manage entitlements for the following application:

**App:** ${resolvedAppName || appId}
**App ID:** ${appId}
**Action:** List and manage entitlements

This action will:
- Retrieve all entitlements (roles, permissions, access levels) for ${resolvedAppName || 'the application'}
- Allow viewing entitlement structure
- Enable adding/removing entitlements (with confirmation)

⚠️ **Entitlement changes are write operations that modify application access.**

To proceed, please reply with "confirm".
To cancel, please reply with "cancel".

ℹ️ **Note:** Entitlement management backend is currently a stub. The tool will execute when you confirm, but actual changes require backend implementation.`;

      // Store pending action in session
      session.pendingAction = {
        type: 'manage_app_entitlements',
        appId,
        appName: resolvedAppName,
        action: 'list',
      };
      await session.save();

      return NextResponse.json({
        message: draftSummary,
        toolCalls: 0,
      });
    }

    // Check for bundle management patterns
    const isBundleManagement =
      lowerText.includes('bundle') &&
      (lowerText.includes('create') ||
        lowerText.includes('manage') ||
        lowerText.includes('list') ||
        lowerText.includes('add'));

    if (isBundleManagement) {
      console.log('[Chat] Pre-router detected bundle management request');

      const isConfirmation =
        lowerText === 'confirm' ||
        lowerText === 'yes' ||
        lowerText === 'proceed' ||
        lowerText === 'yes, proceed' ||
        lowerText === 'do it';

      if (isConfirmation) {
        return NextResponse.json({
          message:
            'To manage bundles, please specify the action. For example:\n"Create bundle for new hires"\n"List all bundles"',
        });
      }

      // Extract bundle name
      const namedMatch = userText.match(/named?\s+['"]([^'"]+)['"]/i) ||
                         userText.match(/called?\s+['"]([^'"]+)['"]/i) ||
                         userText.match(/for\s+([^?!]+)/i);
      const bundleName = namedMatch?.[1]?.trim() || 'New Application Bundle';

      // Build draft action summary
      const draftSummary = `I will create the following application bundle:

**Bundle Name:** ${bundleName}
**Action:** Create application bundle

This action will:
- Create a new application bundle (collection of apps for provisioning)
- Bundle will be created in DRAFT status
- You can add applications to the bundle later
- Bundles simplify access provisioning for user groups

⚠️ **This is a write operation that creates a new bundle.**

To proceed, please reply with "confirm".
To cancel, please reply with "cancel".

ℹ️ **Note:** Bundle management backend is currently a stub. The tool will execute when you confirm.`;

      // Store pending action in session
      session.pendingAction = {
        type: 'manage_app_bundles',
        action: 'create',
        bundleName,
      };
      await session.save();

      return NextResponse.json({
        message: draftSummary,
        toolCalls: 0,
      });
    }

    // Check for workflow management patterns
    const isWorkflowManagement =
      lowerText.includes('workflow') &&
      (lowerText.includes('create') ||
        lowerText.includes('manage') ||
        lowerText.includes('configure') ||
        lowerText.includes('set up') ||
        lowerText.includes('setup'));

    if (isWorkflowManagement) {
      console.log('[Chat] Pre-router detected workflow management request');

      const isConfirmation =
        lowerText === 'confirm' ||
        lowerText === 'yes' ||
        lowerText === 'proceed' ||
        lowerText === 'yes, proceed' ||
        lowerText === 'do it';

      if (isConfirmation) {
        return NextResponse.json({
          message:
            'To manage workflows, please specify the action. For example:\n"Configure approval workflow for Salesforce"\n"Create workflow for ServiceNow"',
        });
      }

      // Extract app name or ID
      let appId = extractAppId(userText);
      let resolvedAppName: string | null = null;

      if (!appId) {
        const forMatch = userText.match(/for\s+([^?!]+)/i);
        const candidateAppName = forMatch?.[1]?.trim();

        if (candidateAppName) {
          console.log('[Chat] Resolving app name for workflow:', candidateAppName);

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
            return NextResponse.json({
              message: `Multiple applications match "${candidateAppName}":\n${appNames.map((n) => `- ${n}`).join('\n')}\n\nPlease specify which application and repeat the workflow operation.`,
            });
          } else {
            return NextResponse.json({
              message: `No matching governance-enabled application was found for "${candidateAppName}".`,
            });
          }
        } else {
          return NextResponse.json({
            message:
              'To manage workflows, please specify the application.\n\nExample: "Configure approval workflow for Salesforce"',
          });
        }
      }

      // Build draft action summary
      const draftSummary = `I will manage workflows for the following application:

**App:** ${resolvedAppName || appId}
**App ID:** ${appId}
**Action:** Configure governance workflow

This action will:
- Configure approval workflows for ${resolvedAppName || 'the application'}
- Set up automated governance actions
- Define approval chains and automation rules

⚠️ **This is a write operation that modifies workflow configuration.**

To proceed, please reply with "confirm".
To cancel, please reply with "cancel".

ℹ️ **Note:** Workflow management backend is currently a stub. The tool will execute when you confirm.`;

      // Store pending action in session
      session.pendingAction = {
        type: 'manage_app_workflows',
        appId,
        appName: resolvedAppName,
        action: 'configure',
      };
      await session.save();

      return NextResponse.json({
        message: draftSummary,
        toolCalls: 0,
      });
    }

    // Check for access request patterns
    const isAccessRequest =
      (lowerText.includes('request') || lowerText.includes('delegate')) &&
      (lowerText.includes('access') || lowerText.includes('app'));

    if (isAccessRequest) {
      console.log('[Chat] Pre-router detected access request creation');

      const isConfirmation =
        lowerText === 'confirm' ||
        lowerText === 'yes' ||
        lowerText === 'proceed' ||
        lowerText === 'yes, proceed' ||
        lowerText === 'do it';

      if (isConfirmation) {
        return NextResponse.json({
          message:
            'To create an access request, please specify the details. For example:\n"Request Salesforce access for john@example.com"\n"Delegate access to ServiceNow for jane@example.com"',
        });
      }

      // Extract app name and user email
      let appId = extractAppId(userText);
      let resolvedAppName: string | null = null;

      // Extract user email
      const emailMatch = userText.match(/for\s+([\w.+-]+@[\w.-]+\.\w+)/i);
      const userEmail = emailMatch?.[1];

      if (!userEmail) {
        return NextResponse.json({
          message:
            'To create an access request, please specify the user email.\n\nExample: "Request Salesforce access for john@example.com"',
        });
      }

      if (!appId) {
        // Try to extract app name
        const appMatch = userText.match(/request\s+(\w+)/i);
        const candidateAppName = appMatch?.[1]?.trim();

        if (candidateAppName) {
          console.log('[Chat] Resolving app name for access request:', candidateAppName);

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
            return NextResponse.json({
              message: `Multiple applications match "${candidateAppName}":\n${appNames.map((n) => `- ${n}`).join('\n')}\n\nPlease specify which application and repeat the access request.`,
            });
          } else {
            return NextResponse.json({
              message: `No matching application was found for "${candidateAppName}".`,
            });
          }
        } else {
          return NextResponse.json({
            message:
              'To create an access request, please specify the application.\n\nExample: "Request Salesforce access for john@example.com"',
          });
        }
      }

      // Build draft action summary
      const draftSummary = `I will create the following delegated access request:

**App:** ${resolvedAppName || appId}
**App ID:** ${appId}
**User:** ${userEmail}
**Action:** Create delegated access request

This action will:
- Create an access request for ${userEmail} to ${resolvedAppName || 'the application'}
- Request will enter approval workflow (if configured)
- User will receive notification upon approval
- Access will be provisioned automatically if approved

⚠️ **This is a write operation that creates an access request.**

To proceed, please reply with "confirm".
To cancel, please reply with "cancel".

ℹ️ **Note:** Access request creation backend is currently a stub. The tool will execute when you confirm.`;

      // Store pending action in session
      session.pendingAction = {
        type: 'create_delegated_access_request',
        appId,
        appName: resolvedAppName,
        userEmail,
        action: 'create',
      };
      await session.save();

      return NextResponse.json({
        message: draftSummary,
        toolCalls: 0,
      });
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

      // PART 2: Detect pseudo tool-call text (JSON in content instead of actual tool_calls)
      // If the assistant returns text that looks like a tool call JSON instead of using
      // actual tool_calls metadata, treat it as invalid ungrounded output
      if (
        assistantMessage.content &&
        typeof assistantMessage.content === 'string' &&
        !assistantMessage.tool_calls &&
        (assistantMessage.content.includes('"function":') ||
          assistantMessage.content.includes('"name":') && assistantMessage.content.includes('"arguments":'))
      ) {
        console.error('[Chat] BLOCKED: LLM returned pseudo tool-call text instead of actual tool_calls', {
          contentPreview: assistantMessage.content.substring(0, 200),
        });

        return NextResponse.json(
          {
            error: 'Invalid response format',
            message: 'I cannot provide this information without calling the appropriate tool. Please try rephrasing your question.',
          },
          { status: 400 }
        );
      }

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
