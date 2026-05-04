/**
 * InsightsHub Component
 *
 * Full-screen modal that hosts the four advanced governance analytics tabs:
 *   - Discover (Role Mining)
 *   - Risks (Outlier Detection)
 *   - Explain (Access Path Tracing)
 *   - Campaigns (Smart Certification Campaigns)
 *
 * This shell wires up the tab navigation and per-tab placeholders. Subsequent
 * prompts replace each placeholder with a real results component that calls
 * its corresponding MCP tool.
 */

'use client';

import { useState } from 'react';
import { uiConfig } from '@/lib/ui-config';
import RoleMiningResults from './RoleMiningResults';
import OutlierReport from './OutlierReport';

interface InsightsHubProps {
  onClose: () => void;
}

type InsightsTab = 'discover' | 'risks' | 'explain' | 'campaigns';

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
  title: string;
  description: string;
  toolName: string;
}

const TABS: TabConfig[] = [
  {
    id: 'discover',
    icon: '🪙',
    label: 'Discover',
    title: 'Discover candidate roles',
    description:
      'Cluster users with similar access patterns to surface proposed roles. Run mining on an app, group, department, or the whole org.',
    toolName: 'mine_candidate_roles',
  },
  {
    id: 'risks',
    icon: '🛡️',
    label: 'Risks',
    title: 'Find entitlement outliers',
    description:
      'Flag users whose access deviates from their peer group, with per-entitlement coverage and recommended actions.',
    toolName: 'detect_entitlement_outliers',
  },
  {
    id: 'explain',
    icon: '💡',
    label: 'Explain',
    title: 'Explain access paths',
    description:
      'Trace exactly how a user came to have access to an app, group, or entitlement — with grant dates, granters, and rule expressions.',
    toolName: 'explain_user_access',
  },
  {
    id: 'campaigns',
    icon: '📋',
    label: 'Campaigns',
    title: 'Build smart certification campaigns',
    description:
      'Generate a targeted certification preview scoped to outliers, dormant access, direct assignments, and recent grants.',
    toolName: 'generate_smart_campaign',
  },
];

export default function InsightsHub({ onClose }: InsightsHubProps) {
  const [activeTab, setActiveTab] = useState<InsightsTab>('discover');
  const [pendingExplain, setPendingExplain] = useState<PendingExplain | null>(null);

  const activeConfig = TABS.find((t) => t.id === activeTab) ?? TABS[0];

  const handleExplainAccess = (
    userId: string,
    targetType: ExplainTargetType,
    targetId: string,
  ) => {
    setPendingExplain({ userId, targetType, targetId });
    setActiveTab('explain');
  };

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
          {activeTab === 'discover' && <RoleMiningResults />}
          {activeTab === 'risks' && (
            <OutlierReport onExplainAccess={handleExplainAccess} />
          )}
          {activeTab === 'explain' && (
            <ExplainPlaceholder pending={pendingExplain} config={activeConfig} />
          )}
          {activeTab === 'campaigns' && <TabPlaceholder config={activeConfig} />}
        </div>
      </div>
    </div>
  );
}

function ExplainPlaceholder({
  pending,
  config,
}: {
  pending: PendingExplain | null;
  config: TabConfig;
}) {
  if (!pending) {
    return <TabPlaceholder config={config} />;
  }
  return (
    <div className="flex items-center justify-center h-full min-h-[420px] p-12">
      <div
        className="rounded-lg border p-6 max-w-xl w-full"
        style={{
          borderColor: uiConfig.colors.gray200,
          backgroundColor: 'white',
        }}
      >
        <div className="text-4xl mb-3" aria-hidden>
          {config.icon}
        </div>
        <h3
          className="text-lg font-semibold mb-2"
          style={{ color: uiConfig.colors.gray900 }}
        >
          Explain access — pending
        </h3>
        <p className="text-sm mb-4" style={{ color: uiConfig.colors.gray600 }}>
          The Explain tab will be wired up in the next prompt. The Risks tab passed
          the following deep-link values; once the tab is implemented it will
          auto-run with these.
        </p>
        <dl
          className="text-sm grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono"
          style={{ color: uiConfig.colors.gray700 }}
        >
          <dt style={{ color: uiConfig.colors.gray600 }}>userId</dt>
          <dd>{pending.userId}</dd>
          <dt style={{ color: uiConfig.colors.gray600 }}>targetType</dt>
          <dd>{pending.targetType}</dd>
          <dt style={{ color: uiConfig.colors.gray600 }}>targetId</dt>
          <dd>{pending.targetId}</dd>
        </dl>
      </div>
    </div>
  );
}

function TabPlaceholder({ config }: { config: TabConfig }) {
  return (
    <div className="flex items-center justify-center h-full min-h-[420px] p-12">
      <div className="text-center max-w-lg">
        <div className="text-6xl mb-4" aria-hidden>
          {config.icon}
        </div>
        <h3
          className="text-xl font-semibold mb-3"
          style={{ color: uiConfig.colors.gray900 }}
        >
          {config.title}
        </h3>
        <p className="text-sm mb-2" style={{ color: uiConfig.colors.gray600 }}>
          {config.description}
        </p>
        <p
          className="text-xs font-mono mb-6"
          style={{ color: uiConfig.colors.gray600 }}
        >
          Tool: {config.toolName}
        </p>
        <button
          type="button"
          disabled
          className="px-5 py-2 rounded-lg text-sm font-medium cursor-not-allowed"
          style={{
            backgroundColor: uiConfig.colors.gray200,
            color: uiConfig.colors.gray600,
          }}
          title="Coming soon — wired up in the next prompt"
        >
          Run analysis
        </button>
      </div>
    </div>
  );
}
