/**
 * Arg-aware scope constraint helpers
 *
 * These checks depend on per-call arguments (e.g., `scopeType`, `scopeId`)
 * which are NOT visible to the generic `evaluatePolicy` engine. Tool handlers
 * call these helpers AFTER the standard policy check, before doing real work.
 */

import type { AuthorizationContext, Capability } from '../types/index.js';

/**
 * Result of a scope-constraint check.
 */
export interface ScopeConstraintResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Verify that the requested analytics scope is one the caller is allowed to
 * operate on, given which capability variant they hold.
 *
 * Semantics:
 * - If the user holds the *.all capability passed in, any `scopeType` passes.
 * - `scopeType === 'all'` requires the *.all capability — otherwise reject.
 * - `scopeType === 'app'` with a `scopeId` is permitted only if `scopeId`
 *   appears in `context.targets.apps`.
 * - `scopeType === 'group' | 'department'` with only the .owned capability is
 *   currently rejected: there is no group-ownership constraint defined for
 *   analytics scope today.
 *
 * Phase-2 follow-up: extend `targets` to carry departments / group-ownership
 * for analytics, then loosen the rejection above.
 *
 * @param context - Caller's authorization context
 * @param args - The tool's input args; only `scopeType` and `scopeId` are read
 * @param ownedAllCapability - The matching `.all` capability for this tool
 *   (e.g., `'analytics.mining.all'`). Used both for the bypass check and for
 *   error messaging.
 */
export function checkScopeToOwnedAppsOrAll(
  context: AuthorizationContext,
  args: { scopeType: string; scopeId?: string },
  ownedAllCapability: Capability,
): ScopeConstraintResult {
  const hasAllCapability = context.capabilities.includes(ownedAllCapability);

  if (hasAllCapability) {
    return { allowed: true };
  }

  if (args.scopeType === 'all') {
    return {
      allowed: false,
      reason: `Org-wide scope requires ${ownedAllCapability}`,
    };
  }

  if (args.scopeType === 'app') {
    if (!args.scopeId) {
      return {
        allowed: false,
        reason: 'scopeId is required when scopeType is "app"',
      };
    }
    if (!context.targets.apps.includes(args.scopeId)) {
      return {
        allowed: false,
        reason: `App ${args.scopeId} is not in your administrative scope`,
      };
    }
    return { allowed: true };
  }

  if (args.scopeType === 'group' || args.scopeType === 'department') {
    return {
      allowed: false,
      reason: `${args.scopeType} scope requires ${ownedAllCapability} (no per-${args.scopeType} ownership model defined yet)`,
    };
  }

  return {
    allowed: false,
    reason: `Unknown scopeType: ${args.scopeType}`,
  };
}
