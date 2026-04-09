/**
 * Shared tool type definitions
 */

import type { McpTool, McpToolCallResponse, AuthorizationContext } from '../types/index.js';

/**
 * Tool handler function signature
 */
export type ToolHandler = (
  args: Record<string, unknown>,
  context: AuthorizationContext
) => Promise<McpToolCallResponse>;

/**
 * Tool definition with handler
 */
export interface ToolDefinition {
  definition: McpTool;
  handler: ToolHandler;
}

/**
 * Tool registry entry
 */
export interface ToolRegistryEntry {
  name: string;
  definition: McpTool;
  handler: ToolHandler;
  enabled: boolean;
}

/**
 * Helper to create text response
 */
export function createTextResponse(text: string, isError = false): McpToolCallResponse {
  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
    isError,
  };
}

/**
 * Helper to create error response
 */
export function createErrorResponse(error: string): McpToolCallResponse {
  return createTextResponse(error, true);
}

/**
 * Helper to create JSON response
 */
export function createJsonResponse(data: unknown): McpToolCallResponse {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}
