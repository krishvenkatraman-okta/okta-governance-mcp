/**
 * Tool executor with authorization checks
 *
 * Executes tool calls with re-authorization on every invocation
 */

import { getToolByName } from '../tools/index.js';
import { canUserAccessTool } from './tool-registry.js';
import { createErrorResponse } from '../tools/types.js';
import type { AuthorizationContext, McpToolCallRequest, McpToolCallResponse } from '../types/index.js';

/**
 * Execute a tool call
 *
 * Re-authorizes the tool call and executes the handler
 */
export async function executeTool(
  request: McpToolCallRequest,
  context: AuthorizationContext
): Promise<McpToolCallResponse> {
  const { name, arguments: args = {} } = request;

  // Get tool definition
  const tool = getToolByName(name);

  if (!tool) {
    return createErrorResponse(`Tool '${name}' not found`);
  }

  // Re-authorize the tool call
  const accessCheck = canUserAccessTool(name, context);

  if (!accessCheck.allowed) {
    return createErrorResponse(
      `Access denied to tool '${name}': ${accessCheck.reason || 'Insufficient permissions'}`
    );
  }

  // Log the tool execution (for audit)
  if (process.env.ENABLE_AUDIT_LOGGING === 'true') {
    console.log(`[AUDIT] Tool execution: ${name} by user ${context.subject}`);
  }

  try {
    // Execute the tool handler
    return await tool.handler(args, context);
  } catch (error) {
    console.error(`Tool execution error (${name}):`, error);
    return createErrorResponse(
      `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
