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
import { getUserAccessToken, getMcpAccessToken } from '@/lib/token-cookies';

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

interface GovernanceIntent {
  type: 'requests' | 'catalog' | 'reviews' | 'certifications' | 'settings' | 'request_access' | 'none';
  query: string;
  resourceName?: string; // For request_access: the resource to request
  params?: {
    limit?: number;
    sortBy?: string;
    sortOrder?: string;
    campaignStatus?: string;
  };
}

/**
 * Parsed access request intent with extracted field values
 */
interface ParsedAccessIntent {
  resourceName?: string;
  entitlementName?: string;
  duration?: string;
  requestedFor?: string;
  justification?: string;
  isComplete: boolean;
}

/**
 * Parse complete access request from user message
 * Extracts resource, entitlement, duration, delegation, justification if provided
 *
 * Examples:
 * - "I need Adobe Express Bundle for 2 hours for Arjun.Krishnan@atko.email"
 * - "Request Salesforce access for 7 days for john@example.com"
 * - "I need Microsoft Office 365 for myself for 1 week"
 * - "Access to Adobe for 2 hours"
 */
function parseAccessRequestIntent(userMessage: string): ParsedAccessIntent {
  const lower = userMessage.toLowerCase();
  const result: ParsedAccessIntent = { isComplete: false };

  console.log('[AccessRequest] Parsing intent from:', userMessage);

  // Extract full resource name (including bundle/entitlement if specified)
  // Match patterns like:
  // - "access to Adobe Express Bundle"
  // - "I need Salesforce"
  // - "request Microsoft Office 365"
  // Stop at "for X hours", "for user@email", or "for myself"
  const resourceMatch = userMessage.match(/(?:need access to|i need access to|access to|i need|request\s+access\s+to|request)\s+([A-Za-z0-9\s\-\.]+?)(?:\s+for\s+(?:\d+\s+(?:hour|day|week|month)|myself|me|[a-zA-Z0-9._%+-]+@)|\s*$)/i);
  if (resourceMatch) {
    const fullResource = resourceMatch[1].trim();
    result.resourceName = fullResource;

    // Check if the resource name contains a bundle/entitlement indicator
    const bundleMatch = fullResource.match(/(Express Bundle|Pro Bundle|Creative Cloud Bundle|Express|Pro|Standard|Premium|Basic)/i);
    if (bundleMatch) {
      result.entitlementName = bundleMatch[0];
      // Extract parent resource name (everything before the bundle name)
      const parentName = fullResource.substring(0, bundleMatch.index).trim();
      if (parentName) {
        result.resourceName = parentName;
      }
    }

    console.log('[AccessRequest] Extracted resource:', result.resourceName);
    if (result.entitlementName) {
      console.log('[AccessRequest] Extracted entitlement:', result.entitlementName);
    }
  }

  // Extract duration: "2 hours", "7 days", "2 weeks", "for 30 days"
  const durationMatch = userMessage.match(/for\s+(\d+)\s+(hour|day|week|month)s?/i);
  if (durationMatch) {
    const amount = parseInt(durationMatch[1], 10);
    const unit = durationMatch[2].toLowerCase();

    if (unit.startsWith('hour')) {
      result.duration = `PT${amount}H`;
    } else if (unit.startsWith('day')) {
      result.duration = `P${amount}D`;
    } else if (unit.startsWith('week')) {
      result.duration = `P${amount * 7}D`;
    } else if (unit.startsWith('month')) {
      result.duration = `P${amount}M`;
    }

    console.log('[AccessRequest] Extracted duration:', result.duration);
  }

  // Extract delegation: "for myself" or "for john@example.com"
  // Look for the LAST occurrence of "for" followed by email/myself
  // This handles: "Adobe Express Bundle for 2 hours for john@example.com"
  const forMatches = [...userMessage.matchAll(/for\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|myself|me)(?!\s+\d+\s+(?:hour|day|week|month))/gi)];
  if (forMatches.length > 0) {
    // Get the last match (in case there are multiple "for" clauses)
    const lastMatch = forMatches[forMatches.length - 1];
    result.requestedFor = lastMatch[1];
    console.log('[AccessRequest] Extracted requestedFor:', result.requestedFor);
  }

  // Extract justification: "because", "reason", "need"
  const justificationMatch = userMessage.match(/(?:because|reason)[\s:]+(.{10,100})/i);
  if (justificationMatch) {
    result.justification = justificationMatch[1].trim();
    console.log('[AccessRequest] Extracted justification:', result.justification);
  }

  // Check if we have all required fields for a complete request
  // Note: requestedFor is optional (defaults to "myself")
  if (result.resourceName && result.duration) {
    result.isComplete = true;
    console.log('[AccessRequest] Intent is complete');
  } else {
    console.log('[AccessRequest] Intent is incomplete - missing:', {
      resourceName: !result.resourceName,
      duration: !result.duration,
    });
  }

  return result;
}

/**
 * Detect if user message is asking for end-user governance data
 * (requests, catalog, reviews, certifications, settings, request_access)
 */
function detectGovernanceIntent(message: string): GovernanceIntent {
  const lower = message.toLowerCase();

  // Request access keywords (must check before "request" keyword)
  // Patterns:
  // - "request access to X"
  // - "I need access to X"
  // - "I need X Bundle for Y"
  // - "I need X for Y hours"
  // - "request X for user@email"
  if (
    lower.includes('request access') ||
    lower.includes('i need access') ||
    lower.includes('can i get access') ||
    lower.match(/\bi need\s+[a-z0-9\s]+(?:bundle|premium|standard|pro|express)\s+for/i) || // "I need Adobe Express Bundle for"
    lower.match(/\bi need\s+[a-z0-9\s]+\s+for\s+\d+\s+(?:hour|day|week|month)/i) || // "I need Adobe for 2 hours"
    lower.match(/request\s+.+\s+for\s+[a-z0-9@]/i) || // "request Adobe for user@email"
    lower.match(/access to\s+.+/i) // "access to Adobe"
  ) {
    // Try to extract resource name - stop at "for" to handle "access to Adobe for user@email"
    const resourceMatch =
      message.match(/(?:request access (?:to |for )?|access to |i need access to |i need )([a-zA-Z0-9\s\-_\.]+?)(?:\s+for\s+|\s*$)/i);
    const resourceName = resourceMatch ? resourceMatch[1].trim() : undefined;

    return { type: 'request_access', query: message, resourceName };
  }

  // Requests keywords (existing requests)
  if (
    lower.includes('my request') ||
    lower.includes('pending') ||
    lower.includes('approval') ||
    lower.includes('applied for') ||
    lower.includes('what have i requested')
  ) {
    return { type: 'requests', query: message };
  }

  // Catalog keywords
  if (
    lower.includes('catalog') ||
    lower.includes('available') ||
    lower.includes('can i request') ||
    lower.includes('what can i request') ||
    lower.includes('browse')
  ) {
    return { type: 'catalog', query: message };
  }

  // Reviews keywords
  if (
    lower.includes('review') ||
    lower.includes('need to review') ||
    lower.includes('assigned to me') ||
    lower.includes('certif') ||
    lower.includes('access review')
  ) {
    // Check if it's certification or security review
    if (lower.includes('certif') || lower.includes('campaign')) {
      return { type: 'certifications', query: message };
    }
    return { type: 'reviews', query: message };
  }

  // Settings keywords
  if (
    lower.includes('setting') ||
    lower.includes('notification') ||
    lower.includes('digest') ||
    lower.includes('preference') ||
    lower.includes('email frequency')
  ) {
    return { type: 'settings', query: message };
  }

  return { type: 'none', query: message };
}

/**
 * v2 API: List catalog entries available to the user
 */
async function listCatalogEntries(
  userAccessToken: string,
  oktaDomain: string
): Promise<any[]> {
  try {
    // v2 API requires filter parameter for top-level entries
    // filter=not(parent pr) gets entries without a parent (top-level only)
    const url = `https://${oktaDomain}/governance/api/v2/my/catalogs/default/entries?filter=not(parent%20pr)&limit=100`;
    console.log('[AccessRequest] Fetching from:', url);

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${userAccessToken}`,
        Accept: 'application/json',
      },
    });

    console.log('[AccessRequest] Response status:', response.status);

    const data = await response.json();
    console.log('[AccessRequest] Response body:', JSON.stringify(data, null, 2));

    if (!response.ok) {
      console.error('[AccessRequest] Error response:', {
        status: response.status,
        statusText: response.statusText,
        body: data,
      });
      return [];
    }

    // Postman collection shows response format: { data: [...], _links: {...} }
    const entries = data.data || [];
    console.log('[AccessRequest] Retrieved', entries.length, 'catalog entries');
    return entries;
  } catch (error: any) {
    console.error('[AccessRequest] Error getting catalog entries:', error.message);
    return [];
  }
}

/**
 * v2 API: Get specific catalog entry details
 */
async function getCatalogEntry(
  userAccessToken: string,
  oktaDomain: string,
  entryId: string
): Promise<any | null> {
  try {
    const url = `https://${oktaDomain}/governance/api/v2/my/catalogs/default/entries/${entryId}`;
    console.log('[AccessRequest] Fetching catalog entry:', entryId);

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${userAccessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      console.error('[AccessRequest] Failed to fetch catalog entry:', response.status);
      return null;
    }

    const data = await response.json();
    console.log('[AccessRequest] Retrieved catalog entry:', data.name);
    return data;
  } catch (error: any) {
    console.error('[AccessRequest] Error getting catalog entry:', error.message);
    return null;
  }
}

/**
 * v2 API: Get request fields for a catalog entry
 */
async function getRequestFields(
  userAccessToken: string,
  oktaDomain: string,
  entryId: string
): Promise<any[]> {
  try {
    const url = `https://${oktaDomain}/governance/api/v2/my/catalogs/default/entries/${entryId}/request-fields`;
    console.log('[AccessRequest] Fetching request fields from:', url);

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${userAccessToken}`,
        Accept: 'application/json',
      },
    });

    console.log('[AccessRequest] Request fields response status:', response.status);

    const data = await response.json();
    console.log('[AccessRequest] Full request fields response:', JSON.stringify(data, null, 2));

    if (!response.ok) {
      console.error('[AccessRequest] Error response:', data);
      return [];
    }

    // Try different response formats
    const fields =
      data._embedded?.fields || data.fields || data.data || (Array.isArray(data) ? data : []);

    console.log('[AccessRequest] Extracted fields:', JSON.stringify(fields, null, 2));
    console.log('[AccessRequest] Retrieved request fields:', fields.length);

    return fields;
  } catch (error: any) {
    console.error('[AccessRequest] Error getting request fields:', error.message);
    return [];
  }
}

/**
 * Build access request payload from collected field values
 *
 * Handles:
 * - "myself" case: omits OKTA_REQUESTED_FOR field
 * - Username resolution: calls MCP to resolve username to Okta GUID
 *
 * Payload format:
 * {
 *   "requesterFieldValues": [
 *     { "id": "ACCESS_DURATION", "value": "PT2H" },
 *     { "id": "OKTA_REQUESTED_FOR", "value": "00u..." }  // only if not "myself"
 *   ]
 * }
 */
async function buildAccessRequestPayload(
  collectedValues: Record<string, any>,
  currentUserId: string | undefined,
  mcpAccessToken: string,
  mcpEndpoint: string
): Promise<any> {
  const requesterFieldValues: Array<{ id: string; value: any }> = [];

  for (const [fieldId, fieldValue] of Object.entries(collectedValues)) {
    if (fieldId === 'OKTA_REQUESTED_FOR') {
      const normalizedValue = fieldValue.toLowerCase().trim();

      if (normalizedValue === 'myself' || normalizedValue === 'me') {
        // Requesting for self - omit this field entirely
        console.log('[AccessRequest] Requesting for self - omitting OKTA_REQUESTED_FOR');
        continue;
      }

      // Call MCP server to resolve username/email to Okta user GUID
      console.log('[AccessRequest] Resolving username to Okta GUID:', fieldValue);

      try {
        const resolveResult = await executeTool(
          'resolve_okta_user',
          { usernameOrEmail: fieldValue },
          mcpAccessToken,
          mcpEndpoint
        );

        console.log('[AccessRequest] Resolve result:', resolveResult);

        const parsed = JSON.parse(resolveResult);

        if (!parsed.success) {
          throw new Error(parsed.message || 'Failed to resolve username');
        }

        console.log('[AccessRequest] Resolved to user ID:', parsed.userId);

        requesterFieldValues.push({
          id: fieldId,
          value: parsed.userId
        });
      } catch (error: any) {
        console.error('[AccessRequest] Failed to resolve username:', error.message);
        throw new Error(`Could not find user: ${fieldValue}. Please check the username/email and try again.`);
      }
    } else {
      // Other fields: include as-is
      requesterFieldValues.push({
        id: fieldId,
        value: fieldValue
      });
    }
  }

  return { requesterFieldValues };
}

/**
 * v2 API: Create access request for a catalog entry
 */
async function createAccessRequest(
  userAccessToken: string,
  oktaDomain: string,
  entryId: string,
  requestData: any
): Promise<any> {
  try {
    const url = `https://${oktaDomain}/governance/api/v2/my/catalogs/default/entries/${entryId}/requests`;
    console.log('[AccessRequest] Creating access request for entry:', entryId);

    // Log full API request details
    console.log('[AccessRequest] API Request Details:', {
      method: 'POST',
      url: url,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: 'Bearer [REDACTED]',
      },
      body: requestData,
    });
    console.log('[AccessRequest] Request body JSON:', JSON.stringify(requestData, null, 2));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userAccessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    console.log('[AccessRequest] Response status:', response.status);
    console.log('[AccessRequest] Response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[AccessRequest] Failed to create request - Status:', response.status);
      console.error('[AccessRequest] Failed to create request - Response body:', errorText);
      throw new Error(`Failed to create access request: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    console.log('[AccessRequest] Successfully created access request:', data.id);
    console.log('[AccessRequest] Full response:', JSON.stringify(data, null, 2));
    return data;
  } catch (error: any) {
    console.error('[AccessRequest] Error creating access request:', error.message);
    throw error;
  }
}

/**
 * v2 API: Find parent catalog entry by resource name using fuzzy search
 */
async function findParentEntry(
  resourceName: string,
  userAccessToken: string,
  oktaDomain: string
): Promise<any | null> {
  try {
    // Use match parameter for fuzzy search (requires minimum 3 characters)
    const searchTerm = resourceName.length >= 3 ? resourceName : undefined;
    const matchParam = searchTerm ? `&match=${encodeURIComponent(searchTerm)}` : '';
    const url = `https://${oktaDomain}/governance/api/v2/my/catalogs/default/entries?filter=not(parent%20pr)${matchParam}&limit=20`;

    console.log('[AccessRequest] Searching for parent entry:', resourceName);
    console.log('[AccessRequest] Search URL:', url);

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${userAccessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      console.error('[AccessRequest] Failed to search catalog:', response.status);
      return null;
    }

    const data = await response.json();
    const entries = data.data || [];

    console.log('[AccessRequest] Found', entries.length, 'entries');

    // Try exact match first
    const exactMatch = entries.find(
      (e: any) => e.name?.toLowerCase() === resourceName.toLowerCase()
    );

    if (exactMatch) {
      console.log('[AccessRequest] Exact match found:', exactMatch.name);
      return exactMatch;
    }

    // Try fuzzy match
    const fuzzyMatch = entries.find((e: any) =>
      e.name?.toLowerCase().includes(resourceName.toLowerCase()) ||
      e.description?.toLowerCase().includes(resourceName.toLowerCase())
    );

    if (fuzzyMatch) {
      console.log('[AccessRequest] Fuzzy match found:', fuzzyMatch.name);
      return fuzzyMatch;
    }

    console.log('[AccessRequest] No match found for:', resourceName);
    return entries[0] || null; // Return first result if any
  } catch (error: any) {
    console.error('[AccessRequest] Error finding parent entry:', error.message);
    return null;
  }
}

/**
 * v2 API: Get child entries (entitlements) under a parent entry
 */
async function getChildEntries(
  parentId: string,
  userAccessToken: string,
  oktaDomain: string
): Promise<any[]> {
  try {
    // filter=parent eq "{parentId}" gets child entries
    const url = `https://${oktaDomain}/governance/api/v2/my/catalogs/default/entries?filter=parent%20eq%20%22${parentId}%22&limit=50`;

    console.log('[AccessRequest] Fetching child entries for parent:', parentId);
    console.log('[AccessRequest] Child entries URL:', url);

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${userAccessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      console.error('[AccessRequest] Failed to fetch child entries:', response.status);
      return [];
    }

    const data = await response.json();
    const children = data.data || [];

    console.log('[AccessRequest] Found', children.length, 'child entries');
    return children;
  } catch (error: any) {
    console.error('[AccessRequest] Error getting child entries:', error.message);
    return [];
  }
}

/**
 * Parse user input into the correct format based on field type
 */
function parseFieldValue(fieldId: string, fieldType: string, userInput: string): any {
  const input = userInput.toLowerCase().trim();

  switch (fieldType) {
    case 'DURATION':
      // Parse duration like "7 days", "2 weeks", "1 month", "30 days"
      const durationMatch = input.match(/(\d+)\s*(day|days|week|weeks|month|months|hour|hours)/);

      if (durationMatch) {
        const value = parseInt(durationMatch[1], 10);
        const unit = durationMatch[2];

        if (unit.startsWith('day')) {
          return `P${value}D`;
        } else if (unit.startsWith('week')) {
          return `P${value * 7}D`;
        } else if (unit.startsWith('month')) {
          return `P${value}M`;
        } else if (unit.startsWith('hour')) {
          return `PT${value}H`;
        }
      }

      // If already in ISO 8601 format (P30D), return as-is
      if (input.match(/^P\d+[DWMY]$/)) {
        return userInput;
      }

      // Default to 30 days if unparseable
      console.log('[AccessRequest] Could not parse duration, defaulting to P30D');
      return 'P30D';

    case 'OKTA_USER_ID':
      // Extract email or "myself" from input
      // Handle cases like: "myself", "me", "john@example.com", or full sentences containing email
      if (input === 'myself' || input === 'me') {
        return 'myself';
      }

      // Try to extract email from the input
      const emailMatch = userInput.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      if (emailMatch) {
        return emailMatch[1];
      }

      // If no email found, return the input as-is (might be a username)
      return userInput.trim();

    case 'STRING':
    case 'TEXT':
      return userInput;

    case 'ENUM':
      return userInput; // Should match one of the enum values

    case 'BOOLEAN':
      return input === 'yes' || input === 'true' || input === 'y';

    case 'NUMBER':
      return parseInt(userInput, 10);

    default:
      return userInput;
  }
}

/**
 * Format ISO 8601 duration for display
 */
function formatDurationForDisplay(iso8601: string): string {
  // "P7D" → "7 days", "P14D" → "14 days", "PT24H" → "24 hours"
  const match = iso8601.match(/P(?:(\d+)M)?(?:(\d+)D)?(?:T(\d+)H)?/);
  if (!match) return iso8601;

  const months = match[1];
  const days = match[2];
  const hours = match[3];

  if (months) return `${months} month${months !== '1' ? 's' : ''}`;
  if (days) return `${days} day${days !== '1' ? 's' : ''}`;
  if (hours) return `${hours} hour${hours !== '1' ? 's' : ''}`;
  return iso8601;
}

/**
 * Generate field question based on field type
 */
function askForNextField(field: any, index: number, total: number): string {
  let prompt = `**Step ${index + 1} of ${total}**: ${field.id}\n\n`;

  switch (field.type) {
    case 'DURATION':
      prompt += `How long do you need access?\n`;
      prompt += `Examples: "7 days", "2 weeks", "24 hours"`;
      if (field.value) {
        prompt += `\nDefault: ${formatDurationForDisplay(field.value)}`;
      }
      if (field.maximumValue) {
        prompt += `\nMaximum: ${formatDurationForDisplay(field.maximumValue)}`;
      }
      break;

    case 'OKTA_USER_ID':
      prompt += `Is this request for yourself or someone else?\n`;
      prompt += `Reply "myself" or provide their Okta username/email.`;
      break;

    case 'STRING':
    case 'TEXT':
      if (field.id === 'JUSTIFICATION') {
        prompt += `Why do you need this access? (Provide a brief justification)`;
      } else {
        prompt += `Please provide: ${field.label || field.name || field.id}`;
      }
      if (field.description) {
        prompt += `\n${field.description}`;
      }
      break;

    case 'ENUM':
      const options = field.options?.map((o: any) => o.label || o.value).join(', ');
      prompt += `Select one: ${options || 'N/A'}`;
      break;

    case 'BOOLEAN':
      prompt += `${field.label || field.name || field.id}? (yes/no)`;
      break;

    default:
      prompt += `Please provide a value for ${field.label || field.name || field.id}`;
  }

  return prompt;
}

/**
 * Show confirmation preview before creating request
 * Uses simple label mapping - NO API CALLS to keep session lightweight
 */
function showConfirmationPreview(workflow: any): string {
  const lines = ['**Ready to submit your access request:**', ''];

  lines.push(`📦 **Resource:** ${workflow.resourceName || 'N/A'}`);

  if (workflow.selectedEntryName) {
    lines.push(`🎯 **Access Level:** ${workflow.selectedEntryName}`);
  }

  if (workflow.collectedValues && Object.keys(workflow.collectedValues).length > 0) {
    lines.push('');
    lines.push('**Details:**');

    for (const [fieldId, value] of Object.entries(workflow.collectedValues)) {
      // Use simple label mapping - NO API CALLS
      let label = fieldId;
      if (fieldId === 'ACCESS_DURATION') label = 'Duration';
      if (fieldId === 'OKTA_REQUESTED_FOR') label = 'Requested For';
      if (fieldId === 'JUSTIFICATION') label = 'Justification';

      let displayValue = value;
      if (fieldId === 'ACCESS_DURATION' && typeof value === 'string') {
        displayValue = formatDurationForDisplay(value as string);
      }

      lines.push(`  • ${label}: ${displayValue}`);
    }
  }

  lines.push('');
  lines.push('Type **"confirm"** to submit, or **"cancel"** to abort.');

  return lines.join('\n');
}

/**
 * Stage Handler: Awaiting Entitlement Selection
 */
async function handleAwaitingEntitlementSelection(
  userMessage: string,
  session: any,
  userAccessToken: string,
  oktaDomain: string
): Promise<string> {
  const workflow = session.pendingAccessRequestWorkflow;
  const childEntryIds = workflow.childEntryIds || [];

  console.log('[AccessRequest] Handling entitlement selection');
  console.log('[AccessRequest] User message:', userMessage);
  console.log('[AccessRequest] Available children IDs:', childEntryIds.length);

  // Fetch full child entries from IDs
  const childEntries = await Promise.all(
    childEntryIds.map((id: string) => getCatalogEntry(userAccessToken, oktaDomain, id))
  );

  // Filter out any failed fetches (null entries)
  const validChildEntries = childEntries.filter((e: any) => e !== null);

  console.log('[AccessRequest] Fetched', validChildEntries.length, 'valid child entries');

  // Find matching entitlement
  const lowerMessage = userMessage.toLowerCase().trim();
  const selected = validChildEntries.find(
    (entry: any) =>
      entry.name?.toLowerCase().includes(lowerMessage) ||
      entry.displayName?.toLowerCase().includes(lowerMessage) ||
      lowerMessage.includes(entry.name?.toLowerCase()) ||
      lowerMessage.includes(entry.displayName?.toLowerCase())
  );

  if (!selected) {
    const options = validChildEntries
      .map((e: any, idx: number) => `${idx + 1}. ${e.displayName || e.name}`)
      .join('\n');
    return `I didn't find that option. Please select from:\n\n${options}`;
  }

  console.log('[AccessRequest] Selected entry:', selected.name);

  // Get request fields for selected entry
  const fields = await getRequestFields(userAccessToken, oktaDomain, selected.id);

  console.log('[AccessRequest] Retrieved', fields.length, 'fields for selected entry');

  // Filter to only required fields
  const requiredFields = fields.filter((f: any) => f.required);

  console.log('[AccessRequest] Required fields:', requiredFields.length);

  // Update workflow
  // Store only field IDs to keep session size small
  workflow.stage = requiredFields.length > 0 ? 'collecting_fields' : 'awaiting_confirmation';
  workflow.selectedEntryId = selected.id;
  workflow.selectedEntryName = selected.displayName || selected.name;
  workflow.requestFieldIds = requiredFields.map((f: any) => f.id);
  workflow.collectedValues = {};
  workflow.currentFieldIndex = 0;

  // Debug: Log session size before save
  console.log('[DEBUG SESSION SIZE]', {
    workflowSize: JSON.stringify(workflow).length,
    pendingActionSize: session.pendingAction ? JSON.stringify(session.pendingAction).length : 0,
    totalKeys: Object.keys(session).length,
    topLevelKeys: Object.keys(session).filter((k: string) => typeof (session as any)[k] === 'object').map((k: string) => ({
      key: k,
      size: JSON.stringify((session as any)[k]).length
    })),
    fullSessionEstimate: JSON.stringify(session).length
  });

  // RIGHT BEFORE: await session.save()
  console.log('[DEBUG FINAL SESSION]', {
    note: 'Tokens moved to separate cookies (not in session)',
    workflowSize: JSON.stringify(session.pendingAccessRequestWorkflow).length,
    conversationHistorySize: session.conversationHistory ? JSON.stringify(session.conversationHistory).length : 0,
    pendingActionSize: session.pendingAction ? JSON.stringify(session.pendingAction).length : 0,
    userIdSize: session.userId ? session.userId.length : 0,
    userEmailSize: session.userEmail ? session.userEmail.length : 0,
    allSessionKeys: Object.keys(session),
    allSessionSizes: Object.keys(session)
      .filter(k => typeof session[k] === 'object')
      .map(k => ({
        key: k,
        size: JSON.stringify(session[k]).length
      })),
    totalEstimate: JSON.stringify(session).length
  });

  await session.save();

  // If no required fields, show confirmation immediately
  if (requiredFields.length === 0) {
    return showConfirmationPreview(workflow);
  }

  // Ask for first field
  return askForNextField(requiredFields[0], 0, requiredFields.length);
}

/**
 * Stage Handler: Collecting Fields
 */
async function handleCollectingFields(
  userMessage: string,
  session: any,
  userAccessToken: string,
  oktaDomain: string
): Promise<string> {
  const workflow = session.pendingAccessRequestWorkflow;
  const currentFieldIndex = workflow.currentFieldIndex || 0;
  const requestFieldIds = workflow.requestFieldIds || [];

  if (currentFieldIndex >= requestFieldIds.length) {
    console.error('[AccessRequest] No field at index:', currentFieldIndex);
    return 'Error: No field to process. Please start over.';
  }

  // Fetch full field objects from IDs
  const entryId = workflow.selectedEntryId;
  const allFields = await getRequestFields(userAccessToken, oktaDomain, entryId);
  const requestFields = allFields.filter((f: any) => requestFieldIds.includes(f.id));

  const field = requestFields[currentFieldIndex];

  if (!field) {
    console.error('[AccessRequest] No field at index:', currentFieldIndex);
    return 'Error: No field to process. Please start over.';
  }

  console.log('[AccessRequest] Collecting field:', field.id);
  console.log('[AccessRequest] Field type:', field.type);
  console.log('[AccessRequest] User input:', userMessage);

  // Parse field value
  let parsedValue: any;
  try {
    parsedValue = parseFieldValue(field.id, field.type, userMessage);
    console.log('[AccessRequest] Parsed value:', parsedValue);
  } catch (error: any) {
    console.error('[AccessRequest] Parse error:', error.message);
    return `Invalid value for ${field.id}: ${error.message}\n\nPlease try again.`;
  }

  // Store value
  workflow.collectedValues[field.id] = parsedValue;

  console.log('[AccessRequest] Collected values so far:', Object.keys(workflow.collectedValues).length);

  // Check if more fields needed
  if (currentFieldIndex < requestFieldIds.length - 1) {
    // Move to next field
    workflow.currentFieldIndex = currentFieldIndex + 1;
    const nextField = requestFields[workflow.currentFieldIndex];

    await session.save();

    return askForNextField(nextField, workflow.currentFieldIndex, requestFieldIds.length);
  } else {
    // All fields collected, show confirmation
    workflow.stage = 'awaiting_confirmation';
    await session.save();

    console.log('[AccessRequest] All fields collected, showing confirmation');
    return showConfirmationPreview(workflow);
  }
}

/**
 * Stage Handler: Smart Parse Confirmation
 * Handles confirmation for smart-parsed complete requests
 */
async function handleSmartParseConfirmation(
  userMessage: string,
  session: any,
  userAccessToken: string,
  oktaDomain: string,
  mcpAccessToken: string,
  mcpEndpoint: string
): Promise<string> {
  const workflow = session.pendingAccessRequestWorkflow;
  const lowerMessage = userMessage.toLowerCase().trim();

  console.log('[AccessRequest] Handling smart parse confirmation');
  console.log('[AccessRequest] User message:', userMessage);

  if (
    lowerMessage === 'yes' ||
    lowerMessage === 'confirm' ||
    lowerMessage === 'y' ||
    lowerMessage.includes('confirm')
  ) {
    // Create request
    console.log('[AccessRequest] Creating access request from smart parse');
    console.log('[AccessRequest] Entry ID:', workflow.selectedEntryId);
    console.log('[AccessRequest] Collected values:', workflow.collectedValues);

    try {
      // Transform to proper payload format and resolve usernames
      const requestPayload = await buildAccessRequestPayload(
        workflow.collectedValues,
        session.userId,
        mcpAccessToken,
        mcpEndpoint
      );

      const createdRequest = await createAccessRequest(
        userAccessToken,
        oktaDomain,
        workflow.selectedEntryId,
        requestPayload
      );

      // Clear workflow and conversation history to prevent session bloat
      session.pendingAccessRequestWorkflow = undefined;
      session.conversationHistory = [];
      await session.save();

      console.log('[AccessRequest] Request created:', createdRequest.id);

      return `✅ **Access request created successfully!**\n\n**Resource:** ${workflow.resourceName}\n**Access Level:** ${workflow.selectedEntryName}\n**Request ID:** ${createdRequest.id}\n**Status:** ${createdRequest.status || 'PENDING'}\n\nYou'll be notified when your request is approved.`;
    } catch (error: any) {
      console.error('[AccessRequest] Error creating request:', error.message);

      // Clear workflow and conversation history on error
      session.pendingAccessRequestWorkflow = undefined;
      session.conversationHistory = [];
      await session.save();

      return `❌ **Failed to create access request**\n\nError: ${error.message}`;
    }
  } else if (
    lowerMessage === 'no' ||
    lowerMessage === 'cancel' ||
    lowerMessage === 'n' ||
    lowerMessage.includes('cancel')
  ) {
    // Cancel request
    console.log('[AccessRequest] Smart parse request cancelled by user');

    // Clear workflow and conversation history on cancel
    session.pendingAccessRequestWorkflow = undefined;
    session.conversationHistory = [];
    await session.save();

    return '❌ Access request cancelled.';
  } else {
    return `Please type **"confirm"** to submit the request, or **"cancel"** to abort.`;
  }
}

/**
 * Stage Handler: Awaiting Confirmation
 */
async function handleAwaitingConfirmation(
  userMessage: string,
  session: any,
  userAccessToken: string,
  oktaDomain: string,
  mcpAccessToken: string,
  mcpEndpoint: string
): Promise<string> {
  const workflow = session.pendingAccessRequestWorkflow;
  const lowerMessage = userMessage.toLowerCase().trim();

  console.log('[AccessRequest] Handling confirmation');
  console.log('[AccessRequest] User message:', userMessage);

  if (
    lowerMessage === 'yes' ||
    lowerMessage === 'confirm' ||
    lowerMessage === 'y' ||
    lowerMessage.includes('confirm')
  ) {
    // Create request
    console.log('[AccessRequest] Creating access request');
    console.log('[AccessRequest] Entry ID:', workflow.selectedEntryId);
    console.log('[AccessRequest] Collected values:', workflow.collectedValues);

    try {
      // Transform collected values into proper request format
      // Handle "myself" case and username resolution
      const requestPayload = await buildAccessRequestPayload(
        workflow.collectedValues,
        session.userId,
        mcpAccessToken,
        mcpEndpoint
      );

      console.log('[AccessRequest] Transformed payload:', requestPayload);

      const createdRequest = await createAccessRequest(
        userAccessToken,
        oktaDomain,
        workflow.selectedEntryId,
        requestPayload
      );

      // Clear workflow and conversation history to prevent session bloat
      session.pendingAccessRequestWorkflow = undefined;
      session.conversationHistory = [];
      await session.save();

      console.log('[AccessRequest] Request created:', createdRequest.id);

      return `✅ **Access request created successfully!**\n\n**Request ID:** ${createdRequest.id}\n**Status:** ${createdRequest.status || 'PENDING'}\n\nYou'll be notified when your request is approved.`;
    } catch (error: any) {
      console.error('[AccessRequest] Error creating request:', error.message);

      // Clear workflow and conversation history on error
      session.pendingAccessRequestWorkflow = undefined;
      session.conversationHistory = [];
      await session.save();

      return `❌ **Failed to create access request**\n\nError: ${error.message}`;
    }
  } else if (
    lowerMessage === 'no' ||
    lowerMessage === 'cancel' ||
    lowerMessage === 'n' ||
    lowerMessage.includes('cancel')
  ) {
    // Cancel request
    console.log('[AccessRequest] Request cancelled by user');

    // Clear workflow and conversation history on cancel
    session.pendingAccessRequestWorkflow = undefined;
    session.conversationHistory = [];
    await session.save();

    return '❌ Access request cancelled.';
  } else {
    return `Please type **"confirm"** to submit the request, or **"cancel"** to abort.`;
  }
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
 * Detect if a tool response indicates an error
 * Returns true if the response is an error
 */
function isErrorResponse(toolResult: string): boolean {
  const lowerResult = toolResult.toLowerCase();
  const errorIndicators = [
    'not found',
    'error',
    'failed',
    'failure',
    'cannot',
    'unable to',
    'invalid',
    'does not exist',
  ];

  return errorIndicators.some(indicator => lowerResult.includes(indicator));
}

/**
 * Detect if a tool response indicates guidance is needed
 * Returns true if the response requires user input/selection
 */
function isGuidanceNeededResponse(toolResult: string): boolean {
  try {
    const parsed = JSON.parse(toolResult);
    return parsed.status === 'guidance_needed';
  } catch {
    // If not valid JSON or no status field, check string content
    const lowerResult = toolResult.toLowerCase();
    return lowerResult.includes('guidance_needed') ||
           lowerResult.includes('more information is needed') ||
           lowerResult.includes('selection required');
  }
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

    // 1. Get session and tokens from cookies
    const session = await getSession();
    const mcpAccessToken = await getMcpAccessToken();
    const userAccessToken = await getUserAccessToken();

    if (!mcpAccessToken) {
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

    // 2a. Check for end-user governance queries (My Requests, My Catalog, etc.)
    // These use userAccessToken, not mcpAccessToken (delegated admin)
    const latestUserMessage = messages[messages.length - 1];
    const userText =
      typeof latestUserMessage?.content === 'string'
        ? latestUserMessage.content
        : '';

    // 2b. Check for active access request workflow
    if (session.pendingAccessRequestWorkflow) {
      console.log('[Chat] Active workflow detected, stage:', session.pendingAccessRequestWorkflow.stage);

      if (!userAccessToken) {
        return NextResponse.json({
          message: 'Session expired. Please log in again to continue your access request.',
        });
      }

      const oktaDomain = process.env.NEXT_PUBLIC_OKTA_DOMAIN;
      if (!oktaDomain) {
        return NextResponse.json({
          message: 'Okta domain not configured. Cannot process access request.',
        });
      }

      let responseMessage: string;

      try {
        switch (session.pendingAccessRequestWorkflow.stage) {
          case 'awaiting_entitlement_selection':
            responseMessage = await handleAwaitingEntitlementSelection(
              userText,
              session,
              userAccessToken,
              oktaDomain
            );
            break;

          case 'collecting_fields':
            responseMessage = await handleCollectingFields(
              userText,
              session,
              userAccessToken,
              oktaDomain
            );
            break;

          case 'awaiting_confirmation':
            responseMessage = await handleAwaitingConfirmation(
              userText,
              session,
              userAccessToken,
              oktaDomain,
              mcpAccessToken!,
              config.mcp.endpoints.toolsCall
            );
            break;

          case 'smart_parse_confirmation':
            responseMessage = await handleSmartParseConfirmation(
              userText,
              session,
              userAccessToken,
              oktaDomain,
              mcpAccessToken!,
              config.mcp.endpoints.toolsCall
            );
            break;

          default:
            console.error('[Chat] Unknown workflow stage:', session.pendingAccessRequestWorkflow.stage);
            session.pendingAccessRequestWorkflow = undefined;
            await session.save();
            responseMessage = 'Workflow error. Please start your access request again.';
        }

        return NextResponse.json({ message: responseMessage });
      } catch (error: any) {
        console.error('[Chat] Workflow error:', error.message);
        session.pendingAccessRequestWorkflow = undefined;
        await session.save();
        return NextResponse.json({
          message: `Error processing access request: ${error.message}. Please start over.`,
        });
      }
    }

    const governanceIntent = detectGovernanceIntent(userText);

    if (governanceIntent.type !== 'none') {
      console.log('[Chat] Detected governance intent:', governanceIntent.type);

      // Check if user has userAccessToken for end-user APIs
      if (!userAccessToken) {
        return NextResponse.json({
          message:
            'User access token not found. Please log in again to access your governance data.',
        });
      }

      try {
        // Special handling for access request workflow
        if (governanceIntent.type === 'request_access') {
          const oktaDomain = process.env.NEXT_PUBLIC_OKTA_DOMAIN;
          if (!oktaDomain) {
            return NextResponse.json({
              message: 'Okta domain not configured. Cannot process access request.',
            });
          }

          if (!governanceIntent.resourceName) {
            return NextResponse.json({
              message: 'Please specify which resource you\'d like to request access to. For example: "Request access to Adobe"',
            });
          }

          console.log('[Chat] Initiating access request workflow for:', governanceIntent.resourceName);

          // Parse complete intent to check if user provided all details upfront
          const parsedIntent = parseAccessRequestIntent(userText);
          console.log('[AccessRequest] Parsed intent:', JSON.stringify(parsedIntent));

          // Use parsed resource name (which splits parent from entitlement) if available
          const searchResourceName = parsedIntent.resourceName || governanceIntent.resourceName;
          console.log('[AccessRequest] Searching for parent app:', searchResourceName);

          // Step 1: Find parent entry using helper
          const parentEntry = await findParentEntry(
            searchResourceName,
            userAccessToken!,
            oktaDomain
          );

          if (!parentEntry) {
            // Could not find matching entry, list available options
            const entries = await listCatalogEntries(userAccessToken!, oktaDomain);
            const availableList = entries
              .slice(0, 10)
              .map((e: any) => `- ${e.displayName || e.name}`)
              .join('\n');

            return NextResponse.json({
              message: `I couldn't find "${governanceIntent.resourceName}" in the catalog. Here are some available resources:\n\n${availableList}\n\nPlease specify which one you'd like to request.`,
            });
          }

          console.log('[AccessRequest] Found parent entry:', parentEntry.name, 'requestable:', parentEntry.requestable);

          // Step 2: Check if entry is directly requestable
          if (parentEntry.requestable === false) {
            // Has child entitlements - need selection
            const childEntries = await getChildEntries(parentEntry.id, userAccessToken!, oktaDomain);

            if (childEntries.length === 0) {
              return NextResponse.json({
                message: `**${parentEntry.displayName || parentEntry.name}** requires selecting an access level, but none are available. Please contact your administrator.`,
              });
            }

            console.log('[AccessRequest] Entry has', childEntries.length, 'child entitlements');

            // Check if user specified entitlement name in message
            let selectedChild: any = null;
            if (parsedIntent.entitlementName) {
              const lowerEntitlement = parsedIntent.entitlementName.toLowerCase();
              selectedChild = childEntries.find(
                (entry: any) =>
                  entry.name?.toLowerCase().includes(lowerEntitlement) ||
                  entry.displayName?.toLowerCase().includes(lowerEntitlement) ||
                  lowerEntitlement.includes(entry.name?.toLowerCase()) ||
                  lowerEntitlement.includes(entry.displayName?.toLowerCase())
              );
            }

            if (!selectedChild) {
              // No match or no entitlement specified - show options
              // Initialize workflow for entitlement selection
              // Store only IDs to keep session size small
              session.pendingAccessRequestWorkflow = {
                stage: 'awaiting_entitlement_selection',
                resourceName: parentEntry.displayName || parentEntry.name,
                parentEntryId: parentEntry.id,
                childEntryIds: childEntries.map((e: any) => e.id),
              };

              // Debug: Log session size before save
              console.log('[DEBUG SESSION SIZE - Entitlement Selection Init]', {
                workflowSize: JSON.stringify(session.pendingAccessRequestWorkflow).length,
                pendingActionSize: session.pendingAction ? JSON.stringify(session.pendingAction).length : 0,
                totalKeys: Object.keys(session).length,
                topLevelKeys: Object.keys(session).filter((k: string) => typeof (session as any)[k] === 'object').map((k: string) => ({
                  key: k,
                  size: JSON.stringify((session as any)[k]).length
                })),
                fullSessionEstimate: JSON.stringify(session).length
              });

              await session.save();

              const options = childEntries
                .map((e: any, idx: number) => `${idx + 1}. ${e.displayName || e.name}`)
                .join('\n');

              return NextResponse.json({
                message: `**${parentEntry.displayName || parentEntry.name}** has multiple access levels:\n\n${options}\n\nWhich one would you like to request?`,
              });
            }

            // User specified entitlement and we found a match - use it
            console.log('[AccessRequest] Smart parsing matched entitlement:', selectedChild.name);
            // Continue with this entry as if it was the parent
            const entryToUse = selectedChild;
            const fields = await getRequestFields(userAccessToken!, oktaDomain, entryToUse.id);
            const requiredFields = fields.filter((f: any) => f.required);

            // Check if user provided all required field values
            if (parsedIntent.isComplete && requiredFields.length > 0) {
              // Pre-fill collected values from parsed intent
              const collectedValues: Record<string, any> = {};

              for (const field of requiredFields) {
                if (field.id === 'ACCESS_DURATION' && parsedIntent.duration) {
                  collectedValues[field.id] = parsedIntent.duration;
                } else if (field.id === 'OKTA_REQUESTED_FOR' && parsedIntent.requestedFor) {
                  collectedValues[field.id] = parsedIntent.requestedFor;
                } else if (field.id === 'JUSTIFICATION' && parsedIntent.justification) {
                  collectedValues[field.id] = parsedIntent.justification;
                }
              }

              // Check if we have all required fields
              const missingFields = requiredFields.filter((f: any) => !collectedValues[f.id]);

              if (missingFields.length === 0) {
                // All fields provided - show confirmation before creating
                console.log('[AccessRequest] All required fields provided via smart parsing, showing confirmation');

                session.pendingAccessRequestWorkflow = {
                  stage: 'smart_parse_confirmation',
                  resourceName: parentEntry.displayName || parentEntry.name,
                  selectedEntryId: entryToUse.id,
                  selectedEntryName: entryToUse.displayName || entryToUse.name,
                  collectedValues,
                };

                await session.save();

                // Format collected values for display
                const durationDisplay = collectedValues['ACCESS_DURATION']
                  ? formatDurationForDisplay(collectedValues['ACCESS_DURATION'])
                  : 'Not specified';
                const requestedForDisplay = collectedValues['OKTA_REQUESTED_FOR'] || 'myself';

                return NextResponse.json({
                  message: `**I detected a complete access request from your message:**\n\n` +
                    `📦 **Parent App:** ${parentEntry.displayName || parentEntry.name}\n` +
                    `🎯 **Bundle/Entitlement:** ${entryToUse.displayName || entryToUse.name}\n` +
                    `⏱️  **Duration:** ${durationDisplay}\n` +
                    `👤 **For:** ${requestedForDisplay}\n\n` +
                    `Type **"confirm"** to submit this request, or **"cancel"** to start over.`,
                });
              }

              // Some fields missing - start workflow with pre-filled values
              session.pendingAccessRequestWorkflow = {
                stage: 'collecting_fields',
                resourceName: parentEntry.displayName || parentEntry.name,
                selectedEntryId: entryToUse.id,
                selectedEntryName: entryToUse.displayName || entryToUse.name,
                requestFieldIds: requiredFields.map((f: any) => f.id),
                collectedValues,
                currentFieldIndex: Object.keys(collectedValues).length,
              };

              // Debug: Log session size before save
              console.log('[DEBUG SESSION SIZE - Child Entry Pre-filled Fields]', {
                workflowSize: JSON.stringify(session.pendingAccessRequestWorkflow).length,
                collectedValuesSize: JSON.stringify(collectedValues).length,
                pendingActionSize: session.pendingAction ? JSON.stringify(session.pendingAction).length : 0,
                totalKeys: Object.keys(session).length,
                topLevelKeys: Object.keys(session).filter((k: string) => typeof (session as any)[k] === 'object').map((k: string) => ({
                  key: k,
                  size: JSON.stringify((session as any)[k]).length
                })),
                fullSessionEstimate: JSON.stringify(session).length
              });

              await session.save();

              const nextFieldIndex = Object.keys(collectedValues).length;
              return NextResponse.json({
                message: askForNextField(requiredFields[nextFieldIndex], nextFieldIndex, requiredFields.length),
              });
            }

            // No complete intent - fall through to normal workflow below
            // (will be handled by the "Step 3" code below)
            // For now, start field collection workflow
            session.pendingAccessRequestWorkflow = {
              stage: 'collecting_fields',
              resourceName: parentEntry.displayName || parentEntry.name,
              selectedEntryId: entryToUse.id,
              selectedEntryName: entryToUse.displayName || entryToUse.name,
              requestFieldIds: requiredFields.map((f: any) => f.id),
              collectedValues: {},
              currentFieldIndex: 0,
            };

            // Debug: Log session size before save
            console.log('[DEBUG SESSION SIZE - Child Entry No Pre-fill]', {
              workflowSize: JSON.stringify(session.pendingAccessRequestWorkflow).length,
              pendingActionSize: session.pendingAction ? JSON.stringify(session.pendingAction).length : 0,
              totalKeys: Object.keys(session).length,
              topLevelKeys: Object.keys(session).filter((k: string) => typeof (session as any)[k] === 'object').map((k: string) => ({
                key: k,
                size: JSON.stringify((session as any)[k]).length
              })),
              fullSessionEstimate: JSON.stringify(session).length
            });

            await session.save();

            return NextResponse.json({
              message: askForNextField(requiredFields[0], 0, requiredFields.length),
            });
          }

          // Step 3: Entry is directly requestable - get request fields
          const fields = await getRequestFields(userAccessToken!, oktaDomain, parentEntry.id);
          const requiredFields = fields.filter((f: any) => f.required);

          console.log('[AccessRequest] Entry is requestable, found', requiredFields.length, 'required fields');

          if (requiredFields.length === 0) {
            // No required fields - create request immediately
            try {
              const requestData = {
                justification: `Access requested via chat for ${parentEntry.displayName || parentEntry.name}`,
              };

              const createdRequest = await createAccessRequest(
                userAccessToken!,
                oktaDomain,
                parentEntry.id,
                requestData
              );

              return NextResponse.json({
                message: `✅ **Access request created successfully!**\n\n**Request ID:** ${createdRequest.id}\n**Status:** ${createdRequest.status || 'PENDING'}\n\nYou'll be notified when your request is approved.`,
              });
            } catch (error: any) {
              return NextResponse.json({
                message: `❌ Failed to create access request: ${error.message}`,
              });
            }
          }

          // Step 4: Required fields - check if parsed intent has values
          // Pre-fill collected values from parsed intent if available
          const collectedValues: Record<string, any> = {};

          for (const field of requiredFields) {
            if (field.id === 'ACCESS_DURATION' && parsedIntent.duration) {
              collectedValues[field.id] = parsedIntent.duration;
            } else if (field.id === 'OKTA_REQUESTED_FOR' && parsedIntent.requestedFor) {
              collectedValues[field.id] = parsedIntent.requestedFor;
            } else if (field.id === 'JUSTIFICATION' && parsedIntent.justification) {
              collectedValues[field.id] = parsedIntent.justification;
            }
          }

          // Check if we have all required fields from smart parsing
          const missingFields = requiredFields.filter((f: any) => !collectedValues[f.id]);

          if (missingFields.length === 0) {
            // All fields provided - show confirmation before creating
            console.log('[AccessRequest] All required fields provided via smart parsing, showing confirmation');

            session.pendingAccessRequestWorkflow = {
              stage: 'smart_parse_confirmation',
              resourceName: parentEntry.displayName || parentEntry.name,
              selectedEntryId: parentEntry.id,
              selectedEntryName: parentEntry.displayName || parentEntry.name,
              collectedValues,
            };

            await session.save();

            // Format collected values for display
            const durationDisplay = collectedValues['ACCESS_DURATION']
              ? formatDurationForDisplay(collectedValues['ACCESS_DURATION'])
              : 'Not specified';
            const requestedForDisplay = collectedValues['OKTA_REQUESTED_FOR'] || 'myself';

            return NextResponse.json({
              message: `**I detected a complete access request from your message:**\n\n` +
                `📦 **Resource:** ${parentEntry.displayName || parentEntry.name}\n` +
                `⏱️  **Duration:** ${durationDisplay}\n` +
                `👤 **For:** ${requestedForDisplay}\n\n` +
                `Type **"confirm"** to submit this request, or **"cancel"** to start over.`,
            });
          }

          // Some fields missing or not provided - start field collection workflow
          // Store only field IDs to keep session size small
          const startFieldIndex = Object.keys(collectedValues).length;
          session.pendingAccessRequestWorkflow = {
            stage: 'collecting_fields',
            resourceName: parentEntry.displayName || parentEntry.name,
            selectedEntryId: parentEntry.id,
            selectedEntryName: parentEntry.displayName || parentEntry.name,
            requestFieldIds: requiredFields.map((f: any) => f.id),
            collectedValues,
            currentFieldIndex: startFieldIndex,
          };

          // Debug: Log session size before save
          console.log('[DEBUG SESSION SIZE - Direct Requestable with Fields]', {
            workflowSize: JSON.stringify(session.pendingAccessRequestWorkflow).length,
            collectedValuesSize: JSON.stringify(collectedValues).length,
            pendingActionSize: session.pendingAction ? JSON.stringify(session.pendingAction).length : 0,
            totalKeys: Object.keys(session).length,
            topLevelKeys: Object.keys(session).filter((k: string) => typeof (session as any)[k] === 'object').map((k: string) => ({
              key: k,
              size: JSON.stringify((session as any)[k]).length
            })),
            fullSessionEstimate: JSON.stringify(session).length
          });

          await session.save();

          return NextResponse.json({
            message: askForNextField(requiredFields[startFieldIndex], startFieldIndex, requiredFields.length),
          });
        }

        // Standard governance data fetching (non-request_access)
        let endpoint: string;
        let queryParams: string = '';

        switch (governanceIntent.type) {
          case 'requests':
            endpoint = '/api/governance/me/requests';
            break;
          case 'catalog':
            endpoint = '/api/governance/me/catalog';
            break;
          case 'reviews':
            endpoint = '/api/governance/me/security-access-reviews';
            break;
          case 'certifications':
            endpoint = '/api/governance/me/access-certification-reviews';
            break;
          case 'settings':
            endpoint = '/api/governance/me/settings';
            break;
          default:
            endpoint = '';
        }

        // Build query params if provided
        if (governanceIntent.params) {
          const params = new URLSearchParams();
          if (governanceIntent.params.limit)
            params.append('limit', String(governanceIntent.params.limit));
          if (governanceIntent.params.sortBy)
            params.append('sortBy', governanceIntent.params.sortBy);
          if (governanceIntent.params.sortOrder)
            params.append('sortOrder', governanceIntent.params.sortOrder);
          if (governanceIntent.params.campaignStatus)
            params.append('campaignStatus', governanceIntent.params.campaignStatus);

          if (params.toString()) {
            queryParams = `?${params.toString()}`;
          }
        }

        // Fetch data from governance API
        const fullUrl = `${request.nextUrl.origin}${endpoint}${queryParams}`;
        console.log('[Chat] Fetching governance data from:', fullUrl);

        const govResponse = await fetch(fullUrl, {
          headers: {
            Cookie: request.headers.get('cookie') || '',
          },
        });

        const govData = await govResponse.json();

        if (govData.error) {
          return NextResponse.json({
            message: `Error fetching ${governanceIntent.type}: ${govData.error.message}`,
          });
        }

        // Format data for Claude
        const dataCount = govData.data?.length || 0;
        const dataPreview =
          dataCount > 0
            ? JSON.stringify(govData.data.slice(0, 5), null, 2)
            : 'No items found';

        const systemPrompt = `You are a helpful governance assistant. The user asked: "${userText}"

I've fetched their ${governanceIntent.type} data from Okta Governance. Here's what I found:

**Count:** ${dataCount} items
**Data Preview (first 5 items):**
\`\`\`json
${dataPreview}
\`\`\`

Please provide a human-readable summary of this data. Format it nicely with:
- Clear headings
- Bullet points for lists
- Status indicators where relevant
- Dates formatted readably

Be concise but informative. If there are no items, suggest what the user might do next.`;

        // Call LiteLLM to format the response
        const litellmApiBase = process.env.LITELLM_API_BASE || 'http://localhost:4000';
        const litellmApiKey = process.env.LITELLM_API_KEY;
        const litellmModel = process.env.LITELLM_MODEL || 'claude-3-5-sonnet-20241022';

        const litellmResponse = await fetch(`${litellmApiBase}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(litellmApiKey && { Authorization: `Bearer ${litellmApiKey}` }),
          },
          body: JSON.stringify({
            model: litellmModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userText },
            ],
            temperature: 0.3,
            max_tokens: 2000,
          }),
        });

        if (!litellmResponse.ok) {
          const errorText = await litellmResponse.text();
          console.error('[Chat] LiteLLM error:', errorText);
          return NextResponse.json({
            message: `Found ${dataCount} ${governanceIntent.type} items, but failed to format the response.`,
          });
        }

        const litellmData = await litellmResponse.json();
        const formattedMessage =
          litellmData.choices?.[0]?.message?.content || `Found ${dataCount} items.`;

        return NextResponse.json({
          message: formattedMessage,
        });
      } catch (error: any) {
        console.error('[Chat] Governance intent handling error:', error);
        return NextResponse.json({
          message: `Error processing ${governanceIntent.type} request: ${error.message}`,
        });
      }
    }

    // 3. Deterministic pre-router for app-specific governance requests
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
          const toolArgs: Record<string, unknown> = {
            appId: pending.appId,
            action: pending.action,
            labelName: pending.labelName,
          };

          // Include labelValue if it was selected during workflow
          if (pending.labelValue) {
            toolArgs.labelValue = pending.labelValue;
          }

          toolResult = await executeTool(
            'manage_app_labels',
            toolArgs,
            mcpAccessToken!,
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
            mcpAccessToken!,
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

        // Check if tool result indicates stub/mock implementation, error, or guidance needed
        const isStub = isStubResponse(toolResult);
        const isError = isErrorResponse(toolResult);
        const isGuidance = isGuidanceNeededResponse(toolResult);

        let resultMessage: string;

        if (isError) {
          // Backend returned an error - show failure
          resultMessage = pending.appName
            ? `❌ **Operation failed**

**Action:** ${pending.type} for ${pending.appName} (${pending.appId})

**Error:**
${toolResult}`
            : `❌ **Operation failed**

**Error:**
${toolResult}`;
        } else if (isGuidance) {
          // Backend needs more information - show guidance
          // Parse the message from the JSON response instead of showing raw JSON
          try {
            const parsed = JSON.parse(toolResult);
            const guidanceMessage = parsed.message || toolResult;
            resultMessage = guidanceMessage;
          } catch {
            // If parsing fails, show the raw result
            resultMessage = `ℹ️ **More information needed**

${toolResult}`;
          }
        } else if (isStub) {
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

    // Check for pending label workflow (value selection follow-up)
    if (session.pendingLabelWorkflow && session.pendingLabelWorkflow.stage === 'awaiting_value_selection') {
      console.log('[Chat] Pending label workflow detected, treating input as value selection');

      const workflow = session.pendingLabelWorkflow;
      const selectedValue = userText.trim();

      console.log('[Chat] Selected value:', selectedValue);
      console.log('[Chat] Available values:', workflow.availableValues);

      // Continue the workflow by calling backend with selected value
      const continueResult = await executeTool(
        'manage_app_labels',
        {
          action: 'apply',
          appId: workflow.appId,
          labelName: workflow.labelName,
          labelValue: selectedValue,
        },
        mcpAccessToken!,
        config.mcp.endpoints.toolsCall
      );

      // Check if backend still needs guidance or is ready for confirmation
      const stillNeedsGuidance = isGuidanceNeededResponse(continueResult);

      if (stillNeedsGuidance) {
        // Still needs more info (e.g., invalid value selection)
        try {
          const parsed = JSON.parse(continueResult);
          const guidanceMessage = parsed.message || continueResult;

          console.log('[Chat] Still needs guidance after value selection');
          return NextResponse.json({
            message: guidanceMessage,
            toolCalls: 0,
          });
        } catch {
          return NextResponse.json({
            message: continueResult,
            toolCalls: 0,
          });
        }
      }

      // Check if successful or ready for confirmation
      const isError = isErrorResponse(continueResult);

      if (isError) {
        // Value selection failed
        console.log('[Chat] Value selection failed');
        session.pendingLabelWorkflow = undefined;
        await session.save();

        return NextResponse.json({
          message: `❌ Failed to apply label: ${continueResult}`,
          toolCalls: 0,
        });
      }

      // Success or ready for confirmation - transition to confirmation stage
      console.log('[Chat] Value selected successfully, moving to confirmation stage');

      const draftSummary = `I will apply the following label:

**App:** ${workflow.appName || workflow.appId}
**App ID:** ${workflow.appId}
**Action:** Apply label
**Label:** ${workflow.labelName}
**Value:** ${selectedValue}

This action will:
- Add the '${workflow.labelName}' label with value '${selectedValue}' to ${workflow.appName || 'the application'}
- Make the app visible in filtered views for this label
- This change may affect governance reports and workflows

⚠️ **This is a write operation that will modify the application configuration.**

To proceed, please reply with "confirm".
To cancel, please reply with "cancel".`;

      // Store pending action for confirmation
      session.pendingAction = {
        type: 'manage_app_labels',
        appId: workflow.appId,
        appName: workflow.appName,
        action: 'apply',
        labelName: workflow.labelName,
        labelValue: selectedValue,
      };

      // Clear pending label workflow (now in pendingAction)
      session.pendingLabelWorkflow = undefined;
      await session.save();

      return NextResponse.json({
        message: draftSummary,
        toolCalls: 0,
      });
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
            mcpAccessToken!,
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
        mcpAccessToken!,
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
        mcpAccessToken!,
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
            mcpAccessToken!,
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
          mcpAccessToken!,
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
        lowerText.includes('assign') ||
        lowerText.includes('set') ||
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
            mcpAccessToken!,
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
        userText.match(/assign\s+label\s+['"]?([^'"]+)['"]?\s+to/i) ||
        userText.match(/assign\s+['"]?([^'"]+)['"]?\s+label\s+to/i) ||
        userText.match(/set\s+label\s+['"]?([^'"]+)['"]?\s+on/i) ||
        userText.match(/mark\s+\w+\s+as\s+['"]?([^'"]+)['"]?/i) ||
        userText.match(/add\s+['"]?([^'"]+)['"]?\s+label/i);

      const labelName = labelMatch?.[1]?.trim();

      if (!labelName) {
        return NextResponse.json({
          message:
            'To apply a label, please specify the label name.\n\nExample: "Apply label high-risk to Salesforce"',
        });
      }

      // CRITICAL FIX: Call backend first to check if guidance is needed
      // Do NOT show confirmation draft until we know we have all required info
      console.log('[Chat] Checking label requirements before confirmation');
      const checkResult = await executeTool(
        'manage_app_labels',
        {
          action: 'apply',
          appId,
          labelName,
          labelValue: labelName, // Try using labelName as value in case it matches
        },
        mcpAccessToken!,
        config.mcp.endpoints.toolsCall
      );

      // Check if backend needs guidance (value selection required)
      const needsGuidance = isGuidanceNeededResponse(checkResult);

      if (needsGuidance) {
        // Backend needs more information (e.g., value selection)
        // Show the guidance message, NOT a confirmation draft
        try {
          const parsed = JSON.parse(checkResult);
          const guidanceMessage = parsed.message || checkResult;

          console.log('[Chat] Label requires value selection, showing guidance');

          // CRITICAL: Store pending label workflow state for next turn
          session.pendingLabelWorkflow = {
            stage: 'awaiting_value_selection',
            toolName: 'manage_app_labels',
            action: 'apply',
            appId,
            appName: resolvedAppName,
            labelName,
            availableValues: parsed.availableValues || [],
            label: parsed.label, // Contains labelId if available
          };
          await session.save();

          console.log('[Chat] Stored pending label workflow state:', session.pendingLabelWorkflow);

          return NextResponse.json({
            message: guidanceMessage,
            toolCalls: 0,
          });
        } catch {
          // Fallback if parsing fails
          return NextResponse.json({
            message: checkResult,
            toolCalls: 0,
          });
        }
      }

      // If no guidance needed, proceed with confirmation draft
      // This means we have all required info (label + value)
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
            mcpAccessToken!,
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
            mcpAccessToken!,
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
            mcpAccessToken!,
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
            mcpAccessToken!,
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
            mcpAccessToken!,
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
