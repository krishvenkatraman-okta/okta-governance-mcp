/**
 * ExecutionTracePanel Component
 *
 * Live execution trace panel for hackathon demo
 * Shows the full governed execution flow with timestamps
 */

'use client';

import { uiConfig } from '@/lib/ui-config';

interface TokenState {
  authenticated: boolean;
  hasIdToken: boolean;
  hasIdJag: boolean;
  hasMcpAccessToken: boolean;
  userId?: string;
  userEmail?: string;
}

interface AuthorizationMetadata {
  resolvedRole: string;
  capabilitiesCount: number;
  targetAppsCount: number;
  scopeSummary: string;
}

interface ExecutionTracePanelProps {
  tokenState: TokenState;
  authorization: AuthorizationMetadata | null;
  bootstrapState: 'idle' | 'exchanging_id_jag' | 'exchanging_mcp_token' | 'ready' | 'error';
  bootstrapError: string | null;
}

interface TraceStep {
  id: string;
  label: string;
  status: 'pending' | 'in_progress' | 'success' | 'error' | 'skipped';
  detail?: string;
}

export default function ExecutionTracePanel({
  tokenState,
  authorization,
  bootstrapState,
  bootstrapError,
}: ExecutionTracePanelProps) {
  // Determine trace steps based on current state
  const getTraceSteps = (): TraceStep[] => {
    const steps: TraceStep[] = [];

    // Step 1: Authentication
    steps.push({
      id: 'auth',
      label: 'Authentication',
      status: tokenState.authenticated ? 'success' : 'pending',
      detail: tokenState.authenticated
        ? `${tokenState.userEmail || tokenState.userId}`
        : 'Waiting for login',
    });

    // Step 2: ID-JAG Exchange
    if (tokenState.authenticated) {
      const idJagStatus =
        bootstrapState === 'exchanging_id_jag'
          ? 'in_progress'
          : tokenState.hasIdJag || tokenState.hasMcpAccessToken
          ? 'success'
          : bootstrapState === 'error'
          ? 'error'
          : 'pending';

      steps.push({
        id: 'id_jag',
        label: 'ID-JAG Exchange',
        status: idJagStatus,
        detail:
          idJagStatus === 'success'
            ? 'JWT-based authorization token acquired'
            : idJagStatus === 'in_progress'
            ? 'Exchanging ID Token for ID-JAG...'
            : idJagStatus === 'error'
            ? 'Exchange failed'
            : 'Pending',
      });
    }

    // Step 3: MCP Token Exchange
    if (tokenState.authenticated && (tokenState.hasIdJag || tokenState.hasMcpAccessToken)) {
      const mcpStatus =
        bootstrapState === 'exchanging_mcp_token'
          ? 'in_progress'
          : tokenState.hasMcpAccessToken
          ? 'success'
          : bootstrapState === 'error'
          ? 'error'
          : 'pending';

      steps.push({
        id: 'mcp_token',
        label: 'MCP Access Token Exchange',
        status: mcpStatus,
        detail:
          mcpStatus === 'success'
            ? 'MCP session token ready'
            : mcpStatus === 'in_progress'
            ? 'Exchanging ID-JAG for MCP token...'
            : mcpStatus === 'error'
            ? 'Exchange failed'
            : 'Pending',
      });
    }

    // Step 4: Governed Session Ready
    if (tokenState.hasMcpAccessToken) {
      steps.push({
        id: 'session_ready',
        label: 'Governed Session Ready',
        status: 'success',
        detail: authorization
          ? `${authorization.resolvedRole.replace(/_/g, ' ')} • ${authorization.scopeSummary}`
          : 'Ready for tool execution',
      });
    }

    return steps;
  };

  const traceSteps = getTraceSteps();

  const getStatusBadge = (status: TraceStep['status']) => {
    switch (status) {
      case 'success':
        return (
          <div
            className="flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded"
            style={{
              backgroundColor: '#f0fdf4',
              color: uiConfig.colors.success,
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: uiConfig.colors.success }} />
            SUCCESS
          </div>
        );
      case 'in_progress':
        return (
          <div
            className="flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded"
            style={{
              backgroundColor: '#eff6ff',
              color: '#2563eb',
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: '#2563eb' }} />
            IN PROGRESS
          </div>
        );
      case 'error':
        return (
          <div
            className="flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded"
            style={{
              backgroundColor: '#fef2f2',
              color: uiConfig.colors.error,
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: uiConfig.colors.error }} />
            ERROR
          </div>
        );
      case 'pending':
        return (
          <div
            className="flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded"
            style={{
              backgroundColor: uiConfig.colors.gray100,
              color: uiConfig.colors.gray600,
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: uiConfig.colors.gray300 }} />
            PENDING
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: uiConfig.colors.gray50 }}>
      {/* Header */}
      <div className="p-4 border-b" style={{ borderColor: uiConfig.colors.gray200 }}>
        <h2 className="text-sm font-bold tracking-wide" style={{ color: uiConfig.colors.gray900 }}>
          EXECUTION TRACE
        </h2>
        <p className="text-xs mt-1" style={{ color: uiConfig.colors.gray600 }}>
          Live system status
        </p>
      </div>

      {/* Trace Steps */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {traceSteps.map((step, index) => (
          <div
            key={step.id}
            className="bg-white rounded-lg p-3 border"
            style={{ borderColor: uiConfig.colors.gray200 }}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <span
                  className="text-xs font-bold"
                  style={{
                    color: uiConfig.colors.gray600,
                  }}
                >
                  {index + 1}
                </span>
                <span className="text-sm font-semibold" style={{ color: uiConfig.colors.gray900 }}>
                  {step.label}
                </span>
              </div>
              {getStatusBadge(step.status)}
            </div>

            {step.detail && (
              <p
                className="text-xs pl-5"
                style={{
                  color: uiConfig.colors.gray600,
                }}
              >
                {step.detail}
              </p>
            )}
          </div>
        ))}

        {/* Error Details */}
        {bootstrapState === 'error' && bootstrapError && (
          <div
            className="rounded-lg p-3 border text-xs"
            style={{
              backgroundColor: '#fef2f2',
              borderColor: '#fecaca',
              color: uiConfig.colors.error,
            }}
          >
            <p className="font-semibold mb-1">Bootstrap Error</p>
            <p>{bootstrapError}</p>
          </div>
        )}

        {/* Authorization Context */}
        {authorization && tokenState.hasMcpAccessToken && (
          <div
            className="rounded-lg p-3 border"
            style={{
              backgroundColor: '#fefce8',
              borderColor: '#fef08a',
            }}
          >
            <p className="text-xs font-semibold mb-2" style={{ color: '#854d0e' }}>
              Authorization Context
            </p>
            <div className="space-y-1 text-xs" style={{ color: '#a16207' }}>
              <div className="flex justify-between">
                <span>Role:</span>
                <span className="font-semibold">{authorization.resolvedRole.replace(/_/g, ' ')}</span>
              </div>
              <div className="flex justify-between">
                <span>Capabilities:</span>
                <span className="font-semibold">{authorization.capabilitiesCount}</span>
              </div>
              <div className="flex justify-between">
                <span>Target Apps:</span>
                <span className="font-semibold">{authorization.targetAppsCount}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer with timestamp */}
      <div
        className="p-3 border-t text-xs"
        style={{
          borderColor: uiConfig.colors.gray200,
          color: uiConfig.colors.gray600,
        }}
      >
        Last updated: {new Date().toLocaleTimeString()}
      </div>
    </div>
  );
}
