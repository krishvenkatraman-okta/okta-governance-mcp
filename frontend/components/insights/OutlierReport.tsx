/**
 * OutlierReport Component
 *
 * Risks-tab body for InsightsHub. Owns the input form for the
 * `detect_entitlement_outliers` MCP tool, runs the call against
 * `/api/mcp/call`, and renders results as a heat-table where each row is
 * an outlier user and each column is a distinct outlier entitlement.
 *
 * Cell intensity is driven by `(1 - peerCoverage)` — the rarer the access
 * is among a user's peers, the hotter the cell.
 *
 * Internal state machine: 'idle' | 'running' | 'results' | 'error'.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { uiConfig } from '@/lib/ui-config';

type ScopeType = 'app' | 'group' | 'department' | 'all';
type AccessNodeType = 'group' | 'app' | 'entitlement';
type PeerGroupingStrategy = 'department_title' | 'department' | 'manager';
type OutlierRecommendation = 'Investigate' | 'Review' | 'Likely revoke';

interface OutlierEntitlement {
  type: AccessNodeType;
  id: string;
  name: string;
  peerCoverage: number;
  peersWithAccess: number;
  recommendation: OutlierRecommendation;
  weight: number;
}

interface OutlierUser {
  userId: string;
  login: string;
  displayName: string;
  department?: string;
  title?: string;
  peerGroupKey: string;
  peerGroupSize: number;
  outlierScore: number;
  outlierEntitlements: OutlierEntitlement[];
  overallRecommendation: OutlierRecommendation;
}

export interface OutlierResultPayload {
  scopeDescription: string;
  totalUsersAnalyzed: number;
  analysisParameters: {
    peerGroupingStrategy: PeerGroupingStrategy;
    outlierThreshold: number;
    minPeerGroupSize: number;
    maxResults: number;
  };
  outliers: OutlierUser[];
  summary: {
    totalOutliers: number;
    totalOutlierEntitlements: number;
    peerGroupsRepresented: number;
    mostCommonOutlierApp?: string;
  };
}

type RunState = 'idle' | 'running' | 'results' | 'error';

interface FormValues {
  scopeType: ScopeType;
  scopeId: string;
  peerGroupingStrategy: PeerGroupingStrategy;
  outlierThreshold: number;
  minPeerGroupSize: number;
  maxResults: number;
}

const DEFAULT_FORM: FormValues = {
  scopeType: 'app',
  scopeId: '',
  peerGroupingStrategy: 'department_title',
  outlierThreshold: 0.10,
  minPeerGroupSize: 5,
  maxResults: 25,
};

const MAX_VISIBLE_COLUMNS = 8;

export interface OutlierReportProps {
  /**
   * Called when an outlier cell is clicked. The parent (InsightsHub)
   * uses this to switch to the Explain tab pre-filled with these values.
   */
  onExplainAccess?: (
    userId: string,
    targetType: AccessNodeType,
    targetId: string,
  ) => void;
  /**
   * If provided, the component skips the form and renders the results
   * panel pre-loaded with this payload. Used by the chat integration.
   */
  initialResult?: OutlierResultPayload;
}

export default function OutlierReport({
  onExplainAccess,
  initialResult,
}: OutlierReportProps) {
  const [state, setState] = useState<RunState>(initialResult ? 'results' : 'idle');
  const [form, setForm] = useState<FormValues>(DEFAULT_FORM);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [result, setResult] = useState<OutlierResultPayload | null>(
    initialResult ?? null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (initialResult) {
      setResult(initialResult);
      setState('results');
      setErrorMessage(null);
    }
  }, [initialResult]);

  const updateField = <K extends keyof FormValues>(
    key: K,
    value: FormValues[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const resetToForm = () => {
    setState('idle');
    setResult(null);
    setErrorMessage(null);
  };

  const runDetection = async () => {
    if (form.scopeType !== 'all' && !form.scopeId.trim()) {
      setErrorMessage(`scopeId is required when scope is "${form.scopeType}"`);
      setState('error');
      return;
    }

    setState('running');
    setErrorMessage(null);
    setResult(null);

    const args: Record<string, unknown> = {
      scopeType: form.scopeType,
      peerGroupingStrategy: form.peerGroupingStrategy,
      outlierThreshold: form.outlierThreshold,
      minPeerGroupSize: form.minPeerGroupSize,
      maxResults: form.maxResults,
    };
    if (form.scopeType !== 'all') {
      args.scopeId = form.scopeId.trim();
    }

    try {
      console.log('[OutlierReport] Invoking detect_entitlement_outliers', args);
      const response = await fetch('/api/mcp/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName: 'detect_entitlement_outliers',
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

      let parsed: OutlierResultPayload;
      try {
        parsed = JSON.parse(textContent) as OutlierResultPayload;
      } catch {
        throw new Error('Tool succeeded but response was not valid JSON');
      }

      setResult(parsed);
      setState('results');
    } catch (err) {
      console.error('[OutlierReport] Detection failed', err);
      setErrorMessage(err instanceof Error ? err.message : 'Unknown error');
      setState('error');
    }
  };

  return (
    <div className="p-6 space-y-6">
      {(state === 'idle' || state === 'results' || state === 'error') && (
        <DetectionForm
          form={form}
          showAdvanced={showAdvanced}
          onToggleAdvanced={() => setShowAdvanced((v) => !v)}
          onChange={updateField}
          onSubmit={runDetection}
          onReset={state === 'results' ? resetToForm : undefined}
          isResults={state === 'results'}
        />
      )}

      {state === 'running' && <RunningPanel />}

      {state === 'error' && errorMessage && (
        <ErrorBanner message={errorMessage} onRetry={runDetection} />
      )}

      {state === 'results' && result && (
        <ResultsPanel result={result} onExplainAccess={onExplainAccess} />
      )}
    </div>
  );
}

interface DetectionFormProps {
  form: FormValues;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
  onChange: <K extends keyof FormValues>(key: K, value: FormValues[K]) => void;
  onSubmit: () => void;
  onReset?: () => void;
  isResults: boolean;
}

function DetectionForm({
  form,
  showAdvanced,
  onToggleAdvanced,
  onChange,
  onSubmit,
  onReset,
  isResults,
}: DetectionFormProps) {
  const scopeOptions: Array<{ id: ScopeType; label: string; helper: string }> = [
    { id: 'app', label: 'App', helper: 'Users assigned to a single app' },
    { id: 'group', label: 'Group', helper: 'Members of a single group' },
    { id: 'department', label: 'Department', helper: 'All users in a department' },
    { id: 'all', label: 'All', helper: 'Every active user (slow)' },
  ];

  const strategyOptions: Array<{ id: PeerGroupingStrategy; label: string; helper: string }> = [
    {
      id: 'department_title',
      label: 'Department + Title',
      helper: 'Default — narrowest peer cohort',
    },
    {
      id: 'manager',
      label: 'Same Manager',
      helper: 'Useful for small org units',
    },
    {
      id: 'department',
      label: 'Department only',
      helper: 'Looser — broader peer set',
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
            Detect entitlement outliers
          </h3>
          <p className="text-sm mt-1" style={{ color: uiConfig.colors.gray600 }}>
            Find users whose access deviates from their peer group. Cells are color-coded
            by how rare the access is among peers.
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
                  name="outlierScopeType"
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
          {form.scopeType === 'app' && (
            <p
              className="text-xs mt-1"
              style={{ color: uiConfig.colors.gray600 }}
            >
              Hint: use the App ID from Tool Explorer&apos;s <code>list_manageable_apps</code>.
            </p>
          )}
        </div>
      )}

      <div className="mb-4">
        <label
          className="block text-xs font-semibold uppercase tracking-wide mb-1"
          style={{ color: uiConfig.colors.gray600 }}
        >
          Peer grouping strategy
        </label>
        <select
          value={form.peerGroupingStrategy}
          onChange={(e) =>
            onChange('peerGroupingStrategy', e.target.value as PeerGroupingStrategy)
          }
          className="w-full px-3 py-2 border rounded text-sm bg-white"
          style={{ borderColor: uiConfig.colors.gray300 }}
        >
          {strategyOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label} — {opt.helper}
            </option>
          ))}
        </select>
      </div>

      <div>
        <button
          type="button"
          onClick={onToggleAdvanced}
          className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1"
          style={{ color: uiConfig.colors.primary }}
        >
          {showAdvanced ? '▾' : '▸'} Advanced settings
        </button>
        {showAdvanced && (
          <div
            className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded border bg-white"
            style={{ borderColor: uiConfig.colors.gray200 }}
          >
            <SliderField
              label="Outlier threshold"
              value={form.outlierThreshold}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => onChange('outlierThreshold', v)}
            />
            <NumberField
              label="Min peer group size"
              value={form.minPeerGroupSize}
              min={2}
              step={1}
              onChange={(v) => onChange('minPeerGroupSize', v)}
            />
            <NumberField
              label="Max results"
              value={form.maxResults}
              min={1}
              step={1}
              onChange={(v) => onChange('maxResults', v)}
            />
          </div>
        )}
      </div>

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={onSubmit}
          className="px-5 py-2 rounded-lg text-sm font-semibold text-white"
          style={{ backgroundColor: uiConfig.colors.primary }}
        >
          Run Detection
        </button>
      </div>
    </div>
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

function NumberField({
  label,
  value,
  min,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span
        className="block text-xs font-semibold uppercase tracking-wide mb-1"
        style={{ color: uiConfig.colors.gray600 }}
      >
        {label}
      </span>
      <input
        type="number"
        value={value}
        min={min}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) onChange(n);
        }}
        className="w-full px-3 py-2 border rounded text-sm"
        style={{ borderColor: uiConfig.colors.gray300 }}
      />
    </label>
  );
}

function SliderField({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.05,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-1">
        <span
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: uiConfig.colors.gray600 }}
        >
          {label}
        </span>
        <span className="text-xs font-mono" style={{ color: uiConfig.colors.gray700 }}>
          {value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </label>
  );
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
        Building access graph… bucketing peers… scoring outliers…
      </p>
      <p className="text-xs mt-2" style={{ color: uiConfig.colors.gray600 }}>
        Detection can take 30+ seconds for larger scopes — Okta API pagination is the
        long pole.
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
        <p className="font-semibold text-sm">Detection failed</p>
        <p className="text-sm mt-1">{message}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="px-3 py-1 rounded text-sm font-medium"
        style={{ backgroundColor: 'white', color: uiConfig.colors.error, border: '1px solid #fecaca' }}
      >
        Try again
      </button>
    </div>
  );
}

interface ResultsPanelProps {
  result: OutlierResultPayload;
  onExplainAccess?: (
    userId: string,
    targetType: AccessNodeType,
    targetId: string,
  ) => void;
}

interface HeatColumn {
  /** `${type}:${id}` composite key — used by the synthetic "Others" column too. */
  key: string;
  type: AccessNodeType;
  id: string;
  name: string;
  /** Number of rows that have at least one entitlement under this column. */
  rowFrequency: number;
}

function ResultsPanel({ result, onExplainAccess }: ResultsPanelProps) {
  const { outliers, summary, scopeDescription, totalUsersAnalyzed, analysisParameters } = result;

  const { visibleColumns, hiddenColumns } = useMemo(
    () => buildHeatColumns(outliers),
    [outliers],
  );

  if (outliers.length === 0) {
    return (
      <div
        className="rounded-lg border p-6 text-center"
        style={{ borderColor: uiConfig.colors.gray200, backgroundColor: 'white' }}
      >
        <p className="text-sm font-medium" style={{ color: uiConfig.colors.gray900 }}>
          No outlier users found in this scope.
        </p>
        <p className="text-xs mt-2" style={{ color: uiConfig.colors.gray600 }}>
          Scope: {scopeDescription} · {totalUsersAnalyzed} user(s) analyzed.
          Try raising the outlier threshold or lowering the min peer group size and run again.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        className="rounded-lg p-4 flex flex-wrap gap-x-6 gap-y-1 items-baseline"
        style={{
          background: uiConfig.gradients.card,
          border: `1px solid ${uiConfig.colors.gray200}`,
        }}
      >
        <p className="text-sm" style={{ color: uiConfig.colors.gray900 }}>
          <strong>
            {summary.totalOutliers} user{summary.totalOutliers === 1 ? '' : 's'} with outlier access
          </strong>
          {' · '}
          {summary.totalOutlierEntitlements} flagged entitlement
          {summary.totalOutlierEntitlements === 1 ? '' : 's'}
          {summary.mostCommonOutlierApp && (
            <>
              {' · '}most-flagged app: <strong>{summary.mostCommonOutlierApp}</strong>
            </>
          )}
        </p>
        <p className="text-xs" style={{ color: uiConfig.colors.gray600 }}>
          Scope: {scopeDescription} · {totalUsersAnalyzed} user(s) analyzed
          {' · '}
          peer strategy: {analysisParameters.peerGroupingStrategy}
          {' · '}
          threshold: {analysisParameters.outlierThreshold}
        </p>
      </div>

      <HeatTable
        outliers={outliers}
        visibleColumns={visibleColumns}
        hiddenColumns={hiddenColumns}
        onExplainAccess={onExplainAccess}
      />

      <Legend />
    </div>
  );
}

function buildHeatColumns(outliers: OutlierUser[]): {
  visibleColumns: HeatColumn[];
  hiddenColumns: HeatColumn[];
} {
  const byKey = new Map<string, HeatColumn>();
  for (const user of outliers) {
    const seenInRow = new Set<string>();
    for (const ent of user.outlierEntitlements) {
      const key = `${ent.type}:${ent.id}`;
      let col = byKey.get(key);
      if (!col) {
        col = {
          key,
          type: ent.type,
          id: ent.id,
          name: ent.name,
          rowFrequency: 0,
        };
        byKey.set(key, col);
      }
      if (!seenInRow.has(key)) {
        col.rowFrequency += 1;
        seenInRow.add(key);
      }
    }
  }

  const all = Array.from(byKey.values()).sort((a, b) => {
    if (b.rowFrequency !== a.rowFrequency) return b.rowFrequency - a.rowFrequency;
    return a.name.localeCompare(b.name);
  });

  if (all.length <= MAX_VISIBLE_COLUMNS) {
    return { visibleColumns: all, hiddenColumns: [] };
  }

  return {
    visibleColumns: all.slice(0, MAX_VISIBLE_COLUMNS - 1),
    hiddenColumns: all.slice(MAX_VISIBLE_COLUMNS - 1),
  };
}

interface HeatTableProps {
  outliers: OutlierUser[];
  visibleColumns: HeatColumn[];
  hiddenColumns: HeatColumn[];
  onExplainAccess?: (
    userId: string,
    targetType: AccessNodeType,
    targetId: string,
  ) => void;
}

function HeatTable({
  outliers,
  visibleColumns,
  hiddenColumns,
  onExplainAccess,
}: HeatTableProps) {
  const hasOthersColumn = hiddenColumns.length > 0;

  return (
    <div
      className="rounded-lg border bg-white shadow-sm overflow-x-auto"
      style={{ borderColor: uiConfig.colors.gray200 }}
    >
      <table className="min-w-full border-collapse">
        <thead>
          <tr style={{ backgroundColor: uiConfig.colors.gray50 }}>
            <th
              scope="col"
              className="sticky left-0 z-10 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
              style={{
                color: uiConfig.colors.gray700,
                backgroundColor: uiConfig.colors.gray50,
                borderBottom: `1px solid ${uiConfig.colors.gray200}`,
                borderRight: `1px solid ${uiConfig.colors.gray200}`,
                minWidth: 240,
              }}
            >
              User
            </th>
            {visibleColumns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className="px-3 py-3 text-left text-xs font-semibold"
                style={{
                  color: uiConfig.colors.gray700,
                  borderBottom: `1px solid ${uiConfig.colors.gray200}`,
                  minWidth: 140,
                  maxWidth: 180,
                }}
                title={`${col.type}: ${col.name}`}
              >
                <div className="flex items-center gap-1">
                  <span
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded uppercase"
                    style={{
                      backgroundColor: uiConfig.colors.gray200,
                      color: uiConfig.colors.gray700,
                    }}
                  >
                    {col.type}
                  </span>
                </div>
                <div className="mt-1 truncate" style={{ color: uiConfig.colors.gray900 }}>
                  {col.name}
                </div>
              </th>
            ))}
            {hasOthersColumn && (
              <th
                scope="col"
                className="px-3 py-3 text-left text-xs font-semibold"
                style={{
                  color: uiConfig.colors.gray700,
                  borderBottom: `1px solid ${uiConfig.colors.gray200}`,
                  minWidth: 140,
                }}
                title={hiddenColumns.map((c) => `${c.type}: ${c.name}`).join('\n')}
              >
                <div style={{ color: uiConfig.colors.gray900 }}>
                  Others ({hiddenColumns.length})
                </div>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {outliers.map((user) => (
            <UserRow
              key={user.userId}
              user={user}
              visibleColumns={visibleColumns}
              hiddenColumns={hiddenColumns}
              hasOthersColumn={hasOthersColumn}
              onExplainAccess={onExplainAccess}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface UserRowProps {
  user: OutlierUser;
  visibleColumns: HeatColumn[];
  hiddenColumns: HeatColumn[];
  hasOthersColumn: boolean;
  onExplainAccess?: (
    userId: string,
    targetType: AccessNodeType,
    targetId: string,
  ) => void;
}

function UserRow({
  user,
  visibleColumns,
  hiddenColumns,
  hasOthersColumn,
  onExplainAccess,
}: UserRowProps) {
  const userEntitlementsByKey = useMemo(() => {
    const map = new Map<string, OutlierEntitlement>();
    for (const ent of user.outlierEntitlements) {
      map.set(`${ent.type}:${ent.id}`, ent);
    }
    return map;
  }, [user.outlierEntitlements]);

  const hiddenEntitlements = useMemo(() => {
    if (!hasOthersColumn) return [];
    return hiddenColumns
      .map((col) => userEntitlementsByKey.get(col.key))
      .filter((ent): ent is OutlierEntitlement => ent !== undefined);
  }, [hasOthersColumn, hiddenColumns, userEntitlementsByKey]);

  const recBadge = recommendationBadge(user.overallRecommendation);

  return (
    <tr style={{ borderTop: `1px solid ${uiConfig.colors.gray200}` }}>
      <td
        className="sticky left-0 z-10 px-4 py-3 align-top"
        style={{
          backgroundColor: 'white',
          borderRight: `1px solid ${uiConfig.colors.gray200}`,
          minWidth: 240,
        }}
      >
        <div
          className="text-sm font-medium font-mono"
          style={{ color: uiConfig.colors.gray900 }}
        >
          {user.login}
        </div>
        <div className="text-xs mt-1" style={{ color: uiConfig.colors.gray700 }}>
          {user.displayName}
        </div>
        <div className="text-xs mt-1" style={{ color: uiConfig.colors.gray600 }}>
          {[user.department, user.title].filter(Boolean).join(' · ') || '—'}
        </div>
        <div className="text-xs mt-2 flex flex-wrap items-center gap-2">
          <span
            className="px-2 py-0.5 rounded font-mono"
            style={{
              backgroundColor: uiConfig.colors.gray100,
              color: uiConfig.colors.gray700,
            }}
          >
            peers: {user.peerGroupSize}
          </span>
          <span
            className="px-2 py-0.5 rounded font-mono"
            style={{
              backgroundColor: uiConfig.colors.gray100,
              color: uiConfig.colors.gray700,
            }}
            title="Sum of (1 - peerCoverage) * weight across outlier entitlements"
          >
            score: {user.outlierScore.toFixed(2)}
          </span>
          <span
            className="px-2 py-0.5 rounded font-medium"
            style={{
              backgroundColor: recBadge.bg,
              color: recBadge.fg,
            }}
          >
            {user.overallRecommendation}
          </span>
        </div>
      </td>
      {visibleColumns.map((col) => {
        const ent = userEntitlementsByKey.get(col.key);
        return (
          <td
            key={col.key}
            className="px-2 py-2 align-top"
            style={{ minWidth: 140, maxWidth: 180 }}
          >
            {ent ? (
              <HeatCell
                entitlement={ent}
                clickable={Boolean(onExplainAccess)}
                onClick={
                  onExplainAccess
                    ? () => onExplainAccess(user.userId, ent.type, ent.id)
                    : undefined
                }
              />
            ) : (
              <EmptyCell />
            )}
          </td>
        );
      })}
      {hasOthersColumn && (
        <td className="px-2 py-2 align-top" style={{ minWidth: 140 }}>
          {hiddenEntitlements.length > 0 ? (
            <OthersCell
              entitlements={hiddenEntitlements}
              userId={user.userId}
              onExplainAccess={onExplainAccess}
            />
          ) : (
            <EmptyCell />
          )}
        </td>
      )}
    </tr>
  );
}

function HeatCell({
  entitlement,
  clickable,
  onClick,
}: {
  entitlement: OutlierEntitlement;
  clickable: boolean;
  onClick?: () => void;
}) {
  const { bg, border } = heatColors(entitlement.peerCoverage);
  const coveragePct = Math.round(entitlement.peerCoverage * 100);
  const tooltip = [
    `Coverage: ${coveragePct}% of peers`,
    `Peers with access: ${entitlement.peersWithAccess}`,
    `Recommendation: ${entitlement.recommendation}`,
    clickable ? 'Click to explain this access' : null,
  ]
    .filter(Boolean)
    .join('\n');

  const baseClass =
    'w-full text-left rounded px-2 py-2 text-xs transition-colors';
  const clickableClass = clickable ? 'cursor-pointer hover:opacity-90' : 'cursor-default';

  const content = (
    <>
      <div className="flex items-baseline justify-between gap-1">
        <span
          className="font-mono font-semibold"
          style={{ color: uiConfig.colors.gray900 }}
        >
          {coveragePct}%
        </span>
        <span
          className="text-[10px] font-medium uppercase tracking-wide"
          style={{ color: uiConfig.colors.gray700 }}
        >
          {entitlement.recommendation}
        </span>
      </div>
      <div
        className="mt-1 truncate"
        style={{ color: uiConfig.colors.gray700 }}
      >
        {entitlement.name}
      </div>
    </>
  );

  if (clickable) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={tooltip}
        className={`${baseClass} ${clickableClass}`}
        style={{ backgroundColor: bg, border: `1px solid ${border}` }}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      title={tooltip}
      className={`${baseClass} ${clickableClass}`}
      style={{ backgroundColor: bg, border: `1px solid ${border}` }}
    >
      {content}
    </div>
  );
}

function OthersCell({
  entitlements,
  userId,
  onExplainAccess,
}: {
  entitlements: OutlierEntitlement[];
  userId: string;
  onExplainAccess?: (
    userId: string,
    targetType: AccessNodeType,
    targetId: string,
  ) => void;
}) {
  // Pick the most anomalous (lowest peerCoverage) for cell color/intensity.
  const hottest = entitlements.reduce((best, cur) =>
    cur.peerCoverage < best.peerCoverage ? cur : best,
  );
  const { bg, border } = heatColors(hottest.peerCoverage);
  const tooltip = entitlements
    .map(
      (e) =>
        `${e.type}: ${e.name} — ${Math.round(e.peerCoverage * 100)}% peer coverage (${e.recommendation})`,
    )
    .join('\n');

  return (
    <div
      title={tooltip}
      className="rounded px-2 py-2 text-xs"
      style={{ backgroundColor: bg, border: `1px solid ${border}` }}
    >
      <div className="flex items-baseline justify-between gap-1">
        <span
          className="font-mono font-semibold"
          style={{ color: uiConfig.colors.gray900 }}
        >
          {entitlements.length} item{entitlements.length === 1 ? '' : 's'}
        </span>
        <span
          className="text-[10px] font-medium uppercase tracking-wide"
          style={{ color: uiConfig.colors.gray700 }}
        >
          ≤ {Math.round(hottest.peerCoverage * 100)}%
        </span>
      </div>
      {onExplainAccess && (
        <div className="mt-1 flex flex-wrap gap-1">
          {entitlements.slice(0, 3).map((ent) => (
            <button
              key={`${ent.type}:${ent.id}`}
              type="button"
              onClick={() => onExplainAccess(userId, ent.type, ent.id)}
              className="px-1.5 py-0.5 rounded text-[10px] font-medium"
              style={{
                backgroundColor: 'white',
                color: uiConfig.colors.primary,
                border: `1px solid ${uiConfig.colors.gray200}`,
              }}
              title={`Explain: ${ent.name}`}
            >
              Explain
            </button>
          ))}
          {entitlements.length > 3 && (
            <span
              className="text-[10px]"
              style={{ color: uiConfig.colors.gray700 }}
            >
              +{entitlements.length - 3} more
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyCell() {
  return (
    <div
      className="w-full h-full rounded"
      style={{
        minHeight: 36,
        backgroundColor: uiConfig.colors.gray50,
        border: `1px dashed ${uiConfig.colors.gray200}`,
      }}
      aria-hidden
    />
  );
}

function Legend() {
  const swatches: Array<{ label: string; color: string }> = [
    { label: '≥ 95% rare (red)', color: '#dc2626' },
    { label: '85–95% rare (orange)', color: '#f97316' },
    { label: '70–85% rare (yellow)', color: '#eab308' },
    { label: '< 70% rare (light)', color: '#fde68a' },
  ];

  return (
    <div
      className="rounded-lg border p-3 flex flex-wrap items-center gap-x-4 gap-y-2"
      style={{
        borderColor: uiConfig.colors.gray200,
        backgroundColor: 'white',
      }}
    >
      <span
        className="text-xs font-semibold uppercase tracking-wide"
        style={{ color: uiConfig.colors.gray600 }}
      >
        Heat
      </span>
      {swatches.map((s) => (
        <span
          key={s.label}
          className="flex items-center gap-2 text-xs"
          style={{ color: uiConfig.colors.gray700 }}
        >
          <span
            className="inline-block w-4 h-4 rounded"
            style={{ backgroundColor: s.color }}
            aria-hidden
          />
          {s.label}
        </span>
      ))}
      <span
        className="text-xs ml-auto"
        style={{ color: uiConfig.colors.gray600 }}
      >
        Click a cell to explain how the user got this access.
      </span>
    </div>
  );
}

/**
 * Map peerCoverage → cell background + border colors.
 *
 * Intensity = `1 - peerCoverage`. The rarer the access among peers, the
 * hotter the cell. Thresholds match the prompt:
 *   - intensity ≥ 0.95 → red
 *   - 0.85 ≤ intensity < 0.95 → orange
 *   - 0.70 ≤ intensity < 0.85 → yellow
 *   - intensity < 0.70 → soft yellow (still flagged but low intensity)
 */
function heatColors(peerCoverage: number): { bg: string; border: string } {
  const intensity = 1 - peerCoverage;
  if (intensity >= 0.95) {
    return { bg: '#fee2e2', border: '#dc2626' };
  }
  if (intensity >= 0.85) {
    return { bg: '#ffedd5', border: '#f97316' };
  }
  if (intensity >= 0.7) {
    return { bg: '#fef9c3', border: '#eab308' };
  }
  return { bg: '#fefce8', border: '#fde68a' };
}

function recommendationBadge(rec: OutlierRecommendation): {
  bg: string;
  fg: string;
} {
  switch (rec) {
    case 'Likely revoke':
      return { bg: '#fee2e2', fg: uiConfig.colors.error };
    case 'Review':
      return { bg: '#fef3c7', fg: '#92400e' };
    case 'Investigate':
    default:
      return { bg: uiConfig.colors.gray100, fg: uiConfig.colors.gray700 };
  }
}
