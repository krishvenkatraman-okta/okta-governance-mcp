/**
 * DebugDrawer Component
 *
 * Collapsible drawer for debug information (token state, actions, tools)
 * Hidden by default for hackathon demo, accessible via toggle
 */

'use client';

import { useState } from 'react';
import { uiConfig } from '@/lib/ui-config';

interface Tool {
  name: string;
  description: string;
  inputSchema?: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface TokenState {
  authenticated: boolean;
  hasIdToken: boolean;
  hasIdJag: boolean;
  hasMcpAccessToken: boolean;
  userId?: string;
  userEmail?: string;
}

interface DebugDrawerProps {
  tokenState: TokenState;
  tools: Tool[];
  loading: Record<string, boolean>;
  onExecuteTool: (toolName: string, args: Record<string, unknown>) => void;
  onFetchTools: () => void;
  onCheckTokens: () => void;
}

function TokenStatusRow({ label, hasToken }: { label: string; hasToken: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: uiConfig.colors.gray600 }}>{label}</span>
      <span
        className="flex items-center gap-2"
        style={{
          color: hasToken ? uiConfig.colors.success : uiConfig.colors.gray400,
        }}
      >
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: hasToken ? uiConfig.colors.success : uiConfig.colors.gray300 }} />
        {hasToken ? 'Present' : 'Removed / Not available'}
      </span>
    </div>
  );
}

export default function DebugDrawer({
  tokenState,
  tools,
  loading,
  onExecuteTool,
  onFetchTools,
  onCheckTokens,
}: DebugDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 px-4 py-2 rounded-lg shadow-lg text-sm font-medium"
        style={{
          backgroundColor: uiConfig.colors.gray800,
          color: 'white',
        }}
      >
        🔧 Debug
      </button>
    );
  }

  return (
    <div
      className="fixed inset-y-0 right-0 w-[600px] bg-white shadow-2xl overflow-y-auto z-50"
      style={{ borderLeft: `2px solid ${uiConfig.colors.gray200}` }}
    >
      {/* Header */}
      <div
        className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between z-10"
        style={{ borderColor: uiConfig.colors.gray200 }}
      >
        <h2 className="text-lg font-semibold" style={{ color: uiConfig.colors.gray900 }}>
          Debug Information
        </h2>
        <button
          onClick={() => setIsOpen(false)}
          className="px-3 py-1 rounded text-sm"
          style={{
            backgroundColor: uiConfig.colors.gray100,
            color: uiConfig.colors.gray600,
          }}
        >
          Close
        </button>
      </div>

      {/* Content */}
      <div className="p-6 space-y-6">
        {/* Token State Card */}
        <div className="rounded-lg border p-4" style={{ borderColor: uiConfig.colors.gray200 }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: uiConfig.colors.gray900 }}>
            Token State
          </h3>
          <div className="space-y-2 text-sm">
            <TokenStatusRow label="ID Token (removed after ID-JAG)" hasToken={tokenState.hasIdToken} />
            <TokenStatusRow label="ID-JAG (removed after MCP token)" hasToken={tokenState.hasIdJag} />
            <TokenStatusRow label="MCP Access Token (final)" hasToken={tokenState.hasMcpAccessToken} />
          </div>
          <div
            className="mt-3 pt-3 border-t text-xs"
            style={{
              borderColor: uiConfig.colors.gray200,
              color: uiConfig.colors.gray600,
            }}
          >
            <strong>Note:</strong> Tokens are progressively removed after each exchange.
          </div>
        </div>

        {/* Actions Card */}
        <div className="rounded-lg border p-4" style={{ borderColor: uiConfig.colors.gray200 }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: uiConfig.colors.gray900 }}>
            Debug Actions
          </h3>
          <div className="space-y-2">
            <button
              onClick={onCheckTokens}
              disabled={loading.checkTokens}
              className="w-full px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
              style={{
                backgroundColor: uiConfig.colors.gray100,
                color: uiConfig.colors.gray900,
              }}
            >
              {loading.checkTokens ? 'Checking...' : 'Check Token State'}
            </button>

            <button
              onClick={onFetchTools}
              disabled={loading.tools || !tokenState.hasMcpAccessToken}
              className="w-full px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
              style={{
                backgroundColor: uiConfig.colors.primary,
                color: 'white',
              }}
            >
              {loading.tools ? 'Loading Tools...' : 'Fetch MCP Tools'}
            </button>
          </div>
        </div>

        {/* Tools Display */}
        {tools.length > 0 && (
          <div className="rounded-lg border p-4" style={{ borderColor: uiConfig.colors.gray200 }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: uiConfig.colors.gray900 }}>
              Available Tools ({tools.length})
            </h3>
            <div className="space-y-3">
              {tools.map((tool) => (
                <div
                  key={tool.name}
                  className="rounded border p-3"
                  style={{ borderColor: uiConfig.colors.gray200 }}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h4 className="font-mono text-xs font-semibold" style={{ color: uiConfig.colors.gray900 }}>
                        {tool.name}
                      </h4>
                      <p className="text-xs mt-1" style={{ color: uiConfig.colors.gray600 }}>
                        {tool.description}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => onExecuteTool(tool.name, {})}
                    disabled={loading[tool.name]}
                    className="mt-2 px-3 py-1 rounded text-xs font-medium disabled:opacity-50"
                    style={{
                      backgroundColor: uiConfig.colors.gray100,
                      color: uiConfig.colors.gray900,
                    }}
                  >
                    {loading[tool.name] ? 'Executing...' : 'Execute'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
