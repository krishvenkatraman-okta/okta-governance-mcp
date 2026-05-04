/**
 * AccessExplainer Component
 *
 * Explain-tab body for InsightsHub. Owns the input form for the
 * `explain_user_access` MCP tool, runs the call against `/api/mcp/call`,
 * and renders the result as:
 *
 *   1. A summary card (user info + target + bold yes/no answer + plain
 *      English explanation paragraph)
 *   2. A list of access paths visualized as horizontal node-arrow chains:
 *
 *        [User] → [Group: "Sales Admins"] → [App: "Salesforce"]
 *
 *      The shortest path (`isPrimary === true`) is shown first with a
 *      green "Primary" badge. Redundant paths collapse by default.
 *
 *      Each node is clickable — clicking opens a popover with grant date,
 *      granter, and rule expression (when applicable).
 *
 * Deep-link support: when the Risks tab passes `(userId, targetType,
 * targetId)` we auto-run the tool on mount. For entitlement targets,
 * the tool also requires `entitlementAppId`, which the deep-link does
 * not carry — in that case we pre-fill the form, surface the entitlement
 * field, and wait for the user to supply the app ID before running.
 *
 * Internal state machine: 'idle' | 'running' | 'results' | 'error'.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { uiConfig } from '@/lib/ui-config';

type TargetType = 'app' | 'entitlement' | 'group';
type NodeType = 'user' | 'group' | 'rule' | 'role' | 'app' | 'entitlement';
type PathType = 'direct' | 'group_membership' | 'group_rule' | 'role_assignment';
type RunState = 'idle' | 'running' | 'results' | 'error';

interface ExplanationNode {
  nodeType: NodeType;
  id: string;
  name: string;
  grantedDate?: string;
  grantedBy?: string;
  ruleExpression?: string;
}

interface ExplanationPath {
  pathType: PathType;
  isPrimary: boolean;
  nodes: ExplanationNode[];
  narrative: string;
}

export interface ExplanationResultPayload {
  user: {
    id: string;
    login: string;
    displayName: string;
    department?: string;
    title?: string;
  };
  target: {
    type: TargetType;
    id: string;
    name: string;
  };
  hasAccess: boolean;
  paths: ExplanationPath[];
  summary: {
    totalPaths: number;
    redundantPathCount: number;
    earliestGrant?: string;
    explanation: string;
  };
}

interface FormValues {
  userId: string;
  targetType: TargetType;
  targetId: string;
  entitlementAppId: string;
}

export interface AccessExplainerProps {
  /**
   * If provided alongside `initialTargetType` and `initialTargetId`, the
   * component pre-fills the form and (for non-entitlement targets) auto-
   * runs the tool on mount.
   */
  initialUserId?: string;
  initialTargetType?: TargetType;
  initialTargetId?: string;
  /**
   * If provided, the component skips the form and renders the results
   * panel pre-loaded with this payload. Used by the chat integration —
   * mutually exclusive with the deep-link triple above.
   */
  initialResult?: ExplanationResultPayload;
}

export default function AccessExplainer({
  initialUserId,
  initialTargetType,
  initialTargetId,
  initialResult,
}: AccessExplainerProps) {
  const [state, setState] = useState<RunState>(initialResult ? 'results' : 'idle');
  const [form, setForm] = useState<FormValues>(() => ({
    userId: initialResult?.user.login ?? initialUserId ?? '',
    targetType: initialResult?.target.type ?? initialTargetType ?? 'app',
    targetId: initialResult?.target.id ?? initialTargetId ?? '',
    entitlementAppId: '',
  }));
  const [result, setResult] = useState<ExplanationResultPayload | null>(
    initialResult ?? null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showRedundant, setShowRedundant] = useState(false);

  // Track which node popover is open. Composite key:
  // `${pathIndex}:${nodeIndex}`. Only one open at a time.
  const [openPopover, setOpenPopover] = useState<string | null>(null);

  // Fingerprint of the deep-link we last auto-ran for, so re-renders
  // with the same initial props don't keep re-firing the tool.
  const autoRanFor = useRef<string | null>(null);

  const updateField = <K extends keyof FormValues>(
    key: K,
    value: FormValues[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const runExplain = async (override?: Partial<FormValues>) => {
    const effective: FormValues = { ...form, ...(override ?? {}) };

    if (!effective.userId.trim()) {
      setErrorMessage('userId is required');
      setState('error');
      return;
    }
    if (!effective.targetId.trim()) {
      setErrorMessage('targetId is required');
      setState('error');
      return;
    }
    if (effective.targetType === 'entitlement' && !effective.entitlementAppId.trim()) {
      setErrorMessage(
        'entitlementAppId is required when target type is "entitlement" — the Governance Grants API is keyed by (user, app).',
      );
      setState('error');
      return;
    }

    setState('running');
    setErrorMessage(null);
    setResult(null);
    setOpenPopover(null);
    setShowRedundant(false);

    const args: Record<string, unknown> = {
      userId: effective.userId.trim(),
      targetType: effective.targetType,
      targetId: effective.targetId.trim(),
      includeRedundantPaths: true,
    };
    if (effective.targetType === 'entitlement') {
      args.entitlementAppId = effective.entitlementAppId.trim();
    }

    try {
      console.log('[AccessExplainer] Invoking explain_user_access', args);
      const response = await fetch('/api/mcp/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName: 'explain_user_access',
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

      let parsed: ExplanationResultPayload;
      try {
        parsed = JSON.parse(textContent) as ExplanationResultPayload;
      } catch {
        throw new Error('Tool succeeded but response was not valid JSON');
      }

      setResult(parsed);
      setState('results');
    } catch (err) {
      console.error('[AccessExplainer] Explain failed', err);
      setErrorMessage(err instanceof Error ? err.message : 'Unknown error');
      setState('error');
    }
  };

  // If the parent swaps in a new initialResult (e.g. chat opens a
  // different explanation), display it immediately.
  useEffect(() => {
    if (initialResult) {
      setResult(initialResult);
      setState('results');
      setErrorMessage(null);
      setOpenPopover(null);
      setShowRedundant(false);
    }
  }, [initialResult]);

  // Auto-run when caller supplies the deep-link triple — but only once
  // per distinct deep-link, and only when we have everything the tool
  // needs (entitlement targets need `entitlementAppId`, which the deep-
  // link does not carry). Skipped when an `initialResult` is supplied,
  // since we already have the answer.
  useEffect(() => {
    if (initialResult) return;
    if (!initialUserId || !initialTargetType || !initialTargetId) return;
    if (initialTargetType === 'entitlement') return;

    const fingerprint = `${initialUserId}|${initialTargetType}|${initialTargetId}`;
    if (autoRanFor.current === fingerprint) return;
    autoRanFor.current = fingerprint;

    setForm({
      userId: initialUserId,
      targetType: initialTargetType,
      targetId: initialTargetId,
      entitlementAppId: '',
    });
    void runExplain({
      userId: initialUserId,
      targetType: initialTargetType,
      targetId: initialTargetId,
      entitlementAppId: '',
    });
    // We intentionally don't depend on `runExplain` (it's recreated each
    // render) — the fingerprint guard above handles re-run protection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUserId, initialTargetType, initialTargetId]);

  return (
    <div className="p-6 space-y-6">
      <ExplainForm
        form={form}
        onChange={updateField}
        onSubmit={() => runExplain()}
        isResults={state === 'results'}
      />

      {state === 'running' && <RunningPanel />}

      {state === 'error' && errorMessage && (
        <ErrorBanner message={errorMessage} onRetry={() => runExplain()} />
      )}

      {state === 'results' && result && (
        <ResultsPanel
          result={result}
          showRedundant={showRedundant}
          onToggleRedundant={() => setShowRedundant((v) => !v)}
          openPopover={openPopover}
          onOpenPopover={setOpenPopover}
        />
      )}
    </div>
  );
}

interface ExplainFormProps {
  form: FormValues;
  onChange: <K extends keyof FormValues>(key: K, value: FormValues[K]) => void;
  onSubmit: () => void;
  isResults: boolean;
}

function ExplainForm({ form, onChange, onSubmit, isResults }: ExplainFormProps) {
  const targetOptions: Array<{ id: TargetType; label: string; helper: string }> = [
    { id: 'app', label: 'App', helper: 'Explain how the user got access to an app' },
    {
      id: 'entitlement',
      label: 'Entitlement',
      helper: 'Trace a fine-grained entitlement grant',
    },
    {
      id: 'group',
      label: 'Group',
      helper: 'Explain why the user is a member of a group',
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
          <h3
            className="text-lg font-semibold"
            style={{ color: uiConfig.colors.gray900 }}
          >
            Explain access
          </h3>
          <p
            className="text-sm mt-1"
            style={{ color: uiConfig.colors.gray600 }}
          >
            Trace exactly how a user came to have access to an app, group, or
            entitlement — with grant dates, granters, and rule expressions.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <label className="block">
          <span
            className="block text-xs font-semibold uppercase tracking-wide mb-1"
            style={{ color: uiConfig.colors.gray600 }}
          >
            User ID or login
          </span>
          <input
            type="text"
            value={form.userId}
            autoFocus={!isResults}
            onChange={(e) => onChange('userId', e.target.value)}
            placeholder="user@example.com or 00u1abc..."
            className="w-full px-3 py-2 border rounded text-sm font-mono"
            style={{ borderColor: uiConfig.colors.gray300 }}
          />
        </label>

        <label className="block">
          <span
            className="block text-xs font-semibold uppercase tracking-wide mb-1"
            style={{ color: uiConfig.colors.gray600 }}
          >
            {targetIdLabel(form.targetType)}
          </span>
          <input
            type="text"
            value={form.targetId}
            onChange={(e) => onChange('targetId', e.target.value)}
            placeholder={targetIdPlaceholder(form.targetType)}
            className="w-full px-3 py-2 border rounded text-sm font-mono"
            style={{ borderColor: uiConfig.colors.gray300 }}
          />
        </label>
      </div>

      <fieldset className="mb-4">
        <legend
          className="text-xs font-semibold uppercase tracking-wide mb-2"
          style={{ color: uiConfig.colors.gray600 }}
        >
          Target type
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {targetOptions.map((opt) => {
            const selected = form.targetType === opt.id;
            return (
              <label
                key={opt.id}
                className="flex items-start gap-2 p-3 rounded border cursor-pointer transition-colors"
                style={{
                  borderColor: selected
                    ? uiConfig.colors.primary
                    : uiConfig.colors.gray200,
                  backgroundColor: selected ? '#eff6ff' : 'white',
                }}
              >
                <input
                  type="radio"
                  name="explainTargetType"
                  value={opt.id}
                  checked={selected}
                  onChange={() => onChange('targetType', opt.id)}
                  className="mt-1"
                />
                <div>
                  <div
                    className="text-sm font-medium"
                    style={{ color: uiConfig.colors.gray900 }}
                  >
                    {opt.label}
                  </div>
                  <div
                    className="text-xs"
                    style={{ color: uiConfig.colors.gray600 }}
                  >
                    {opt.helper}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </fieldset>

      {form.targetType === 'entitlement' && (
        <div className="mb-4">
          <label className="block">
            <span
              className="block text-xs font-semibold uppercase tracking-wide mb-1"
              style={{ color: uiConfig.colors.gray600 }}
            >
              Parent App ID
            </span>
            <input
              type="text"
              value={form.entitlementAppId}
              onChange={(e) => onChange('entitlementAppId', e.target.value)}
              placeholder="0oa1abcd2efGHijKLM3"
              className="w-full px-3 py-2 border rounded text-sm font-mono"
              style={{ borderColor: uiConfig.colors.gray300 }}
            />
            <p
              className="text-xs mt-1"
              style={{ color: uiConfig.colors.gray600 }}
            >
              The Governance Grants API is keyed by (user, app), so explaining
              an entitlement requires the parent app&apos;s ID.
            </p>
          </label>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onSubmit}
          className="px-5 py-2 rounded-lg text-sm font-semibold text-white"
          style={{ backgroundColor: uiConfig.colors.primary }}
        >
          {isResults ? 'Explain again' : 'Explain'}
        </button>
      </div>
    </div>
  );
}

function targetIdLabel(targetType: TargetType): string {
  if (targetType === 'app') return 'App ID';
  if (targetType === 'group') return 'Group ID';
  return 'Entitlement ID';
}

function targetIdPlaceholder(targetType: TargetType): string {
  if (targetType === 'app') return '0oa1abcd2efGHijKLM3';
  if (targetType === 'group') return '00g1abcd2efGHijKLM3';
  return 'ent_abc123';
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
      <p
        className="text-sm font-medium"
        style={{ color: uiConfig.colors.gray900 }}
      >
        Resolving user… walking access graph… composing narratives…
      </p>
      <p
        className="text-xs mt-2"
        style={{ color: uiConfig.colors.gray600 }}
      >
        Tracing access paths can take 10–20 seconds — Okta system-log queries
        are the long pole.
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
        <p className="font-semibold text-sm">Explain failed</p>
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
  result: ExplanationResultPayload;
  showRedundant: boolean;
  onToggleRedundant: () => void;
  openPopover: string | null;
  onOpenPopover: (key: string | null) => void;
}

function ResultsPanel({
  result,
  showRedundant,
  onToggleRedundant,
  openPopover,
  onOpenPopover,
}: ResultsPanelProps) {
  const { user, target, hasAccess, paths, summary } = result;

  const primaryPath = paths.find((p) => p.isPrimary);
  const otherPaths = paths.filter((p) => !p.isPrimary);

  return (
    <div className="space-y-5">
      <SummaryCard
        user={user}
        target={target}
        hasAccess={hasAccess}
        explanation={summary.explanation}
        earliestGrant={summary.earliestGrant}
      />

      {!hasAccess && <NoAccessNotice targetName={target.name} />}

      {hasAccess && primaryPath && (
        <PathCard
          path={primaryPath}
          pathIndex={0}
          openPopover={openPopover}
          onOpenPopover={onOpenPopover}
        />
      )}

      {hasAccess && otherPaths.length > 0 && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={onToggleRedundant}
            className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1"
            style={{ color: uiConfig.colors.primary }}
          >
            {showRedundant ? '▾' : '▸'} {otherPaths.length} redundant path
            {otherPaths.length === 1 ? '' : 's'}
          </button>

          {showRedundant &&
            otherPaths.map((p, idx) => (
              <PathCard
                key={`redundant-${idx}`}
                path={p}
                pathIndex={idx + 1}
                openPopover={openPopover}
                onOpenPopover={onOpenPopover}
              />
            ))}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  user,
  target,
  hasAccess,
  explanation,
  earliestGrant,
}: {
  user: ExplanationResultPayload['user'];
  target: ExplanationResultPayload['target'];
  hasAccess: boolean;
  explanation: string;
  earliestGrant?: string;
}) {
  const initials = user.displayName
    .split(/\s+/)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .filter(Boolean)
    .slice(0, 2)
    .join('') || '?';

  return (
    <div
      className="rounded-lg p-5"
      style={{
        background: uiConfig.gradients.card,
        border: `1px solid ${uiConfig.colors.gray200}`,
      }}
    >
      <div className="flex items-start gap-4">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-semibold flex-shrink-0"
          style={{
            background: uiConfig.gradients.primary,
            color: 'white',
          }}
          aria-hidden
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="text-sm font-semibold"
            style={{ color: uiConfig.colors.gray900 }}
          >
            {user.displayName}
          </div>
          <div
            className="text-xs font-mono"
            style={{ color: uiConfig.colors.gray700 }}
          >
            {user.login}
          </div>
          <div
            className="text-xs mt-1"
            style={{ color: uiConfig.colors.gray600 }}
          >
            {[user.department, user.title].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
        <div className="text-right max-w-xs">
          <div
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: uiConfig.colors.gray600 }}
          >
            {target.type}
          </div>
          <div
            className="text-sm font-medium truncate"
            style={{ color: uiConfig.colors.gray900 }}
            title={target.name}
          >
            {target.name}
          </div>
          <div
            className="text-[10px] font-mono mt-0.5"
            style={{ color: uiConfig.colors.gray600 }}
          >
            {target.id}
          </div>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t" style={{ borderColor: uiConfig.colors.gray200 }}>
        <p
          className="text-base font-semibold"
          style={{
            color: hasAccess ? uiConfig.colors.success : uiConfig.colors.gray900,
          }}
        >
          {hasAccess
            ? 'Yes, this user has access.'
            : 'No, this user does not currently have access.'}
        </p>
        <p
          className="text-sm mt-2"
          style={{ color: uiConfig.colors.gray700 }}
        >
          {explanation}
        </p>
        {earliestGrant && (
          <p
            className="text-xs mt-2"
            style={{ color: uiConfig.colors.gray600 }}
          >
            Earliest known grant on this path: {formatDate(earliestGrant)}
          </p>
        )}
      </div>
    </div>
  );
}

function NoAccessNotice({ targetName }: { targetName: string }) {
  return (
    <div
      className="rounded-lg border p-4"
      style={{
        borderColor: uiConfig.colors.gray200,
        backgroundColor: 'white',
      }}
    >
      <p
        className="text-sm font-medium"
        style={{ color: uiConfig.colors.gray900 }}
      >
        No access path found.
      </p>
      <p
        className="text-xs mt-1"
        style={{ color: uiConfig.colors.gray600 }}
      >
        We could not trace any active path from this user to{' '}
        <span className="font-mono">{targetName}</span>. This typically means
        the access was recently removed, the user was deprovisioned from the
        relevant group, or it was never granted in the first place. Check the
        Okta system log for recent <code>.remove</code> events on this user.
      </p>
    </div>
  );
}

interface PathCardProps {
  path: ExplanationPath;
  pathIndex: number;
  openPopover: string | null;
  onOpenPopover: (key: string | null) => void;
}

function PathCard({ path, pathIndex, openPopover, onOpenPopover }: PathCardProps) {
  const badge = pathTypeBadge(path.pathType);
  return (
    <div
      className="rounded-lg border p-4 bg-white"
      style={{ borderColor: uiConfig.colors.gray200 }}
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {path.isPrimary && (
          <span
            className="px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wide"
            style={{
              backgroundColor: '#dcfce7',
              color: uiConfig.colors.success,
            }}
          >
            Primary
          </span>
        )}
        <span
          className="px-2 py-0.5 rounded text-[11px] font-medium"
          style={{ backgroundColor: badge.bg, color: badge.fg }}
        >
          {badge.label}
        </span>
        <span
          className="text-xs"
          style={{ color: uiConfig.colors.gray600 }}
        >
          {path.nodes.length} hop{path.nodes.length === 1 ? '' : 's'}
        </span>
      </div>

      <PathFlow
        nodes={path.nodes}
        pathIndex={pathIndex}
        openPopover={openPopover}
        onOpenPopover={onOpenPopover}
      />

      <p
        className="text-sm mt-4 leading-relaxed"
        style={{ color: uiConfig.colors.gray700 }}
      >
        {path.narrative}
      </p>
    </div>
  );
}

interface PathFlowProps {
  nodes: ExplanationNode[];
  pathIndex: number;
  openPopover: string | null;
  onOpenPopover: (key: string | null) => void;
}

function PathFlow({ nodes, pathIndex, openPopover, onOpenPopover }: PathFlowProps) {
  return (
    <div className="flex items-stretch gap-2 overflow-x-auto pb-2">
      {nodes.map((node, idx) => {
        const key = `${pathIndex}:${idx}`;
        const isOpen = openPopover === key;
        const hasDetails =
          Boolean(node.grantedDate) ||
          Boolean(node.grantedBy) ||
          Boolean(node.ruleExpression);
        return (
          <div
            key={`${node.nodeType}-${node.id}-${idx}`}
            className="flex items-center gap-2 flex-shrink-0"
          >
            <div className="relative">
              <button
                type="button"
                onClick={() => onOpenPopover(isOpen ? null : key)}
                className="block text-left rounded-lg border px-3 py-2 transition-colors min-w-[140px] max-w-[200px]"
                style={{
                  borderColor: isOpen
                    ? uiConfig.colors.primary
                    : uiConfig.colors.gray200,
                  backgroundColor: nodeBackground(node.nodeType),
                }}
                title={hasDetails ? 'Click for details' : node.name}
              >
                <div
                  className="text-[10px] font-semibold uppercase tracking-wide flex items-center gap-1"
                  style={{ color: uiConfig.colors.gray600 }}
                >
                  <span aria-hidden>{nodeIcon(node.nodeType)}</span>
                  <span>{node.nodeType}</span>
                </div>
                <div
                  className="text-sm font-medium truncate mt-0.5"
                  style={{ color: uiConfig.colors.gray900 }}
                >
                  {node.name}
                </div>
                {hasDetails && (
                  <div
                    className="text-[10px] mt-1"
                    style={{ color: uiConfig.colors.primary }}
                  >
                    Details ▾
                  </div>
                )}
              </button>

              {isOpen && hasDetails && (
                <NodePopover
                  node={node}
                  onClose={() => onOpenPopover(null)}
                />
              )}
            </div>
            {idx < nodes.length - 1 && (
              <span
                className="text-xl flex-shrink-0"
                aria-hidden
                style={{ color: uiConfig.colors.gray300 }}
              >
                →
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function NodePopover({
  node,
  onClose,
}: {
  node: ExplanationNode;
  onClose: () => void;
}) {
  return (
    <div
      className="absolute z-20 mt-2 left-0 w-72 rounded-lg shadow-lg p-3 bg-white"
      style={{
        border: `1px solid ${uiConfig.colors.gray200}`,
      }}
      role="dialog"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <div
            className="text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: uiConfig.colors.gray600 }}
          >
            {node.nodeType}
          </div>
          <div
            className="text-sm font-medium"
            style={{ color: uiConfig.colors.gray900 }}
          >
            {node.name}
          </div>
          <div
            className="text-[10px] font-mono"
            style={{ color: uiConfig.colors.gray600 }}
          >
            {node.id}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs px-2 py-0.5 rounded"
          style={{
            backgroundColor: uiConfig.colors.gray200,
            color: uiConfig.colors.gray700,
          }}
        >
          Close
        </button>
      </div>
      <dl
        className="text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-1"
        style={{ color: uiConfig.colors.gray700 }}
      >
        {node.grantedDate && (
          <>
            <dt style={{ color: uiConfig.colors.gray600 }}>Granted</dt>
            <dd>{formatDate(node.grantedDate)}</dd>
          </>
        )}
        {node.grantedBy && (
          <>
            <dt style={{ color: uiConfig.colors.gray600 }}>By</dt>
            <dd className="font-mono break-all">{node.grantedBy}</dd>
          </>
        )}
        {node.ruleExpression && (
          <>
            <dt style={{ color: uiConfig.colors.gray600 }}>Expression</dt>
            <dd
              className="font-mono break-all"
              style={{ color: uiConfig.colors.gray900 }}
            >
              {node.ruleExpression}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

function nodeIcon(nodeType: NodeType): string {
  switch (nodeType) {
    case 'user':
      return '👤';
    case 'group':
      return '👥';
    case 'rule':
      return '⚙️';
    case 'role':
      return '🛡️';
    case 'app':
      return '📱';
    case 'entitlement':
      return '🔑';
    default:
      return '•';
  }
}

function nodeBackground(nodeType: NodeType): string {
  switch (nodeType) {
    case 'user':
      return '#eff6ff';
    case 'group':
      return '#ecfeff';
    case 'rule':
      return '#fef3c7';
    case 'role':
      return '#fae8ff';
    case 'app':
      return '#f0fdf4';
    case 'entitlement':
      return '#fff7ed';
    default:
      return 'white';
  }
}

function pathTypeBadge(pathType: PathType): {
  label: string;
  bg: string;
  fg: string;
} {
  switch (pathType) {
    case 'direct':
      return { label: 'Direct', bg: '#dbeafe', fg: '#1e40af' };
    case 'group_membership':
      return { label: 'Group membership', bg: '#cffafe', fg: '#155e75' };
    case 'group_rule':
      return { label: 'Group rule', bg: '#fef3c7', fg: '#92400e' };
    case 'role_assignment':
      return { label: 'Role assignment', bg: '#fae8ff', fg: '#6b21a8' };
    default:
      return {
        label: pathType,
        bg: uiConfig.colors.gray100,
        fg: uiConfig.colors.gray700,
      };
  }
}

function formatDate(iso: string): string {
  const idx = iso.indexOf('T');
  return idx === -1 ? iso : iso.slice(0, idx);
}
