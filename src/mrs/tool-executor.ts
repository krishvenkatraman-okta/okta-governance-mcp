/**
 * Tool executor with authorization checks
 *
 * Executes tool calls with:
 * - Re-authorization on every invocation
 * - Scope resolution from tool requirements
 * - Comprehensive logging
 * - Structured error handling
 */

import { getToolByName } from '../tools/index.js';
import { canUserAccessTool } from './tool-registry.js';
import { getToolRequirement } from '../catalog/tool-requirements.js';
import { createErrorResponse } from '../tools/types.js';
import type {
  AuthorizationContext,
  McpToolCallRequest,
  McpToolCallResponse,
} from '../types/index.js';

/**
 * Execution context for logging and debugging
 */
interface ExecutionContext {
  toolName: string;
  subject: string;
  startTime: number;
  requiredScopes?: string[];
  targetResource?: string;
}

/**
 * Log tool execution start
 */
function logExecutionStart(context: ExecutionContext): void {
  console.log('[ToolExecutor] Starting tool execution:', {
    tool: context.toolName,
    subject: context.subject,
    timestamp: new Date().toISOString(),
    requiredScopes: context.requiredScopes,
    targetResource: context.targetResource,
  });
}

/**
 * Log tool execution end
 */
function logExecutionEnd(context: ExecutionContext, success: boolean): void {
  const duration = Date.now() - context.startTime;
  console.log('[ToolExecutor] Tool execution completed:', {
    tool: context.toolName,
    subject: context.subject,
    duration: `${duration}ms`,
    success,
  });
}

/**
 * Validate target resource constraints
 *
 * Ensures that if a tool requires a target resource (e.g., must_be_owned_app),
 * the provided resource ID is in the user's targets.
 */
function validateTargetConstraints(
  toolName: string,
  args: Record<string, unknown>,
  context: AuthorizationContext
): { valid: boolean; error?: string } {
  const requirement = getToolRequirement(toolName);

  if (!requirement) {
    // Metadata tools have no constraints
    return { valid: true };
  }

  // Check if tool requires target resource
  if (!requirement.requiresTargetResource) {
    return { valid: true };
  }

  // Extract appId from arguments
  const appId = args.appId as string | undefined;

  if (!appId) {
    return {
      valid: false,
      error: 'Missing required argument: appId (this tool requires a target application)',
    };
  }

  // Check if constraint is must_be_owned_app
  if (requirement.targetConstraints.includes('must_be_owned_app')) {
    if (context.roles.superAdmin) {
      // Super Admin can access any app
      return { valid: true };
    }

    if (!context.targets.apps.includes(appId)) {
      return {
        valid: false,
        error: `Access denied: Application ${appId} is not in your owned apps`,
      };
    }
  }

  return { valid: true };
}

/**
 * Execute a tool call
 *
 * Flow:
 * 1. Lookup tool definition
 * 2. Validate authorization (capabilities + roles)
 * 3. Validate target constraints (ownership)
 * 4. Resolve required scopes from tool requirements
 * 5. Execute tool handler
 * 6. Handle errors with structured messages
 */
export async function executeTool(
  request: McpToolCallRequest,
  context: AuthorizationContext
): Promise<McpToolCallResponse> {
  const { name, arguments: args = {} } = request;

  const execContext: ExecutionContext = {
    toolName: name,
    subject: context.subject,
    startTime: Date.now(),
  };

  // Step 1: Get tool definition
  const tool = getToolByName(name);

  if (!tool) {
    console.error(`[ToolExecutor] Tool not found: ${name}`);
    return createErrorResponse(`Tool '${name}' not found`);
  }

  // Step 2: Re-authorize the tool call (capability + role check)
  const accessCheck = canUserAccessTool(name, context);

  if (!accessCheck.allowed) {
    console.warn('[ToolExecutor] Authorization denied:', {
      tool: name,
      subject: context.subject,
      reason: accessCheck.reason,
    });

    return createErrorResponse(
      `Access denied to tool '${name}': ${accessCheck.reason || 'Insufficient permissions'}`
    );
  }

  // Step 3: Validate target constraints (e.g., owned apps)
  const constraintCheck = validateTargetConstraints(name, args, context);

  if (!constraintCheck.valid) {
    console.warn('[ToolExecutor] Target constraint violation:', {
      tool: name,
      subject: context.subject,
      error: constraintCheck.error,
    });

    return createErrorResponse(constraintCheck.error!);
  }

  // Step 4: Resolve required scopes from tool requirements
  const requirement = getToolRequirement(name);
  if (requirement) {
    execContext.requiredScopes = requirement.requiredScopes;
    execContext.targetResource = args.appId as string | undefined;
  }

  // Log execution start
  logExecutionStart(execContext);

  // Audit logging (if enabled)
  if (process.env.ENABLE_AUDIT_LOGGING === 'true') {
    console.log(`[AUDIT] Tool execution: ${name} by user ${context.subject}`, {
      args: Object.keys(args),
      scopes: execContext.requiredScopes,
    });
  }

  try {
    // Step 5: Execute the tool handler
    const result = await tool.handler(args, context);

    logExecutionEnd(execContext, !result.isError);

    return result;
  } catch (error) {
    // Step 6: Handle errors
    console.error(`[ToolExecutor] Tool execution error (${name}):`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    logExecutionEnd(execContext, false);

    // Categorize errors for better user feedback
    if (error instanceof Error) {
      // OAuth/API errors
      if (error.message.includes('401') || error.message.includes('403')) {
        return createErrorResponse(
          `Authorization error: ${error.message}\n\nThe service app may lack required OAuth scopes: ${execContext.requiredScopes?.join(', ') || 'unknown'}`
        );
      }

      // Rate limiting
      if (error.message.includes('429')) {
        return createErrorResponse(
          'Rate limit exceeded. Please try again in a few moments.'
        );
      }

      // Not found
      if (error.message.includes('404')) {
        return createErrorResponse(
          `Resource not found. Please verify the IDs provided are correct.`
        );
      }

      // Generic error
      return createErrorResponse(`Tool execution failed: ${error.message}`);
    }

    return createErrorResponse('Tool execution failed: Unknown error');
  }
}
