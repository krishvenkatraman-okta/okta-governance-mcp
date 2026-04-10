/**
 * Risk-based governance engine
 *
 * Uses Okta System Log to detect:
 * - Inactive users (users with access but no usage)
 * - Low usage apps
 * - High-risk access assignments
 *
 * Risk scoring based on:
 * - Time since last access
 * - Frequency of access
 * - Type of access (SSO, direct, etc.)
 */

import { systemLogClient } from '../okta/systemlog-client.js';
import { appsClient } from '../okta/apps-client.js';

/**
 * Risk level classification
 */
export type RiskLevel = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Inactive user with risk assessment
 */
export interface InactiveUser {
  userId: string;
  userLogin?: string;
  lastAccess: string | null;
  daysSinceLastAccess: number | null;
  accessCount: number;
  riskLevel: RiskLevel;
  reason: string;
}

/**
 * Low usage app
 */
export interface LowUsageApp {
  appId: string;
  appName: string;
  appLabel: string;
  uniqueUsers: number;
  totalAccesses: number;
  usageScore: number;
  riskLevel: RiskLevel;
}

/**
 * Detect inactive users for a specific application
 *
 * Queries system logs to find users who have access to an app
 * but have NOT used it within the specified timeframe.
 *
 * @param appId - Application ID
 * @param inactivityDays - Number of days to look back (default: 60)
 * @returns Array of inactive users with risk levels
 *
 * @example
 * ```typescript
 * const inactive = await detectInactiveUsers('0oa123456', 60);
 * // Returns users who haven't accessed the app in 60 days
 * ```
 */
export async function detectInactiveUsers(
  appId: string,
  inactivityDays: number = 60
): Promise<InactiveUser[]> {
  console.log('[RiskEngine] Detecting inactive users:', {
    appId,
    inactivityDays,
  });

  try {
    // Calculate date range
    const since = new Date();
    since.setDate(since.getDate() - inactivityDays);
    const sinceISO = since.toISOString();

    console.debug('[RiskEngine] Querying system logs for app access:', {
      appId,
      since: sinceISO,
    });

    // Query system logs for app access events
    // Look for user.session.start and application.user_membership events
    const events = await systemLogClient.queryLogs({
      filter: `target.id eq "${appId}"`,
      since: sinceISO,
      limit: 1000,
      sortOrder: 'DESCENDING',
    });

    console.log('[RiskEngine] Retrieved system log events:', {
      appId,
      eventCount: events.length,
    });

    // Build map of user activity
    const userActivity = new Map<
      string,
      {
        userId: string;
        userLogin: string;
        lastAccess: string;
        accessCount: number;
        eventTypes: Set<string>;
      }
    >();

    for (const event of events) {
      if (!event.actor?.id) continue;

      const userId = event.actor.id;
      const userLogin = event.actor.alternateId || event.actor.displayName || userId;
      const published = event.published;

      if (!userActivity.has(userId)) {
        userActivity.set(userId, {
          userId,
          userLogin,
          lastAccess: published,
          accessCount: 0,
          eventTypes: new Set(),
        });
      }

      const activity = userActivity.get(userId)!;
      activity.accessCount++;
      activity.eventTypes.add(event.eventType);

      // Update last access if this event is more recent
      if (new Date(published) > new Date(activity.lastAccess)) {
        activity.lastAccess = published;
      }
    }

    console.log('[RiskEngine] Analyzed user activity:', {
      appId,
      uniqueUsers: userActivity.size,
    });

    // Convert to inactive user records with risk assessment
    const now = new Date();
    const inactiveUsers: InactiveUser[] = [];

    for (const activity of userActivity.values()) {
      const lastAccessDate = new Date(activity.lastAccess);
      const daysSinceAccess = Math.floor(
        (now.getTime() - lastAccessDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Only include users who haven't accessed recently
      if (daysSinceAccess > inactivityDays / 2) {
        // More than half the lookback period
        const riskLevel = assessInactivityRisk(daysSinceAccess, activity.accessCount);

        inactiveUsers.push({
          userId: activity.userId,
          userLogin: activity.userLogin,
          lastAccess: activity.lastAccess,
          daysSinceLastAccess: daysSinceAccess,
          accessCount: activity.accessCount,
          riskLevel,
          reason: getRiskReason(daysSinceAccess, activity.accessCount),
        });
      }
    }

    // Sort by risk level (HIGH first) then by days since access
    inactiveUsers.sort((a, b) => {
      const riskOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      const riskDiff = riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
      if (riskDiff !== 0) return riskDiff;
      return (b.daysSinceLastAccess || 0) - (a.daysSinceLastAccess || 0);
    });

    console.log('[RiskEngine] Inactive users detected:', {
      appId,
      totalInactive: inactiveUsers.length,
      highRisk: inactiveUsers.filter((u) => u.riskLevel === 'HIGH').length,
      mediumRisk: inactiveUsers.filter((u) => u.riskLevel === 'MEDIUM').length,
      lowRisk: inactiveUsers.filter((u) => u.riskLevel === 'LOW').length,
    });

    return inactiveUsers;
  } catch (error) {
    console.error('[RiskEngine] Error detecting inactive users:', {
      appId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Assess risk level based on inactivity duration and access frequency
 *
 * Risk levels:
 * - HIGH: No access in >90% of lookback period, or 0 accesses
 * - MEDIUM: No access in >75% of lookback period, or very low access
 * - LOW: Some recent access but declining
 *
 * @param daysSinceAccess - Days since last access
 * @param accessCount - Total access count in period
 * @returns Risk level
 */
function assessInactivityRisk(daysSinceAccess: number, accessCount: number): RiskLevel {
  // No activity at all - highest risk
  if (accessCount === 0) {
    return 'HIGH';
  }

  // Very infrequent access and long time since last access
  if (daysSinceAccess > 90 || (daysSinceAccess > 60 && accessCount < 3)) {
    return 'HIGH';
  }

  // Moderate inactivity
  if (daysSinceAccess > 45 || accessCount < 5) {
    return 'MEDIUM';
  }

  // Some activity but declining
  return 'LOW';
}

/**
 * Get human-readable risk reason
 */
function getRiskReason(daysSinceAccess: number, accessCount: number): string {
  if (accessCount === 0) {
    return 'No recorded access in lookback period';
  }

  if (daysSinceAccess > 90) {
    return `No access for ${daysSinceAccess} days`;
  }

  if (accessCount < 3) {
    return `Very low usage (${accessCount} access${accessCount === 1 ? '' : 'es'})`;
  }

  if (accessCount < 5) {
    return `Low usage (${accessCount} accesses in ${daysSinceAccess} days)`;
  }

  return `Declining usage (last access ${daysSinceAccess} days ago)`;
}

/**
 * Detect low usage apps across the organization
 *
 * Identifies applications with low overall usage that may be
 * candidates for deprovisioning or access review.
 *
 * @param usageThreshold - Minimum unique users to be considered "active" (default: 5)
 * @param lookbackDays - Days to analyze (default: 60)
 * @returns Array of low usage apps with risk assessment
 *
 * @example
 * ```typescript
 * const lowUsage = await detectLowUsageApps(5, 60);
 * // Returns apps with fewer than 5 unique users in last 60 days
 * ```
 */
export async function detectLowUsageApps(
  usageThreshold: number = 5,
  lookbackDays: number = 60
): Promise<LowUsageApp[]> {
  console.log('[RiskEngine] Detecting low usage apps:', {
    usageThreshold,
    lookbackDays,
  });

  try {
    // Get all active apps
    const apps = await appsClient.list({
      filter: 'status eq "ACTIVE"',
      limit: 200,
    });

    console.log('[RiskEngine] Analyzing usage for apps:', {
      totalApps: apps.length,
    });

    const lowUsageApps: LowUsageApp[] = [];

    // Calculate date range
    const since = new Date();
    since.setDate(since.getDate() - lookbackDays);

    // Analyze usage for each app
    for (const app of apps) {
      try {
        // Query logs for this app
        const events = await systemLogClient.queryRecentLogsForApp(app.id, lookbackDays);

        // Count unique users
        const uniqueUsers = new Set<string>();
        for (const event of events) {
          if (event.actor?.id) {
            uniqueUsers.add(event.actor.id);
          }
        }

        const uniqueUserCount = uniqueUsers.size;
        const totalAccesses = events.length;

        // Calculate usage score (unique users weighted by access frequency)
        const usageScore = uniqueUserCount + Math.log10(totalAccesses + 1);

        // Flag apps below threshold
        if (uniqueUserCount < usageThreshold) {
          const riskLevel = assessLowUsageRisk(uniqueUserCount, totalAccesses, usageThreshold);

          lowUsageApps.push({
            appId: app.id,
            appName: app.name,
            appLabel: app.label,
            uniqueUsers: uniqueUserCount,
            totalAccesses,
            usageScore,
            riskLevel,
          });
        }
      } catch (error) {
        console.warn('[RiskEngine] Failed to analyze app usage:', {
          appId: app.id,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with other apps
      }
    }

    // Sort by usage score (lowest first)
    lowUsageApps.sort((a, b) => a.usageScore - b.usageScore);

    console.log('[RiskEngine] Low usage apps detected:', {
      total: lowUsageApps.length,
      highRisk: lowUsageApps.filter((a) => a.riskLevel === 'HIGH').length,
      mediumRisk: lowUsageApps.filter((a) => a.riskLevel === 'MEDIUM').length,
      lowRisk: lowUsageApps.filter((a) => a.riskLevel === 'LOW').length,
    });

    return lowUsageApps;
  } catch (error) {
    console.error('[RiskEngine] Error detecting low usage apps:', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Assess risk level for low usage app
 */
function assessLowUsageRisk(
  uniqueUsers: number,
  totalAccesses: number,
  threshold: number
): RiskLevel {
  // No usage at all
  if (uniqueUsers === 0 || totalAccesses === 0) {
    return 'HIGH';
  }

  // Very low usage (< 25% of threshold)
  if (uniqueUsers < threshold * 0.25) {
    return 'HIGH';
  }

  // Below threshold but some usage (< 75% of threshold)
  if (uniqueUsers < threshold * 0.75) {
    return 'MEDIUM';
  }

  // Just below threshold
  return 'LOW';
}
