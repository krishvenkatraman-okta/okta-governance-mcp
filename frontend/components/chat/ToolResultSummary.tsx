/**
 * ToolResultSummary Component
 *
 * Compact summary card rendered inside ChatInterface for results from
 * the four advanced-governance MCP tools. Replaces the default raw-JSON
 * rendering with a 300–400px tall card per tool, plus a "view details"
 * button that opens the InsightsHub at the matching tab pre-loaded
 * with the structured tool output.
 *
 * Tools handled:
 *   - mine_candidate_roles      → "Found X candidate roles"
 *   - detect_entitlement_outliers → "X users with outlier access"
 *   - explain_user_access       → "Access traced through N path(s)"
 *   - generate_smart_campaign   → "X items proposed for review · …"
 *
 * For any other tool name the component returns null — ChatInterface
 * falls back to rendering raw text in that case.
 */

'use client';

import type {
  ExplanationResultPayload,
  MiningResultPayload,
  OutlierResultPayload,
  SmartCampaignPayload,
} from '@/components/insights';
import { uiConfig } from '@/lib/ui-config';

export const SUMMARIZED_TOOLS = [
  'mine_candidate_roles',
  'detect_entitlement_outliers',
  'explain_user_access',
  'generate_smart_campaign',
] as const;

export type SummarizedToolName = (typeof SUMMARIZED_TOOLS)[number];

export function isSummarizedTool(name: string): name is SummarizedToolName {
  return (SUMMARIZED_TOOLS as readonly string[]).includes(name);
}

export interface ToolResultSummaryProps {
  toolName: string;
  toolOutput: unknown;
  onViewDetails: () => void;
}

export default function ToolResultSummary({
  toolName,
  toolOutput,
  onViewDetails,
}: ToolResultSummaryProps) {
  if (!isSummarizedTool(toolName)) return null;

  switch (toolName) {
    case 'mine_candidate_roles':
      return (
        <MiningSummary
          output={toolOutput as MiningResultPayload}
          onViewDetails={onViewDetails}
        />
      );
    case 'detect_entitlement_outliers':
      return (
        <OutlierSummary
          output={toolOutput as OutlierResultPayload}
          onViewDetails={onViewDetails}
        />
      );
    case 'explain_user_access':
      return (
        <ExplainSummary
          output={toolOutput as ExplanationResultPayload}
          onViewDetails={onViewDetails}
        />
      );
    case 'generate_smart_campaign':
      return (
        <CampaignSummary
          output={toolOutput as SmartCampaignPayload}
          onViewDetails={onViewDetails}
        />
      );
  }
}

function MiningSummary({
  output,
  onViewDetails,
}: {
  output: MiningResultPayload;
  onViewDetails: () => void;
}) {
  const top = output.candidateRoles.slice(0, 3);

  return (
    <SummaryCard
      icon="🪙"
      title={`Found ${output.summary.totalProposed} candidate role${
        output.summary.totalProposed === 1 ? '' : 's'
      }`}
      subtitle={`${output.summary.highConfidenceCount} high-confidence · ${output.totalUsersAnalyzed} user(s) analyzed`}
      buttonLabel="View all in Insights"
      onViewDetails={onViewDetails}
    >
      {top.length === 0 ? (
        <p className="text-xs italic" style={{ color: uiConfig.colors.gray600 }}>
          No clusters met the similarity threshold.
        </p>
      ) : (
        <ul className="space-y-1">
          {top.map((role, idx) => (
            <li key={`${role.proposedName}-${idx}`} className="text-sm">
              <span style={{ color: uiConfig.colors.gray900 }}>
                {role.proposedName}
              </span>
              <span className="text-xs ml-2" style={{ color: uiConfig.colors.gray600 }}>
                {role.memberCount} user{role.memberCount === 1 ? '' : 's'} ·{' '}
                {Math.round(role.confidence * 100)}% confidence
              </span>
            </li>
          ))}
        </ul>
      )}
    </SummaryCard>
  );
}

function OutlierSummary({
  output,
  onViewDetails,
}: {
  output: OutlierResultPayload;
  onViewDetails: () => void;
}) {
  const top = output.outliers[0];
  const topReason =
    top && top.outlierEntitlements.length > 0
      ? top.outlierEntitlements[0]
      : null;

  return (
    <SummaryCard
      icon="🛡️"
      title={`${output.summary.totalOutliers} user${
        output.summary.totalOutliers === 1 ? '' : 's'
      } with outlier access`}
      subtitle={`${output.summary.totalOutlierEntitlements} flagged entitlement(s)${
        output.summary.mostCommonOutlierApp
          ? ` · most-flagged app: ${output.summary.mostCommonOutlierApp}`
          : ''
      }`}
      buttonLabel="View report"
      onViewDetails={onViewDetails}
    >
      {top ? (
        <div className="text-sm">
          <div style={{ color: uiConfig.colors.gray900 }}>
            <strong>{top.displayName || top.login}</strong>
            <span className="text-xs ml-2" style={{ color: uiConfig.colors.gray600 }}>
              outlier score {top.outlierScore.toFixed(2)}
            </span>
          </div>
          {topReason && (
            <p className="text-xs mt-1" style={{ color: uiConfig.colors.gray600 }}>
              {topReason.recommendation}: {topReason.name} (only{' '}
              {Math.round(topReason.peerCoverage * 100)}% of peers have this)
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs italic" style={{ color: uiConfig.colors.gray600 }}>
          No outliers above the threshold in this scope.
        </p>
      )}
    </SummaryCard>
  );
}

function ExplainSummary({
  output,
  onViewDetails,
}: {
  output: ExplanationResultPayload;
  onViewDetails: () => void;
}) {
  return (
    <SummaryCard
      icon="💡"
      title={
        output.hasAccess
          ? `Access traced through ${output.summary.totalPaths} path${
              output.summary.totalPaths === 1 ? '' : 's'
            }`
          : 'No access path found'
      }
      subtitle={`${output.user.displayName || output.user.login} → ${output.target.name} (${output.target.type})`}
      buttonLabel="Explore paths"
      onViewDetails={onViewDetails}
    >
      <p className="text-sm" style={{ color: uiConfig.colors.gray700 }}>
        {output.summary.explanation}
      </p>
      {output.summary.redundantPathCount > 0 && (
        <p className="text-xs mt-2" style={{ color: uiConfig.colors.gray600 }}>
          {output.summary.redundantPathCount} redundant path
          {output.summary.redundantPathCount === 1 ? '' : 's'}.
        </p>
      )}
    </SummaryCard>
  );
}

function CampaignSummary({
  output,
  onViewDetails,
}: {
  output: SmartCampaignPayload;
  onViewDetails: () => void;
}) {
  const reviewerCount = output.estimatedReviewerLoad.length;
  const headline = output.dryRun
    ? `${output.itemCount} item${output.itemCount === 1 ? '' : 's'} proposed for review`
    : `Campaign created · ${output.itemCount} item${output.itemCount === 1 ? '' : 's'}`;

  return (
    <SummaryCard
      icon="📋"
      title={headline}
      subtitle={`${output.itemsByCategory.outliers} outlier(s) · ${output.itemsByCategory.dormantAccess} dormant · ${reviewerCount} reviewer(s)`}
      buttonLabel={output.dryRun ? 'Open builder' : 'Open campaign'}
      onViewDetails={onViewDetails}
    >
      <div className="text-xs" style={{ color: uiConfig.colors.gray600 }}>
        Scope: {output.scopeDescription}
      </div>
      {output.campaignId && (
        <div
          className="text-xs mt-1 font-mono"
          style={{ color: uiConfig.colors.gray700 }}
        >
          ID: {output.campaignId}
        </div>
      )}
    </SummaryCard>
  );
}

function SummaryCard({
  icon,
  title,
  subtitle,
  buttonLabel,
  onViewDetails,
  children,
}: {
  icon: string;
  title: string;
  subtitle: string;
  buttonLabel: string;
  onViewDetails: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg border bg-white p-4 space-y-3"
      style={{ borderColor: uiConfig.colors.gray200, maxHeight: '400px' }}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl" aria-hidden>
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <h4
            className="text-sm font-semibold"
            style={{ color: uiConfig.colors.gray900 }}
          >
            {title}
          </h4>
          <p className="text-xs mt-0.5" style={{ color: uiConfig.colors.gray600 }}>
            {subtitle}
          </p>
        </div>
      </div>

      {children && <div>{children}</div>}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onViewDetails}
          className="px-3 py-1.5 rounded text-xs font-semibold text-white"
          style={{ backgroundColor: uiConfig.colors.primary }}
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}
