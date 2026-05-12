#!/usr/bin/env tsx
/**
 * Demo: Advanced Governance Capabilities
 *
 * End-to-end exercise of the analytics layer powering the four advanced
 * governance MCP tools:
 *
 *   1. mineRoles          (mine_candidate_roles)
 *   2. detectOutliers     (detect_entitlement_outliers)
 *   3. explainAccess      (explain_user_access)
 *   4. buildSmartCampaign (generate_smart_campaign)
 *
 * Hits live Okta — requires a working `.env` (the same one the MRS uses)
 * and a service-app token capable of reading users/groups/apps and the
 * governance entitlements API.
 *
 * Usage:
 *   DEMO_APP_ID=0oaXXXX npm run demo-advanced
 *
 * If DEMO_APP_ID is not provided the script falls back to the constant
 * below; set it to a real app id in your tenant before running.
 */

import { config } from '../src/config/index.js';
import {
  buildAccessGraph,
  mineRoles,
  detectOutliers,
  explainAccess,
  buildSmartCampaign,
} from '../src/analytics/index.js';

const DEMO_APP_ID = process.env.DEMO_APP_ID || '0oaREPLACEME';

async function timed<T>(
  label: string,
  fn: () => Promise<T> | T,
): Promise<{ value: T; ms: number }> {
  const startedAt = Date.now();
  console.log(`\n▶ ${label}`);
  const value = await fn();
  const ms = Date.now() - startedAt;
  console.log(`✓ ${label} — ${ms}ms`);
  return { value, ms };
}

function printJson(label: string, value: unknown): void {
  console.log(`\n--- ${label} ---`);
  console.log(JSON.stringify(value, null, 2));
}

async function main(): Promise<void> {
  console.log('Okta Governance — Advanced Capabilities Demo');
  console.log('Tenant:', config.okta.domain);
  console.log('App in scope:', DEMO_APP_ID);

  if (DEMO_APP_ID === '0oaREPLACEME') {
    console.warn(
      '\n⚠️  DEMO_APP_ID is unset — using the placeholder. Set ' +
        '`DEMO_APP_ID=<real-app-id>` before running for live results.',
    );
  }

  // Step 1: Build the access graph snapshot.
  const { value: snapshot, ms: graphMs } = await timed(
    'Step 1 — buildAccessGraph',
    () => buildAccessGraph({ scopeType: 'app', scopeId: DEMO_APP_ID }),
  );
  console.log(
    `  users=${snapshot.users.length} ` +
      `groups=${Object.keys(snapshot.groupsById).length} ` +
      `apps=${Object.keys(snapshot.appsById).length} ` +
      `entitlements=${Object.keys(snapshot.entitlementsById).length}`,
  );

  // Step 2: Role mining.
  const { value: mining, ms: miningMs } = await timed(
    'Step 2 — mineRoles',
    () => mineRoles(snapshot),
  );
  printJson('Mining summary', mining.summary);
  console.log(
    `  Top ${mining.candidateRoles.length} candidate role(s):`,
  );
  for (const role of mining.candidateRoles.slice(0, 5)) {
    console.log(
      `    • ${role.proposedName} ` +
        `[confidence=${role.confidence.toFixed(2)} ` +
        `members=${role.members.length} ` +
        `commonAccess=${role.commonAccess.length}]`,
    );
  }

  // Step 3: Outlier detection.
  const { value: outliers, ms: outlierMs } = await timed(
    'Step 3 — detectOutliers',
    () => detectOutliers(snapshot),
  );
  printJson('Outlier summary', outliers.summary);
  console.log(`  Top ${outliers.outliers.length} outlier user(s):`);
  for (const u of outliers.outliers.slice(0, 5)) {
    console.log(
      `    • ${u.login} ` +
        `[score=${u.outlierScore.toFixed(2)} ` +
        `flagged=${u.outlierEntitlements.length} ` +
        `recommendation=${u.overallRecommendation}]`,
    );
  }

  // Step 4: Explain access for the highest-scoring outlier's top
  // outlier entitlement (or app, depending on the access node type).
  let explainMs = 0;
  const top = outliers.outliers[0];
  const topEntry = top?.outlierEntitlements[0];
  if (top && topEntry) {
    const explainTargetType: 'app' | 'group' | 'entitlement' =
      topEntry.type === 'app'
        ? 'app'
        : topEntry.type === 'group'
        ? 'group'
        : 'entitlement';
    const entitlementAppId =
      topEntry.type === 'entitlement'
        ? snapshot.entitlementsById[topEntry.id]?.appId
        : undefined;

    const result = await timed(
      `Step 4 — explainAccess (${top.login} → ${explainTargetType}:${topEntry.id})`,
      () =>
        explainAccess({
          userId: top.userId,
          targetType: explainTargetType,
          targetId: topEntry.id,
          entitlementAppId,
          includeRedundantPaths: true,
        }),
    );
    explainMs = result.ms;
    const explanation = result.value;
    console.log(
      `  hasAccess=${explanation.hasAccess} ` +
        `paths=${explanation.paths.length} ` +
        `redundant=${explanation.summary.redundantPathCount}`,
    );
    console.log(`  ${explanation.summary.explanation}`);
    for (const path of explanation.paths.slice(0, 3)) {
      console.log(
        `    • [${path.pathType}${path.isPrimary ? ', primary' : ''}] ${path.narrative}`,
      );
    }
  } else {
    console.log(
      '\n▶ Step 4 — explainAccess skipped (no outliers with flagged entitlements)',
    );
  }

  // Step 5: Smart campaign preview (dryRun).
  const { value: campaign, ms: campaignMs } = await timed(
    'Step 5 — buildSmartCampaign (dryRun)',
    () =>
      buildSmartCampaign({
        snapshot,
        includeRules: {
          outliers: true,
          dormantAccess: true,
          directAssignments: true,
          recentGrants: true,
        },
        reviewerStrategy: 'manager',
      }),
  );
  printJson('Campaign summary', {
    name: campaign.campaignName,
    scope: campaign.scopeDescription,
    itemCount: campaign.itemCount,
    itemsByCategory: campaign.itemsByCategory,
    topReviewers: campaign.estimatedReviewerLoad.slice(0, 5),
  });
  console.log(`  Top ${Math.min(5, campaign.items.length)} item(s):`);
  for (const item of campaign.items.slice(0, 5)) {
    console.log(
      `    • ${item.userLogin} → ${item.accessType}:${item.accessName} ` +
        `[reasons=${item.reasonForInclusion.join('|')} ` +
        `risk=${item.riskScore.toFixed(2)} ` +
        `decision=${item.recommendedDecision}]`,
    );
  }

  // Wrap up.
  console.log('\n=== Elapsed ===');
  console.log(`  buildAccessGraph     ${graphMs}ms`);
  console.log(`  mineRoles            ${miningMs}ms`);
  console.log(`  detectOutliers       ${outlierMs}ms`);
  console.log(`  explainAccess        ${explainMs}ms`);
  console.log(`  buildSmartCampaign   ${campaignMs}ms`);
  console.log(
    `  total                ${graphMs + miningMs + outlierMs + explainMs + campaignMs}ms`,
  );
}

main().catch((err) => {
  console.error('\n❌ Demo failed:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
