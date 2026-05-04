/**
 * Policy evaluation engine
 *
 * Evaluates whether a tool call is allowed based on:
 * - User capabilities
 * - Required scopes
 * - Target ownership
 * - Governance policy
 */

import { capabilityMapper } from './capability-mapper.js';
import { isAppOwned, isGroupOwned } from './target-resolver.js';
import type {
  AuthorizationContext,
  PolicyEvaluationResult,
  AuthorizationCheckRequest,
} from '../types/index.js';
import type { ToolRequirement } from '../types/index.js';

/**
 * Evaluate policy for a tool call
 */
export function evaluatePolicy(
  request: AuthorizationCheckRequest,
  toolRequirement: ToolRequirement
): PolicyEvaluationResult {
  const { context, resourceId } = request;

  // Check capabilities
  const hasRequiredCapabilities = capabilityMapper.hasAnyCapability(
    context.capabilities,
    toolRequirement.requiredCapabilities
  );

  if (!hasRequiredCapabilities) {
    return {
      allowed: false,
      reason: 'Missing required capabilities',
      missingCapabilities: toolRequirement.requiredCapabilities.filter(
        (cap) => !context.capabilities.includes(cap)
      ),
    };
  }

  // Check target constraints
  for (const constraint of toolRequirement.targetConstraints) {
    if (constraint === 'must_be_owned_app' && resourceId) {
      if (!isAppOwned(context, resourceId)) {
        return {
          allowed: false,
          reason: 'Resource must be an owned app',
          targetViolation: {
            required: 'must_be_owned_app',
            actual: resourceId,
          },
        };
      }
    }

    if (constraint === 'must_be_owned_group' && resourceId) {
      if (!isGroupOwned(context, resourceId)) {
        return {
          allowed: false,
          reason: 'Resource must be an owned group',
          targetViolation: {
            required: 'must_be_owned_group',
            actual: resourceId,
          },
        };
      }
    }

    // 'scope_to_owned_apps_or_all' is arg-aware (depends on args.scopeType /
    // args.scopeId) and the policy engine only sees `resourceId`. The capability
    // gate above already ensured the user has either the .owned or .all
    // analytics capability — the actual scope check runs in
    // src/policy/scope-constraint.ts from each tool handler.
    if (constraint === 'scope_to_owned_apps_or_all') {
      // no-op at policy-engine time
    }
  }

  // All checks passed
  return {
    allowed: true,
  };
}

/**
 * Check if user can access a tool at all
 *
 * Note: Tools with empty requiredCapabilities are always accessible (metadata tools)
 */
export function canAccessTool(
  context: AuthorizationContext,
  toolRequirement: ToolRequirement
): boolean {
  // If no capabilities required, tool is always accessible (metadata tools)
  if (toolRequirement.requiredCapabilities.length === 0) {
    return true;
  }

  return capabilityMapper.hasAnyCapability(context.capabilities, toolRequirement.requiredCapabilities);
}
