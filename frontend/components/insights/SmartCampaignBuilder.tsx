/**
 * SmartCampaignBuilder Component
 *
 * Campaigns-tab body for InsightsHub. Owns the input form for the
 * `generate_smart_campaign` MCP tool, runs the call against
 * `/api/mcp/call`, and renders results as:
 *
 *   1. A summary card with item-count and a horizontal stacked bar of
 *      items broken down by inclusion rule (outliers, dormant, direct,
 *      recent grants).
 *   2. A "reviewer load" mini-section: top 5 reviewers by item count
 *      with relative-load bars.
 *   3. A paginated items table (25 rows / page) with a risk-score donut
 *      and a color-coded recommended-decision badge per row.
 *
 * The "Preview Campaign" button always invokes the tool with
 * `dryRun=true`. The "Create Campaign" button becomes enabled only
 * after a successful preview, and re-runs the same arguments with
 * `dryRun=false` to actually create the campaign in Okta.
 *
 * Internal state machine: 'idle' | 'running' | 'results' | 'error'.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { uiConfig } from '@/lib/ui-config';

type ScopeType = 'app' | 'group' | 'department' | 'all';
type ReviewerStrategy = 'manager' | 'app_owner' | 'resource_owner';
type RecommendedDecision = 'REVOKE' | 'APPROVE' | 'REVIEW';
type AccessType = 'app' | 'entitlement';

interface CampaignItem {
  itemKey: string;
  userId: string;
  userLogin: string;
  userDisplayName: string;
  accessType: AccessType;
  accessId: string;
  accessName: string;
  appId?: string;
  reviewer: string;
  reviewerName?: string;
  reasonForInclusion: string[];
  riskScore: number;
  recommendedDecision: RecommendedDecision;
}

interface ReviewerLoadEntry {
  reviewerId: string;
  reviewerName?: string;
  itemCount: number;
}

interface ItemsByCategory {
  outliers: number;
  dormantAccess: number;
  directAssignments: number;
  recentGrants: number;
}

export interface SmartCampaignPayload {
  campaignName: string;
  scopeDescription: string;
  itemCount: number;
  estimatedReviewerLoad: ReviewerLoadEntry[];
  itemsByCategory: ItemsByCategory;
  items: CampaignItem[];
  nextSteps: string[];
  dryRun: boolean;
  campaignId?: string;
  campaignStatus?: string;
  message?: string;
}

interface IncludeRules {
  outliers: boolean;
  dormantAccess: boolean;
  directAssignments: boolean;
  recentGrants: boolean;
}

interface FormValues {
  scopeType: ScopeType;
  scopeId: string;
  includeRules: IncludeRules;
  reviewerStrategy: ReviewerStrategy;
  campaignName: string;
}

const DEFAULT_FORM: FormValues = {
  scopeType: 'app',
  scopeId: '',
  // Per Prompt 12 spec: all rules default ON in the UI to encourage
  // comprehensive previews. (Backend defaults differ — they're
  // intentionally narrower for direct API callers.)
  includeRules: {
    outliers: true,
    dormantAccess: true,
    directAssignments: true,
    recentGrants: true,
  },
  reviewerStrategy: 'manager',
  campaignName: '',
};

const PAGE_SIZE = 25;

type RunState = 'idle' | 'running' | 'results' | 'error';

const CATEGORY_COLORS: Record<keyof ItemsByCategory, string> = {
  outliers: uiConfig.colors.error,
  dormantAccess: uiConfig.colors.warning,
  directAssignments: uiConfig.colors.info,
  recentGrants: uiConfig.colors.success,
};

const CATEGORY_LABELS: Record<keyof ItemsByCategory, string> = {
  outliers: 'Outliers',
  dormantAccess: 'Dormant',
  directAssignments: 'Direct',
  recentGrants: 'Recent grants',
};

export interface SmartCampaignBuilderProps {
  /**
   * If provided, the component skips the form and renders the results
   * panel pre-loaded with this payload. Used by the chat integration
   * (ToolResultSummary → "Open builder").
   */
  initialResult?: SmartCampaignPayload;
}

export default function SmartCampaignBuilder({
  initialResult,
}: SmartCampaignBuilderProps) {
  const [state, setState] = useState<RunState>(initialResult ? 'results' : 'idle');
  const [form, setForm] = useState<FormValues>(DEFAULT_FORM);
  const [result, setResult] = useState<SmartCampaignPayload | null>(
    initialResult ?? null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(
    initialResult?.dryRun === false ? initialResult.campaignId ?? null : null,
  );

  // If the parent swaps in a new initialResult (e.g. chat opens a
  // different campaign), reset display state.
  useEffect(() => {
    if (initialResult) {
      setResult(initialResult);
      setState('results');
      setPage(0);
      setErrorMessage(null);
      setCreatedId(
        initialResult.dryRun === false ? initialResult.campaignId ?? null : null,
      );
    }
  }, [initialResult]);

  const updateField = <K extends keyof FormValues>(
    key: K,
    value: FormValues[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const updateRule = (key: keyof IncludeRules, value: boolean) => {
    setForm((prev) => ({
      ...prev,
      includeRules: { ...prev.includeRules, [key]: value },
    }));
  };

  const resetToForm = () => {
    setState('idle');
    setResult(null);
    setErrorMessage(null);
    setPage(0);
    setCreatedId(null);
  };

  const buildArgs = (dryRun: boolean): Record<string, unknown> => {
    const args: Record<string, unknown> = {
      scopeType: form.scopeType,
      includeRules: form.includeRules,
      reviewerStrategy: form.reviewerStrategy,
      dryRun,
    };
    if (form.scopeType !== 'all') {
      args.scopeId = form.scopeId.trim();
    }
    if (form.campaignName.trim()) {
      args.campaignName = form.campaignName.trim();
    }
    return args;
  };

  const invokeTool = async (
    args: Record<string, unknown>,
  ): Promise<SmartCampaignPayload> => {
    const response = await fetch('/api/mcp/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolName: 'generate_smart_campaign',
        arguments: args,
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      const message =
        data?.message || data?.error || `Tool call failed (HTTP ${response.status})`;
      throw new Error(message);
    }

    const textContent: string = (data.result?.content || [])
      .filter((c: { type: string; text?: string }) => c.type === 'text' && c.text)
      .map((c: { text?: string }) => c.text)
      .join('\n');

    if (data.result?.isError) {
      throw new Error(textContent || 'Tool returned an error');
    }

    let parsed: SmartCampaignPayload;
    try {
      parsed = JSON.parse(textContent) as SmartCampaignPayload;
    } catch {
      throw new Error('Tool succeeded but response was not valid JSON');
    }
    return parsed;
  };

  const runPreview = async () => {
    if (form.scopeType !== 'all' && !form.scopeId.trim()) {
      setErrorMessage(`scopeId is required when scope is "${form.scopeType}"`);
      setState('error');
      return;
    }

    setState('running');
    setErrorMessage(null);
    setResult(null);
    setPage(0);
    setCreatedId(null);

    try {
      console.log('[SmartCampaignBuilder] Previewing campaign');
      const parsed = await invokeTool(buildArgs(true));
      setResult(parsed);
      setState('results');
    } catch (err) {
      console.error('[SmartCampaignBuilder] Preview failed', err);
      setErrorMessage(err instanceof Error ? err.message : 'Unknown error');
      setState('error');
    }
  };

  const runCreate = async () => {
    if (!result) return;
    if (result.itemCount === 0) {
      setErrorMessage('Cannot create a campaign with zero items.');
      return;
    }

    setCreating(true);
    setErrorMessage(null);
    try {
      console.log('[SmartCampaignBuilder] Creating campaign in Okta');
      const parsed = await invokeTool(buildArgs(false));
      setResult(parsed);
      setCreatedId(parsed.campaignId ?? null);
    } catch (err) {
      console.error('[SmartCampaignBuilder] Create failed', err);
      setErrorMessage(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {(state === 'idle' || state === 'results' || state === 'error') && (
        <CampaignForm
          form={form}
          onChange={updateField}
          onUpdateRule={updateRule}
          onPreview={runPreview}
          onReset={state === 'results' ? resetToForm : undefined}
          isResults={state === 'results'}
        />
      )}

      {state === 'running' && <RunningPanel />}

      {state === 'error' && errorMessage && (
        <ErrorBanner message={errorMessage} onRetry={runPreview} />
      )}

      {state === 'results' && result && (
        <ResultsPanel
          result={result}
          page={page}
          onPageChange={setPage}
          onCreate={runCreate}
          creating={creating}
          createdId={createdId}
          createError={state === 'results' ? errorMessage : null}
          canCreate={!result.dryRun ? false : result.itemCount > 0 && !createdId}
        />
      )}
    </div>
  );
}

interface CampaignFormProps {
  form: FormValues;
  onChange: <K extends keyof FormValues>(key: K, value: FormValues[K]) => void;
  onUpdateRule: (key: keyof IncludeRules, value: boolean) => void;
  onPreview: () => void;
  onReset?: () => void;
  isResults: boolean;
}

function CampaignForm({
  form,
  onChange,
  onUpdateRule,
  onPreview,
  onReset,
  isResults,
}: CampaignFormProps) {
  const scopeOptions: Array<{ id: ScopeType; label: string; helper: string }> = [
    { id: 'app', label: 'App', helper: 'Users assigned to a single app' },
    { id: 'group', label: 'Group', helper: 'Members of a single group' },
    { id: 'department', label: 'Department', helper: 'All users in a department' },
    { id: 'all', label: 'All', helper: 'Every active user (slow)' },
  ];

  const ruleOptions: Array<{ key: keyof IncludeRules; label: string; helper: string }> = [
    { key: 'outliers', label: 'Outliers', helper: 'Peer-coverage anomalies' },
    {
      key: 'dormantAccess',
      label: 'Dormant access (60+ days)',
      helper: 'Apps with no SSO events recently',
    },
    {
      key: 'directAssignments',
      label: 'Direct assignments',
      helper: 'Access not inherited from any group',
    },
    {
      key: 'recentGrants',
      label: 'Recent grants (last 30 days)',
      helper: 'Newly granted entitlements',
    },
  ];

  const reviewerOptions: Array<{ id: ReviewerStrategy; label: string; helper: string }> = [
    { id: 'manager', label: 'Manager', helper: 'Each user’s direct manager' },
    { id: 'app_owner', label: 'App owner', helper: 'The app’s configured owner' },
    {
      id: 'resource_owner',
      label: 'Resource owner',
      helper: 'Entitlement owner (falls back to app owner)',
    },
  ];

  return (
    <div
      className="rounded-lg border p-5"
      style={{
        borderColor: uiConfig.colors.gray200,
        backgroundColor: uiConfig.colors.gray50,
      }}
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold" style={{ color: uiConfig.colors.gray900 }}>
            Build a smart certification campaign
          </h3>
          <p className="text-sm mt-1" style={{ color: uiConfig.colors.gray600 }}>
            Targeted certification scoped to anomalies, dormancy, direct assignments, and
            recent grants — not a blanket review.
          </p>
        </div>
        {isResults && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="px-3 py-1 rounded text-sm"
            style={{
              backgroundColor: uiConfig.colors.gray200,
              color: uiConfig.colors.gray900,
            }}
          >
            Run again
          </button>
        )}
      </div>

      <fieldset className="mb-4">
        <legend
          className="text-xs font-semibold uppercase tracking-wide mb-2"
          style={{ color: uiConfig.colors.gray600 }}
        >
          Scope
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {scopeOptions.map((opt) => {
            const selected = form.scopeType === opt.id;
            return (
              <label
                key={opt.id}
                className="flex items-start gap-2 p-3 rounded border cursor-pointer transition-colors"
                style={{
                  borderColor: selected ? uiConfig.colors.primary : uiConfig.colors.gray200,
                  backgroundColor: selected ? '#eff6ff' : 'white',
                }}
              >
                <input
                  type="radio"
                  name="campaignScopeType"
                  value={opt.id}
                  checked={selected}
                  onChange={() => onChange('scopeType', opt.id)}
                  className="mt-1"
                />
                <div>
                  <div
                    className="text-sm font-medium"
                    style={{ color: uiConfig.colors.gray900 }}
                  >
                    {opt.label}
                  </div>
                  <div className="text-xs" style={{ color: uiConfig.colors.gray600 }}>
                    {opt.helper}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </fieldset>

      {form.scopeType !== 'all' && (
        <div className="mb-4">
          <label
            className="block text-xs font-semibold uppercase tracking-wide mb-1"
            style={{ color: uiConfig.colors.gray600 }}
          >
            {scopeIdLabel(form.scopeType)}
          </label>
          <input
            type="text"
            value={form.scopeId}
            onChange={(e) => onChange('scopeId', e.target.value)}
            placeholder={scopeIdPlaceholder(form.scopeType)}
            className="w-full px-3 py-2 border rounded text-sm font-mono"
            style={{ borderColor: uiConfig.colors.gray300 }}
          />
        </div>
      )}

      <fieldset className="mb-4">
        <legend
          className="text-xs font-semibold uppercase tracking-wide mb-2"
          style={{ color: uiConfig.colors.gray600 }}
        >
          Inclusion rules
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ruleOptions.map((rule) => (
            <ToggleRow
              key={rule.key}
              label={rule.label}
              helper={rule.helper}
              checked={form.includeRules[rule.key]}
              onChange={(v) => onUpdateRule(rule.key, v)}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="mb-4">
        <legend
          className="text-xs font-semibold uppercase tracking-wide mb-2"
          style={{ color: uiConfig.colors.gray600 }}
        >
          Reviewer strategy
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {reviewerOptions.map((opt) => {
            const selected = form.reviewerStrategy === opt.id;
            return (
              <label
                key={opt.id}
                className="flex items-start gap-2 p-3 rounded border cursor-pointer transition-colors"
                style={{
                  borderColor: selected ? uiConfig.colors.primary : uiConfig.colors.gray200,
                  backgroundColor: selected ? '#eff6ff' : 'white',
                }}
              >
                <input
                  type="radio"
                  name="campaignReviewerStrategy"
                  value={opt.id}
                  checked={selected}
                  onChange={() => onChange('reviewerStrategy', opt.id)}
                  className="mt-1"
                />
                <div>
                  <div
                    className="text-sm font-medium"
                    style={{ color: uiConfig.colors.gray900 }}
                  >
                    {opt.label}
                  </div>
                  <div className="text-xs" style={{ color: uiConfig.colors.gray600 }}>
                    {opt.helper}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mb-5">
        <label
          className="block text-xs font-semibold uppercase tracking-wide mb-1"
          style={{ color: uiConfig.colors.gray600 }}
        >
          Campaign name (optional)
        </label>
        <input
          type="text"
          value={form.campaignName}
          onChange={(e) => onChange('campaignName', e.target.value)}
          placeholder="Quarterly Risk Review"
          className="w-full px-3 py-2 border rounded text-sm"
          style={{ borderColor: uiConfig.colors.gray300 }}
        />
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onPreview}
          className="px-5 py-2 rounded-lg text-sm font-semibold text-white"
          style={{ backgroundColor: uiConfig.colors.primary }}
        >
          Preview Campaign
        </button>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  helper,
  checked,
  onChange,
}: {
  label: string;
  helper: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className="flex items-start gap-3 p-3 rounded border cursor-pointer"
      style={{
        borderColor: checked ? uiConfig.colors.primary : uiConfig.colors.gray200,
        backgroundColor: checked ? '#eff6ff' : 'white',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1"
      />
      <div>
        <div className="text-sm font-medium" style={{ color: uiConfig.colors.gray900 }}>
          {label}
        </div>
        <div className="text-xs" style={{ color: uiConfig.colors.gray600 }}>
          {helper}
        </div>
      </div>
    </label>
  );
}

function scopeIdLabel(scope: ScopeType): string {
  if (scope === 'app') return 'App ID';
  if (scope === 'group') return 'Group ID';
  if (scope === 'department') return 'Department name';
  return '';
}

function scopeIdPlaceholder(scope: ScopeType): string {
  if (scope === 'app') return '0oa1abcd2efGHijKLM3';
  if (scope === 'group') return '00g1abcd2efGHijKLM3';
  if (scope === 'department') return 'Engineering';
  return '';
}

function RunningPanel() {
  return (
    <div
      className="rounded-lg border p-8 flex flex-col items-center text-center"
      style={{ borderColor: uiConfig.colors.gray200, backgroundColor: 'white' }}
    >
      <div
        className="w-10 h-10 rounded-full border-4 animate-spin mb-4"
        style={{
          borderColor: uiConfig.colors.gray200,
          borderTopColor: uiConfig.colors.primary,
        }}
        aria-label="loading"
      />
      <p className="text-sm font-medium" style={{ color: uiConfig.colors.gray900 }}>
        Building access graph… running rules… assigning reviewers…
      </p>
      <p className="text-xs mt-2" style={{ color: uiConfig.colors.gray600 }}>
        Smart-campaign previews can take 30+ seconds — system-log queries for
        dormant access are the long pole.
      </p>
    </div>
  );
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      className="rounded-lg border p-4 flex items-start justify-between gap-4"
      style={{
        borderColor: '#fecaca',
        backgroundColor: '#fef2f2',
        color: uiConfig.colors.error,
      }}
    >
      <div>
        <p className="font-semibold text-sm">Campaign generation failed</p>
        <p className="text-sm mt-1">{message}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="px-3 py-1 rounded text-sm font-medium"
        style={{
          backgroundColor: 'white',
          color: uiConfig.colors.error,
          border: '1px solid #fecaca',
        }}
      >
        Try again
      </button>
    </div>
  );
}

interface ResultsPanelProps {
  result: SmartCampaignPayload;
  page: number;
  onPageChange: (page: number) => void;
  onCreate: () => void;
  creating: boolean;
  createdId: string | null;
  createError: string | null;
  canCreate: boolean;
}

function ResultsPanel({
  result,
  page,
  onPageChange,
  onCreate,
  creating,
  createdId,
  createError,
  canCreate,
}: ResultsPanelProps) {
  const totalPages = Math.max(1, Math.ceil(result.items.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const visibleItems = useMemo(
    () =>
      result.items.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [result.items, safePage],
  );

  return (
    <div className="space-y-4">
      <SummaryCard result={result} />

      <ReviewerLoadCard reviewers={result.estimatedReviewerLoad} />

      {result.itemCount === 0 ? (
        <div
          className="rounded-lg border p-6 text-center"
          style={{ borderColor: uiConfig.colors.gray200, backgroundColor: 'white' }}
        >
          <p className="text-sm font-medium" style={{ color: uiConfig.colors.gray900 }}>
            No items matched the selected rules in this scope.
          </p>
          <p className="text-xs mt-2" style={{ color: uiConfig.colors.gray600 }}>
            Try enabling more rules or broadening the scope, then preview again.
          </p>
        </div>
      ) : (
        <ItemsTable
          items={visibleItems}
          page={safePage}
          totalPages={totalPages}
          totalItems={result.items.length}
          onPageChange={onPageChange}
        />
      )}

      {result.nextSteps.length > 0 && (
        <div
          className="rounded-lg border p-4"
          style={{
            borderColor: uiConfig.colors.gray200,
            backgroundColor: uiConfig.colors.gray50,
          }}
        >
          <p
            className="text-xs font-semibold uppercase tracking-wide mb-2"
            style={{ color: uiConfig.colors.gray600 }}
          >
            Next steps
          </p>
          <ul className="text-sm list-disc pl-5 space-y-1" style={{ color: uiConfig.colors.gray700 }}>
            {result.nextSteps.map((step, idx) => (
              <li key={idx}>{step}</li>
            ))}
          </ul>
        </div>
      )}

      {createdId ? (
        <div
          className="rounded-lg border p-4 flex items-start justify-between gap-4"
          style={{
            borderColor: '#bbf7d0',
            backgroundColor: '#f0fdf4',
          }}
        >
          <div>
            <p
              className="font-semibold text-sm"
              style={{ color: uiConfig.colors.success }}
            >
              Campaign created in Okta
            </p>
            <p className="text-sm mt-1" style={{ color: uiConfig.colors.gray700 }}>
              ID: <span className="font-mono">{createdId}</span>
              {result.campaignStatus ? ` · ${result.campaignStatus}` : ''}
            </p>
            <p className="text-xs mt-2" style={{ color: uiConfig.colors.gray600 }}>
              Use Tool Explorer ▸ <code>manage_app_campaigns</code> with{' '}
              <code>action=&quot;list&quot;</code> to view it.
            </p>
          </div>
        </div>
      ) : (
        <div
          className="rounded-lg border p-4 flex items-center justify-between gap-4"
          style={{
            borderColor: uiConfig.colors.gray200,
            backgroundColor: 'white',
          }}
        >
          <div>
            <p className="text-sm font-medium" style={{ color: uiConfig.colors.gray900 }}>
              Ready to create this campaign in Okta?
            </p>
            <p className="text-xs mt-1" style={{ color: uiConfig.colors.gray600 }}>
              {result.dryRun
                ? canCreate
                  ? 'Re-runs the same arguments with dryRun=false.'
                  : 'Preview produced zero items — nothing to create.'
                : 'This preview was already created. Run a new preview to create another.'}
            </p>
            {createError && (
              <p className="text-xs mt-2" style={{ color: uiConfig.colors.error }}>
                {createError}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onCreate}
            disabled={!canCreate || creating}
            className="px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap"
            style={{
              backgroundColor:
                !canCreate || creating ? uiConfig.colors.gray200 : uiConfig.colors.success,
              color: !canCreate || creating ? uiConfig.colors.gray600 : 'white',
              cursor: !canCreate || creating ? 'not-allowed' : 'pointer',
            }}
          >
            {creating ? 'Creating…' : 'Create Campaign'}
          </button>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ result }: { result: SmartCampaignPayload }) {
  const total = Math.max(1, result.itemCount);
  const segments: Array<{ key: keyof ItemsByCategory; count: number }> = [
    { key: 'outliers', count: result.itemsByCategory.outliers },
    { key: 'dormantAccess', count: result.itemsByCategory.dormantAccess },
    { key: 'directAssignments', count: result.itemsByCategory.directAssignments },
    { key: 'recentGrants', count: result.itemsByCategory.recentGrants },
  ];

  return (
    <div
      className="rounded-lg p-4 space-y-3"
      style={{
        background: uiConfig.gradients.card,
        border: `1px solid ${uiConfig.colors.gray200}`,
      }}
    >
      <div className="flex flex-wrap gap-x-6 gap-y-1 items-baseline">
        <p className="text-sm" style={{ color: uiConfig.colors.gray900 }}>
          <strong>
            {result.itemCount} item{result.itemCount === 1 ? '' : 's'} proposed
          </strong>
          {' · '}
          {result.campaignName}
        </p>
        <p className="text-xs" style={{ color: uiConfig.colors.gray600 }}>
          Scope: {result.scopeDescription}
        </p>
      </div>

      {result.itemCount > 0 && (
        <>
          <div
            className="h-3 rounded overflow-hidden flex"
            style={{ backgroundColor: uiConfig.colors.gray100 }}
            aria-label="Items by category"
          >
            {segments.map((s) =>
              s.count === 0 ? null : (
                <div
                  key={s.key}
                  style={{
                    width: `${(s.count / total) * 100}%`,
                    backgroundColor: CATEGORY_COLORS[s.key],
                  }}
                  title={`${CATEGORY_LABELS[s.key]}: ${s.count}`}
                />
              ),
            )}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {segments.map((s) => (
              <span
                key={s.key}
                className="flex items-center gap-1"
                style={{ color: uiConfig.colors.gray700 }}
              >
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ backgroundColor: CATEGORY_COLORS[s.key] }}
                />
                {CATEGORY_LABELS[s.key]}: <strong>{s.count}</strong>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ReviewerLoadCard({ reviewers }: { reviewers: ReviewerLoadEntry[] }) {
  if (reviewers.length === 0) return null;

  const top = reviewers.slice(0, 5);
  const max = Math.max(...top.map((r) => r.itemCount), 1);

  return (
    <div
      className="rounded-lg border p-4"
      style={{
        borderColor: uiConfig.colors.gray200,
        backgroundColor: 'white',
      }}
    >
      <p
        className="text-xs font-semibold uppercase tracking-wide mb-3"
        style={{ color: uiConfig.colors.gray600 }}
      >
        Reviewer load — top {top.length}
      </p>
      <ul className="space-y-2">
        {top.map((r) => (
          <li key={r.reviewerId} className="text-sm">
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span style={{ color: uiConfig.colors.gray900 }}>
                {r.reviewerName || r.reviewerId}
              </span>
              <span
                className="text-xs font-mono"
                style={{ color: uiConfig.colors.gray600 }}
              >
                {r.itemCount} item{r.itemCount === 1 ? '' : 's'}
              </span>
            </div>
            <div
              className="h-2 rounded overflow-hidden"
              style={{ backgroundColor: uiConfig.colors.gray100 }}
            >
              <div
                className="h-full"
                style={{
                  width: `${(r.itemCount / max) * 100}%`,
                  backgroundColor: uiConfig.colors.primary,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface ItemsTableProps {
  items: CampaignItem[];
  page: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (p: number) => void;
}

function ItemsTable({
  items,
  page,
  totalPages,
  totalItems,
  onPageChange,
}: ItemsTableProps) {
  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{
        borderColor: uiConfig.colors.gray200,
        backgroundColor: 'white',
      }}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead style={{ backgroundColor: uiConfig.colors.gray50 }}>
            <tr>
              <Th>User</Th>
              <Th>Access</Th>
              <Th>Reviewer</Th>
              <Th>Reasons</Th>
              <Th>Risk</Th>
              <Th>Recommendation</Th>
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: uiConfig.colors.gray200 }}>
            {items.map((item) => (
              <ItemRow key={item.itemKey} item={item} />
            ))}
          </tbody>
        </table>
      </div>

      <div
        className="flex items-center justify-between px-4 py-2 border-t text-xs"
        style={{
          borderColor: uiConfig.colors.gray200,
          color: uiConfig.colors.gray600,
        }}
      >
        <span>
          Showing {page * PAGE_SIZE + 1}–
          {Math.min((page + 1) * PAGE_SIZE, totalItems)} of {totalItems}
        </span>
        <div className="flex gap-2">
          <PagerButton
            disabled={page === 0}
            onClick={() => onPageChange(Math.max(0, page - 1))}
          >
            ‹ Prev
          </PagerButton>
          <span className="px-2 py-1">
            Page {page + 1} of {totalPages}
          </span>
          <PagerButton
            disabled={page >= totalPages - 1}
            onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
          >
            Next ›
          </PagerButton>
        </div>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wide"
      style={{ color: uiConfig.colors.gray600 }}
    >
      {children}
    </th>
  );
}

function PagerButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="px-2 py-1 rounded border"
      style={{
        borderColor: uiConfig.colors.gray200,
        backgroundColor: disabled ? uiConfig.colors.gray100 : 'white',
        color: disabled ? uiConfig.colors.gray600 : uiConfig.colors.gray900,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function ItemRow({ item }: { item: CampaignItem }) {
  return (
    <tr>
      <td className="px-3 py-2 align-top">
        <div
          className="font-medium font-mono text-xs"
          style={{ color: uiConfig.colors.gray900 }}
        >
          {item.userLogin}
        </div>
        <div className="text-xs" style={{ color: uiConfig.colors.gray600 }}>
          {item.userDisplayName}
        </div>
      </td>
      <td className="px-3 py-2 align-top">
        <div style={{ color: uiConfig.colors.gray900 }}>{item.accessName}</div>
        <div className="text-xs" style={{ color: uiConfig.colors.gray600 }}>
          {item.accessType}
          {item.appId && item.accessType === 'entitlement' ? ` · ${item.appId}` : ''}
        </div>
      </td>
      <td className="px-3 py-2 align-top">
        <div style={{ color: uiConfig.colors.gray900 }}>
          {item.reviewerName || (
            <span className="font-mono text-xs">{item.reviewer}</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 align-top">
        <div className="flex flex-wrap gap-1">
          {item.reasonForInclusion.map((reason) => (
            <ReasonBadge key={reason} reason={reason} />
          ))}
        </div>
      </td>
      <td className="px-3 py-2 align-top">
        <RiskDonut score={item.riskScore} />
      </td>
      <td className="px-3 py-2 align-top">
        <DecisionBadge decision={item.recommendedDecision} />
      </td>
    </tr>
  );
}

function ReasonBadge({ reason }: { reason: string }) {
  // Map to category color when we recognize the reason; fall back to gray.
  let color: string = uiConfig.colors.gray700;
  if (reason === 'outlier') color = CATEGORY_COLORS.outliers;
  else if (reason.startsWith('dormant_')) color = CATEGORY_COLORS.dormantAccess;
  else if (reason === 'direct_assignment') color = CATEGORY_COLORS.directAssignments;
  else if (reason.startsWith('recent_grant')) color = CATEGORY_COLORS.recentGrants;

  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-xs font-medium"
      style={{
        backgroundColor: color + '20',
        color,
      }}
    >
      {reason.replace(/_/g, ' ')}
    </span>
  );
}

function DecisionBadge({ decision }: { decision: RecommendedDecision }) {
  const color =
    decision === 'REVOKE'
      ? uiConfig.colors.error
      : decision === 'REVIEW'
        ? uiConfig.colors.warning
        : uiConfig.colors.success;
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-xs font-bold"
      style={{
        backgroundColor: color + '20',
        color,
      }}
    >
      {decision}
    </span>
  );
}

/**
 * Tiny SVG donut showing the riskScore (0..1) as a colored arc.
 */
function RiskDonut({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(1, score));
  const pct = Math.round(clamped * 100);
  const r = 11;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - clamped);

  const color =
    clamped >= 0.7
      ? uiConfig.colors.error
      : clamped >= 0.4
        ? uiConfig.colors.warning
        : uiConfig.colors.success;

  return (
    <div className="flex items-center gap-2">
      <svg width="28" height="28" viewBox="0 0 28 28" aria-label={`Risk ${pct}%`}>
        <circle
          cx="14"
          cy="14"
          r={r}
          fill="none"
          stroke={uiConfig.colors.gray200}
          strokeWidth="3"
        />
        <circle
          cx="14"
          cy="14"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform="rotate(-90 14 14)"
          strokeLinecap="round"
        />
      </svg>
      <span className="text-xs font-mono" style={{ color: uiConfig.colors.gray700 }}>
        {pct}%
      </span>
    </div>
  );
}
