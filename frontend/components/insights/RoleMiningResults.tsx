/**
 * RoleMiningResults Component
 *
 * Discover-tab body for InsightsHub. Owns the input form for the
 * `mine_candidate_roles` MCP tool, runs the call against `/api/mcp/call`,
 * and renders the structured results as a stack of role cards.
 *
 * Internal state machine: 'idle' | 'running' | 'results' | 'error'.
 */

'use client';

import { useEffect, useState } from 'react';
import { uiConfig } from '@/lib/ui-config';

type ScopeType = 'app' | 'group' | 'department' | 'all';
type AccessNodeType = 'group' | 'app' | 'entitlement';

interface CandidateRoleMember {
  userId: string;
  login: string;
  department?: string;
  title?: string;
}

interface CandidateRoleAccess {
  type: AccessNodeType;
  id: string;
  name: string;
  coverage: number;
}

interface CandidateRole {
  proposedName: string;
  confidence: number;
  cohesion: number;
  memberCount: number;
  members: CandidateRoleMember[];
  commonAccess: CandidateRoleAccess[];
  suggestedAction: string;
  rationale: string;
}

export interface MiningResultPayload {
  scopeDescription: string;
  totalUsersAnalyzed: number;
  candidateRoles: CandidateRole[];
  summary: {
    highConfidenceCount: number;
    totalProposed: number;
    estimatedAccessReduction: number;
  };
}

export interface RoleMiningResultsProps {
  /**
   * If provided, the component skips the form and renders the results
   * panel pre-loaded with this payload. Used by the chat integration.
   */
  initialResult?: MiningResultPayload;
}

type RunState = 'idle' | 'running' | 'results' | 'error';

interface FormValues {
  scopeType: ScopeType;
  scopeId: string;
  minClusterSize: number;
  similarityThreshold: number;
  commonAccessThreshold: number;
  maxResults: number;
}

const DEFAULT_FORM: FormValues = {
  scopeType: 'app',
  scopeId: '',
  minClusterSize: 5,
  similarityThreshold: 0.7,
  commonAccessThreshold: 0.8,
  maxResults: 10,
};

export default function RoleMiningResults({
  initialResult,
}: RoleMiningResultsProps = {}) {
  const [state, setState] = useState<RunState>(initialResult ? 'results' : 'idle');
  const [form, setForm] = useState<FormValues>(DEFAULT_FORM);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [result, setResult] = useState<MiningResultPayload | null>(
    initialResult ?? null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expandedMembers, setExpandedMembers] = useState<Record<number, boolean>>({});
  const [expandedAccess, setExpandedAccess] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (initialResult) {
      setResult(initialResult);
      setState('results');
      setExpandedMembers({});
      setExpandedAccess({});
      setErrorMessage(null);
    }
  }, [initialResult]);

  const updateField = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const resetToForm = () => {
    setState('idle');
    setResult(null);
    setErrorMessage(null);
    setExpandedMembers({});
    setExpandedAccess({});
  };

  const runMining = async () => {
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
      minClusterSize: form.minClusterSize,
      similarityThreshold: form.similarityThreshold,
      commonAccessThreshold: form.commonAccessThreshold,
      maxResults: form.maxResults,
    };
    if (form.scopeType !== 'all') {
      args.scopeId = form.scopeId.trim();
    }

    try {
      console.log('[RoleMiningResults] Invoking mine_candidate_roles', args);
      const response = await fetch('/api/mcp/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName: 'mine_candidate_roles',
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

      let parsed: MiningResultPayload;
      try {
        parsed = JSON.parse(textContent) as MiningResultPayload;
      } catch {
        throw new Error('Tool succeeded but response was not valid JSON');
      }

      setResult(parsed);
      setExpandedMembers({});
      setExpandedAccess({});
      setState('results');
    } catch (err) {
      console.error('[RoleMiningResults] Mining failed', err);
      setErrorMessage(err instanceof Error ? err.message : 'Unknown error');
      setState('error');
    }
  };

  return (
    <div className="p-6 space-y-6">
      {(state === 'idle' || state === 'results' || state === 'error') && (
        <MiningForm
          form={form}
          showAdvanced={showAdvanced}
          onToggleAdvanced={() => setShowAdvanced((v) => !v)}
          onChange={updateField}
          onSubmit={runMining}
          onReset={state === 'results' ? resetToForm : undefined}
          isResults={state === 'results'}
        />
      )}

      {state === 'running' && <RunningPanel />}

      {state === 'error' && errorMessage && (
        <ErrorBanner message={errorMessage} onRetry={runMining} />
      )}

      {state === 'results' && result && (
        <ResultsPanel
          result={result}
          expandedMembers={expandedMembers}
          expandedAccess={expandedAccess}
          onToggleMembers={(idx) =>
            setExpandedMembers((prev) => ({ ...prev, [idx]: !prev[idx] }))
          }
          onToggleAccess={(idx) =>
            setExpandedAccess((prev) => ({ ...prev, [idx]: !prev[idx] }))
          }
        />
      )}
    </div>
  );
}

interface MiningFormProps {
  form: FormValues;
  showAdvanced: boolean;
  onToggleAdvanced: () => void;
  onChange: <K extends keyof FormValues>(key: K, value: FormValues[K]) => void;
  onSubmit: () => void;
  onReset?: () => void;
  isResults: boolean;
}

function MiningForm({
  form,
  showAdvanced,
  onToggleAdvanced,
  onChange,
  onSubmit,
  onReset,
  isResults,
}: MiningFormProps) {
  const scopeOptions: Array<{ id: ScopeType; label: string; helper: string }> = [
    { id: 'app', label: 'App', helper: 'Users assigned to a single app' },
    { id: 'group', label: 'Group', helper: 'Members of a single group' },
    { id: 'department', label: 'Department', helper: 'All users in a department' },
    { id: 'all', label: 'All', helper: 'Every active user (slow)' },
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
            Mine candidate roles
          </h3>
          <p className="text-sm mt-1" style={{ color: uiConfig.colors.gray600 }}>
            Cluster users with similar access patterns into proposed roles. Results are
            proposals only — no groups are created.
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
                  name="scopeType"
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
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded border bg-white" style={{ borderColor: uiConfig.colors.gray200 }}>
            <NumberField
              label="Min cluster size"
              value={form.minClusterSize}
              min={2}
              step={1}
              onChange={(v) => onChange('minClusterSize', v)}
            />
            <NumberField
              label="Max results"
              value={form.maxResults}
              min={1}
              step={1}
              onChange={(v) => onChange('maxResults', v)}
            />
            <SliderField
              label="Similarity threshold"
              value={form.similarityThreshold}
              onChange={(v) => onChange('similarityThreshold', v)}
            />
            <SliderField
              label="Common access threshold"
              value={form.commonAccessThreshold}
              onChange={(v) => onChange('commonAccessThreshold', v)}
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
          Run Mining
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
  onChange,
}: {
  label: string;
  value: number;
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
        min={0}
        max={1}
        step={0.05}
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
        Building access graph… clustering… ranking…
      </p>
      <p className="text-xs mt-2" style={{ color: uiConfig.colors.gray600 }}>
        Mining can take 30+ seconds for larger scopes — Okta API pagination is the
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
        <p className="font-semibold text-sm">Mining failed</p>
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
  result: MiningResultPayload;
  expandedMembers: Record<number, boolean>;
  expandedAccess: Record<number, boolean>;
  onToggleMembers: (idx: number) => void;
  onToggleAccess: (idx: number) => void;
}

function ResultsPanel({
  result,
  expandedMembers,
  expandedAccess,
  onToggleMembers,
  onToggleAccess,
}: ResultsPanelProps) {
  const { candidateRoles, summary, scopeDescription, totalUsersAnalyzed } = result;

  if (candidateRoles.length === 0) {
    return (
      <div
        className="rounded-lg border p-6 text-center"
        style={{ borderColor: uiConfig.colors.gray200, backgroundColor: 'white' }}
      >
        <p className="text-sm font-medium" style={{ color: uiConfig.colors.gray900 }}>
          No candidate roles found in this scope.
        </p>
        <p className="text-xs mt-2" style={{ color: uiConfig.colors.gray600 }}>
          Scope: {scopeDescription} · {totalUsersAnalyzed} user(s) analyzed.
          Try lowering the similarity threshold or min cluster size and run again.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        className="rounded-lg p-4 flex flex-wrap gap-x-6 gap-y-1 items-baseline"
        style={{ background: uiConfig.gradients.card, border: `1px solid ${uiConfig.colors.gray200}` }}
      >
        <p className="text-sm" style={{ color: uiConfig.colors.gray900 }}>
          <strong>Found {summary.totalProposed} candidate role{summary.totalProposed === 1 ? '' : 's'}</strong>
          {' · '}
          {summary.highConfidenceCount} high-confidence
          {' · '}
          ~{summary.estimatedAccessReduction} redundant assignment{summary.estimatedAccessReduction === 1 ? '' : 's'} could be eliminated
        </p>
        <p className="text-xs" style={{ color: uiConfig.colors.gray600 }}>
          Scope: {scopeDescription} · {totalUsersAnalyzed} user(s) analyzed
        </p>
      </div>

      {candidateRoles.map((role, idx) => (
        <RoleCard
          key={`${role.proposedName}-${idx}`}
          role={role}
          membersExpanded={!!expandedMembers[idx]}
          accessExpanded={!!expandedAccess[idx]}
          onToggleMembers={() => onToggleMembers(idx)}
          onToggleAccess={() => onToggleAccess(idx)}
        />
      ))}
    </div>
  );
}

interface RoleCardProps {
  role: CandidateRole;
  membersExpanded: boolean;
  accessExpanded: boolean;
  onToggleMembers: () => void;
  onToggleAccess: () => void;
}

function RoleCard({
  role,
  membersExpanded,
  accessExpanded,
  onToggleMembers,
  onToggleAccess,
}: RoleCardProps) {
  const confidence = role.confidence;
  const confidenceColor =
    confidence >= 0.85
      ? uiConfig.colors.success
      : confidence >= 0.6
        ? uiConfig.colors.warning
        : uiConfig.colors.error;

  return (
    <div
      className="rounded-lg border bg-white shadow-sm"
      style={{ borderColor: uiConfig.colors.gray200 }}
    >
      <div
        className="p-4 border-b flex items-start justify-between gap-4"
        style={{ borderColor: uiConfig.colors.gray200 }}
      >
        <div>
          <h4
            className="text-base font-semibold"
            style={{ color: uiConfig.colors.gray900 }}
          >
            {role.proposedName}
          </h4>
          <p className="text-xs mt-1" style={{ color: uiConfig.colors.gray600 }}>
            {role.memberCount} user{role.memberCount === 1 ? '' : 's'}
            {' · '}
            {role.commonAccess.length} shared access item
            {role.commonAccess.length === 1 ? '' : 's'}
            {' · '}
            cohesion {Math.round(role.cohesion * 100)}%
          </p>
        </div>
        <div
          className="px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap"
          style={{
            backgroundColor: confidenceColor + '20',
            color: confidenceColor,
          }}
        >
          {Math.round(confidence * 100)}% confidence
        </div>
      </div>

      <div className="p-4 space-y-3">
        <p className="text-sm" style={{ color: uiConfig.colors.gray700 }}>
          {role.rationale}
        </p>

        <ExpanderSection
          label={`Members (${role.members.length})`}
          expanded={membersExpanded}
          onToggle={onToggleMembers}
        >
          <ul className="divide-y" style={{ borderColor: uiConfig.colors.gray200 }}>
            {role.members.map((m) => (
              <li
                key={m.userId}
                className="py-2 text-sm flex flex-wrap gap-x-4"
                style={{ color: uiConfig.colors.gray700 }}
              >
                <span
                  className="font-mono"
                  style={{ color: uiConfig.colors.gray900 }}
                >
                  {m.login}
                </span>
                <span style={{ color: uiConfig.colors.gray600 }}>
                  {[m.department, m.title].filter(Boolean).join(' · ') || '—'}
                </span>
              </li>
            ))}
          </ul>
        </ExpanderSection>

        <ExpanderSection
          label={`Common Access (${role.commonAccess.length})`}
          expanded={accessExpanded}
          onToggle={onToggleAccess}
        >
          {role.commonAccess.length === 0 ? (
            <p className="text-sm py-2" style={{ color: uiConfig.colors.gray600 }}>
              No access nodes met the common-access threshold.
            </p>
          ) : (
            <ul className="space-y-2">
              {role.commonAccess.map((a) => (
                <li key={`${a.type}:${a.id}`} className="text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span style={{ color: uiConfig.colors.gray900 }}>
                      <span
                        className="text-xs font-mono mr-2 px-1.5 py-0.5 rounded"
                        style={{
                          backgroundColor: uiConfig.colors.gray100,
                          color: uiConfig.colors.gray700,
                        }}
                      >
                        {a.type}
                      </span>
                      {a.name}
                    </span>
                    <span
                      className="text-xs font-mono"
                      style={{ color: uiConfig.colors.gray600 }}
                    >
                      {Math.round(a.coverage * 100)}%
                    </span>
                  </div>
                  <div
                    className="mt-1 h-2 rounded overflow-hidden"
                    style={{ backgroundColor: uiConfig.colors.gray100 }}
                  >
                    <div
                      className="h-full"
                      style={{
                        width: `${Math.round(a.coverage * 100)}%`,
                        backgroundColor: uiConfig.colors.success,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ExpanderSection>

        <div className="pt-2 flex justify-end">
          <button
            type="button"
            disabled
            title="Action coming soon"
            className="px-4 py-2 rounded text-sm font-semibold cursor-not-allowed"
            style={{
              backgroundColor: uiConfig.colors.gray200,
              color: uiConfig.colors.gray600,
            }}
          >
            {role.suggestedAction}
          </button>
        </div>
      </div>
    </div>
  );
}

function ExpanderSection({
  label,
  expanded,
  onToggle,
  children,
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded border"
      style={{ borderColor: uiConfig.colors.gray200 }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-3 py-2 flex items-center justify-between text-sm font-medium"
        style={{ color: uiConfig.colors.gray900 }}
      >
        <span>{label}</span>
        <span style={{ color: uiConfig.colors.gray600 }}>{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div
          className="px-3 pb-3 border-t"
          style={{ borderColor: uiConfig.colors.gray200 }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
