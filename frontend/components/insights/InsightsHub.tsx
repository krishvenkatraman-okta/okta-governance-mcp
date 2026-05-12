/**
 * InsightsHub Component
 *
 * Full-screen modal that hosts the four advanced governance analytics tabs:
 *   - Discover (Role Mining)
 *   - Risks (Outlier Detection)
 *   - Explain (Access Path Tracing)
 *   - Campaigns (Smart Certification Campaigns)
 *
 * The hub also supports two cross-tab navigation flows:
 *
 *   1. Risks → Explain deep-link: clicking an outlier cell switches to
 *      the Explain tab pre-filled with `(userId, targetType, targetId)`.
 *
 *   2. Chat → any tab pre-loaded with a tool result. When the chat
 *      summary card's "View details" button is clicked, the agent page
 *      passes the parsed tool output via `initialResult` and the
 *      target tab via `initialTab`. The matching tab component skips
 *      its own form and renders the results state directly.
 */

'use client';

import { useState } from 'react';
import { uiConfig } from '@/lib/ui-config';
import RoleMiningResults, {
  type MiningResultPayload,
} from './RoleMiningResults';
import OutlierReport, { type OutlierResultPayload } from './OutlierReport';
import AccessExplainer, {
  type ExplanationResultPayload,
} from './AccessExplainer';
import SmartCampaignBuilder, {
  type SmartCampaignPayload,
} from './SmartCampaignBuilder';

export type InsightsTab = 'discover' | 'risks' | 'explain' | 'campaigns';

/**
 * Discriminated union for chat-driven pre-loads. The tab decides how to
 * narrow `output` — each variant pairs a tab id with the matching
 * payload type that tab's results panel expects.
 */
export type InsightsInitialResult =
  | { tab: 'discover'; output: MiningResultPayload }
  | { tab: 'risks'; output: OutlierResultPayload }
  | { tab: 'explain'; output: ExplanationResultPayload }
  | { tab: 'campaigns'; output: SmartCampaignPayload };

export interface InsightsHubProps {
  onClose: () => void;
  /**
   * Tab to open initially. Falls back to "discover".
   */
  initialTab?: InsightsTab;
  /**
   * If provided, the matching tab renders pre-loaded with this output
   * and skips its form. Used by the chat → details flow.
   */
  initialResult?: InsightsInitialResult;
}

type ExplainTargetType = 'group' | 'app' | 'entitlement';

interface PendingExplain {
  userId: string;
  targetType: ExplainTargetType;
  targetId: string;
}

interface TabConfig {
  id: InsightsTab;
  icon: string;
  label: string;
}

const TABS: TabConfig[] = [
  { id: 'discover', icon: '🪙', label: 'Discover' },
  { id: 'risks', icon: '🛡️', label: 'Risks' },
  { id: 'explain', icon: '💡', label: 'Explain' },
  { id: 'campaigns', icon: '📋', label: 'Campaigns' },
];

export default function InsightsHub({
  onClose,
  initialTab,
  initialResult,
}: InsightsHubProps) {
  // The parent remounts InsightsHub (via a `key` prop) whenever the
  // chat opens a new pre-loaded result, so initial state captures the
  // right tab. We don't need a useEffect to react to prop changes.
  const [activeTab, setActiveTab] = useState<InsightsTab>(
    initialResult?.tab ?? initialTab ?? 'discover',
  );
  const [pendingExplain, setPendingExplain] = useState<PendingExplain | null>(null);

  const handleExplainAccess = (
    userId: string,
    targetType: ExplainTargetType,
    targetId: string,
  ) => {
    setPendingExplain({ userId, targetType, targetId });
    setActiveTab('explain');
  };

  // Per-tab pre-load payload. Only fires when the active tab matches
  // the pre-load's tab — switching tabs reverts to the form / fresh
  // state. This mirrors the contract of each tab component's
  // `initialResult` prop.
  const tabResultFor = <T extends InsightsTab>(tab: T) =>
    initialResult && initialResult.tab === tab && activeTab === tab
      ? (initialResult.output as Extract<InsightsInitialResult, { tab: T }>['output'])
      : undefined;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div
          className="p-6 border-b flex items-start justify-between"
          style={{ borderColor: uiConfig.colors.gray200 }}
        >
          <div>
            <h2 className="text-2xl font-bold" style={{ color: uiConfig.colors.gray900 }}>
              Governance Insights
            </h2>
            <p className="text-sm mt-2" style={{ color: uiConfig.colors.gray600 }}>
              Advanced analytics on top of your Okta access graph — role mining, outlier
              detection, access explainability, and smart campaigns.
            </p>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded text-sm"
            style={{
              backgroundColor: uiConfig.colors.gray200,
              color: uiConfig.colors.gray900,
            }}
          >
            Close
          </button>
        </div>

        {/* Tabs */}
        <div
          className="border-b flex overflow-x-auto"
          style={{ borderColor: uiConfig.colors.gray200 }}
        >
          {TABS.map((tab) => {
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors"
                style={{
                  borderColor: isSelected ? uiConfig.colors.primary : 'transparent',
                  color: isSelected ? uiConfig.colors.primary : uiConfig.colors.gray600,
                  backgroundColor: isSelected ? '#eff6ff' : 'transparent',
                }}
              >
                <span className="mr-2">{tab.icon}</span>
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab body */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'discover' && (
            <RoleMiningResults initialResult={tabResultFor('discover')} />
          )}
          {activeTab === 'risks' && (
            <OutlierReport
              onExplainAccess={handleExplainAccess}
              initialResult={tabResultFor('risks')}
            />
          )}
          {activeTab === 'explain' && (
            <AccessExplainer
              initialUserId={pendingExplain?.userId}
              initialTargetType={pendingExplain?.targetType}
              initialTargetId={pendingExplain?.targetId}
              initialResult={tabResultFor('explain')}
            />
          )}
          {activeTab === 'campaigns' && (
            <SmartCampaignBuilder initialResult={tabResultFor('campaigns')} />
          )}
        </div>
      </div>
    </div>
  );
}
