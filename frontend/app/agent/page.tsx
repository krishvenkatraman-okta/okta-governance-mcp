/**
 * Agent Page
 *
 * Main interface for Okta AI Governance Console
 * - Login status tracking
 * - Token state management
 * - MCP tool interaction
 */

'use client';

import { useState, useEffect } from 'react';
import AgentHeader from '@/components/AgentHeader';
import DebugTokenPanel from '@/components/DebugTokenPanel';
import ChatInterface from '@/components/ChatInterface';
import { uiConfig } from '@/lib/ui-config';

interface TokenState {
  authenticated: boolean;
  hasIdToken: boolean;
  hasIdJag: boolean;
  hasMcpAccessToken: boolean;
  userId?: string;
  userEmail?: string;
}

interface Tool {
  name: string;
  description: string;
  inputSchema?: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface AuthorizationMetadata {
  resolvedRole: string;
  capabilitiesCount: number;
  targetAppsCount: number;
  targetGroupsCount?: number;
  scopeSummary: string;
}

export default function AgentPage() {
  const [tokenState, setTokenState] = useState<TokenState>({
    authenticated: false,
    hasIdToken: false,
    hasIdJag: false,
    hasMcpAccessToken: false,
  });
  const [tools, setTools] = useState<Tool[]>([]);
  const [authorization, setAuthorization] = useState<AuthorizationMetadata | null>(null);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [toolResult, setToolResult] = useState<{
    toolName: string;
    content: string;
    isError: boolean;
  } | null>(null);

  // Check token state on mount
  useEffect(() => {
    checkTokenState();
  }, []);

  const checkTokenState = async () => {
    try {
      const response = await fetch('/api/auth/session');

      if (!response.ok) {
        throw new Error('Failed to fetch session status');
      }

      const data = await response.json();

      setTokenState({
        authenticated: data.authenticated,
        hasIdToken: data.hasIdToken,
        hasIdJag: data.hasIdJag,
        hasMcpAccessToken: data.hasMcpAccessToken,
        userId: data.userId,
        userEmail: data.userEmail,
      });
    } catch (err) {
      console.error('Failed to check token state:', err);
      // Set to unauthenticated state on error
      setTokenState({
        authenticated: false,
        hasIdToken: false,
        hasIdJag: false,
        hasMcpAccessToken: false,
      });
    }
  };

  const handleLogin = () => {
    // Redirect to auth start endpoint
    window.location.href = '/api/auth/start';
  };

  const handleLogout = () => {
    // Redirect to logout endpoint
    window.location.href = '/api/auth/logout';
  };

  const handleGetIdJag = async () => {
    setLoading({ ...loading, idJag: true });
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/token/id-jag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to get ID-JAG');
      }

      const data = await response.json();
      setSuccess('ID-JAG obtained successfully');

      // Refresh token state
      await checkTokenState();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading({ ...loading, idJag: false });
    }
  };

  const handleGetMcpAccessToken = async () => {
    setLoading({ ...loading, mcpAccessToken: true });
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/token/access-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to get MCP access token');
      }

      const data = await response.json();
      setSuccess('MCP access token obtained successfully');

      // Refresh token state
      await checkTokenState();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading({ ...loading, mcpAccessToken: false });
    }
  };

  const handleListMcpTools = async () => {
    setLoading({ ...loading, tools: true });
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/mcp/tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to fetch MCP tools');
      }

      const data = await response.json();

      // Debug: Log what we received from API route (safe - no tokens)
      console.log('[Agent Page] Received from API:', JSON.stringify({
        success: data.success,
        count: data.count,
        hasAuthorization: !!data.authorization,
        authorization: data.authorization,
      }, null, 2));

      setTools(data.tools || []);
      setAuthorization(data.authorization || null);
      setSuccess(`Successfully loaded ${data.count} MCP tools`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading({ ...loading, tools: false });
    }
  };

  const handleExecuteTool = async (toolName: string, toolArgs: Record<string, unknown> = {}) => {
    setLoading({ ...loading, [toolName]: true });
    setError(null);
    setSuccess(null);
    setToolResult(null);

    try {
      console.log('[Agent Page] Executing tool:', { toolName, args: toolArgs });

      const response = await fetch('/api/mcp/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName,
          arguments: toolArgs,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to execute tool');
      }

      const data = await response.json();

      console.log('[Agent Page] Tool execution result:', {
        success: data.success,
        isError: data.result?.isError,
        contentCount: data.result?.content?.length,
      });

      if (data.result) {
        // Extract text content from result
        const textContent = data.result.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('\n');

        setToolResult({
          toolName,
          content: textContent,
          isError: data.result.isError || false,
        });

        if (!data.result.isError) {
          setSuccess(`Tool '${toolName}' executed successfully`);
        } else {
          setError(`Tool '${toolName}' returned an error`);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading({ ...loading, [toolName]: false });
    }
  };

  // User is authenticated if they have a valid session with userId
  // (not based on individual tokens, which may be removed after progressive cleanup)
  const isAuthenticated = tokenState.authenticated;

  return (
    <div className="min-h-screen" style={{ background: uiConfig.colors.gray50 }}>
      {/* Branded Header */}
      <AgentHeader />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Alert Messages */}
        {error && (
          <div
            className="rounded-lg p-4 mb-6 border"
            style={{
              backgroundColor: '#fef2f2',
              borderColor: '#fecaca',
              color: uiConfig.colors.error,
            }}
          >
            <p className="font-semibold">Error</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        )}

        {success && (
          <div
            className="rounded-lg p-4 mb-6 border"
            style={{
              backgroundColor: '#f0fdf4',
              borderColor: '#bbf7d0',
              color: uiConfig.colors.success,
            }}
          >
            <p className="font-semibold">Success</p>
            <p className="text-sm mt-1">{success}</p>
          </div>
        )}

        {/* Login State Card */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2
            className="text-xl font-semibold mb-4"
            style={{ color: uiConfig.colors.gray900 }}
          >
            Login Status
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span style={{ color: uiConfig.colors.gray600 }}>
                Authentication:
              </span>
              <span
                className="font-semibold flex items-center gap-2"
                style={{
                  color: isAuthenticated
                    ? uiConfig.colors.success
                    : uiConfig.colors.gray600,
                }}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{
                    backgroundColor: isAuthenticated
                      ? uiConfig.colors.success
                      : uiConfig.colors.gray300,
                  }}
                />
                {isAuthenticated ? 'Authenticated' : 'Not authenticated'}
              </span>
            </div>

            {tokenState.userId && (
              <div className="flex items-center justify-between">
                <span style={{ color: uiConfig.colors.gray600 }}>User ID:</span>
                <span
                  className="font-mono text-sm"
                  style={{ color: uiConfig.colors.gray900 }}
                >
                  {tokenState.userId}
                </span>
              </div>
            )}

            {tokenState.userEmail && (
              <div className="flex items-center justify-between">
                <span style={{ color: uiConfig.colors.gray600 }}>Email:</span>
                <span
                  className="text-sm"
                  style={{ color: uiConfig.colors.gray900 }}
                >
                  {tokenState.userEmail}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Token State Card */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2
            className="text-xl font-semibold mb-4"
            style={{ color: uiConfig.colors.gray900 }}
          >
            Token State
          </h2>
          <div className="space-y-3">
            <TokenStatusRow
              label="ID Token (removed after ID-JAG)"
              hasToken={tokenState.hasIdToken}
            />
            <TokenStatusRow
              label="ID-JAG (removed after MCP token)"
              hasToken={tokenState.hasIdJag}
            />
            <TokenStatusRow
              label="MCP Access Token (final)"
              hasToken={tokenState.hasMcpAccessToken}
            />
          </div>

          {/* Progressive Cleanup Note */}
          <div
            className="mt-4 pt-4 border-t text-xs"
            style={{
              borderColor: uiConfig.colors.gray200,
              color: uiConfig.colors.gray600,
            }}
          >
            <p className="leading-relaxed">
              <strong>Note:</strong> Tokens are progressively removed after each exchange
              to keep the session cookie size small. ID Token is removed after ID-JAG exchange,
              and ID-JAG is removed after MCP access token exchange. Missing earlier tokens
              is expected behavior.
            </p>
          </div>
        </div>

        {/* Authorization Context Card */}
        {authorization && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h2
              className="text-xl font-semibold mb-4"
              style={{ color: uiConfig.colors.gray900 }}
            >
              Authorization Context
            </h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span style={{ color: uiConfig.colors.gray600 }}>
                  Resolved Role:
                </span>
                <span
                  className="font-semibold px-3 py-1 rounded-full text-sm"
                  style={{
                    backgroundColor: authorization.resolvedRole === 'SUPER_ADMIN'
                      ? '#fef3c7'
                      : authorization.resolvedRole === 'ORG_ADMIN'
                      ? '#dbeafe'
                      : '#e5e7eb',
                    color: authorization.resolvedRole === 'SUPER_ADMIN'
                      ? '#92400e'
                      : authorization.resolvedRole === 'ORG_ADMIN'
                      ? '#1e40af'
                      : uiConfig.colors.gray900,
                  }}
                >
                  {authorization.resolvedRole.replace(/_/g, ' ')}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span style={{ color: uiConfig.colors.gray600 }}>
                  Access Scope:
                </span>
                <span
                  className="font-semibold"
                  style={{ color: uiConfig.colors.gray900 }}
                >
                  {authorization.scopeSummary}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span style={{ color: uiConfig.colors.gray600 }}>
                  Capabilities:
                </span>
                <span
                  className="font-semibold"
                  style={{ color: uiConfig.colors.gray900 }}
                >
                  {authorization.capabilitiesCount}
                </span>
              </div>

              {authorization.targetAppsCount > 0 && (
                <div className="flex items-center justify-between">
                  <span style={{ color: uiConfig.colors.gray600 }}>
                    Manageable Apps:
                  </span>
                  <span
                    className="font-semibold"
                    style={{ color: uiConfig.colors.gray900 }}
                  >
                    {authorization.targetAppsCount}
                  </span>
                </div>
              )}

              {authorization.targetGroupsCount && authorization.targetGroupsCount > 0 && (
                <div className="flex items-center justify-between">
                  <span style={{ color: uiConfig.colors.gray600 }}>
                    Manageable Groups:
                  </span>
                  <span
                    className="font-semibold"
                    style={{ color: uiConfig.colors.gray900 }}
                  >
                    {authorization.targetGroupsCount}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Actions Card */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2
            className="text-xl font-semibold mb-4"
            style={{ color: uiConfig.colors.gray900 }}
          >
            Actions
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Login Button */}
            <ActionButton
              onClick={handleLogin}
              disabled={isAuthenticated}
              loading={false}
              label="Login with Okta"
              description="Authenticate via Okta OIDC"
              variant="primary"
            />

            {/* Logout Button */}
            <ActionButton
              onClick={handleLogout}
              disabled={!isAuthenticated}
              loading={false}
              label="Logout"
              description="Clear session and logout"
              variant="secondary"
            />

            {/* Get ID-JAG Button */}
            <ActionButton
              onClick={handleGetIdJag}
              disabled={!tokenState.hasIdToken || tokenState.hasIdJag}
              loading={loading.idJag}
              label="Get ID-JAG"
              description="Exchange ID token for ID-JAG"
              variant="secondary"
            />

            {/* Get MCP Access Token Button */}
            <ActionButton
              onClick={handleGetMcpAccessToken}
              disabled={!tokenState.hasIdJag || tokenState.hasMcpAccessToken}
              loading={loading.mcpAccessToken}
              label="Get MCP Access Token"
              description="Exchange ID-JAG for access token"
              variant="secondary"
            />

            {/* List MCP Tools Button */}
            <ActionButton
              onClick={handleListMcpTools}
              disabled={!tokenState.hasMcpAccessToken}
              loading={loading.tools}
              label="List MCP Tools"
              description="Fetch available governance tools"
              variant="accent"
            />

            {/* Open Chat Assistant Button */}
            <ActionButton
              onClick={() => setShowChat(!showChat)}
              disabled={!tokenState.hasMcpAccessToken}
              loading={false}
              label={showChat ? 'Close Chat Assistant' : 'Open Chat Assistant'}
              description="Chat with AI governance assistant"
              variant="primary"
            />
          </div>
        </div>

        {/* Chat Interface */}
        {showChat && (
          <div className="mb-6">
            <ChatInterface onClose={() => setShowChat(false)} />
          </div>
        )}

        {/* Tools Display */}
        {tools.length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h2
              className="text-xl font-semibold mb-4"
              style={{ color: uiConfig.colors.gray900 }}
            >
              Available Governance Tools
            </h2>
            <p className="text-sm mb-4" style={{ color: uiConfig.colors.gray600 }}>
              Tools available for your current authorization context
            </p>
            <div className="space-y-3">
              {tools.map((tool) => (
                <div
                  key={tool.name}
                  className="border rounded-lg p-4"
                  style={{ borderColor: uiConfig.colors.gray200 }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3
                        className="font-semibold mb-1"
                        style={{ color: uiConfig.colors.gray900 }}
                      >
                        {tool.name}
                      </h3>
                      <p className="text-sm" style={{ color: uiConfig.colors.gray600 }}>
                        {tool.description}
                      </p>
                    </div>
                    {/* Show Run button for list_manageable_apps */}
                    {tool.name === 'list_manageable_apps' && (
                      <button
                        onClick={() => handleExecuteTool(tool.name)}
                        disabled={loading[tool.name]}
                        className="ml-4 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
                        style={{
                          backgroundColor: loading[tool.name]
                            ? uiConfig.colors.gray300
                            : uiConfig.colors.primary,
                          color: 'white',
                          cursor: loading[tool.name] ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {loading[tool.name] ? 'Running...' : 'Run'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tool Execution Result */}
        {toolResult && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2
                className="text-xl font-semibold"
                style={{ color: uiConfig.colors.gray900 }}
              >
                Tool Result: {toolResult.toolName}
              </h2>
              <button
                onClick={() => setToolResult(null)}
                className="text-sm px-3 py-1 rounded"
                style={{
                  backgroundColor: uiConfig.colors.gray200,
                  color: uiConfig.colors.gray900,
                }}
              >
                Clear
              </button>
            </div>
            <div
              className="rounded-lg p-4 font-mono text-sm overflow-auto max-h-96"
              style={{
                backgroundColor: toolResult.isError ? '#fef2f2' : '#f0fdf4',
                border: `1px solid ${toolResult.isError ? '#fecaca' : '#bbf7d0'}`,
                color: toolResult.isError ? uiConfig.colors.error : '#166534',
              }}
            >
              <pre className="whitespace-pre-wrap break-words">
                {toolResult.content}
              </pre>
            </div>
          </div>
        )}

        {/* Debug Panel Toggle */}
        <div className="mb-6">
          <button
            onClick={() => setShowDebugPanel(!showDebugPanel)}
            className="text-sm px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700"
          >
            {showDebugPanel ? 'Hide Debug Panel' : 'Show Debug Panel (Local Only)'}
          </button>
          <p
            className="text-xs mt-2"
            style={{ color: uiConfig.colors.gray600 }}
          >
            Earlier tokens may be removed after exchange to keep the session cookie small.
          </p>
        </div>

        {/* Debug Token Panel */}
        {showDebugPanel && (
          <div className="mb-6">
            <DebugTokenPanel />
          </div>
        )}
      </main>
    </div>
  );
}

// Token Status Row Component
function TokenStatusRow({
  label,
  hasToken,
}: {
  label: string;
  hasToken: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: uiConfig.colors.gray600 }}>{label}:</span>
      <span
        className="font-semibold flex items-center gap-2"
        style={{
          color: hasToken ? uiConfig.colors.success : uiConfig.colors.gray600,
        }}
      >
        <span
          className="w-2 h-2 rounded-full"
          style={{
            backgroundColor: hasToken
              ? uiConfig.colors.success
              : uiConfig.colors.gray300,
          }}
        />
        {hasToken ? 'Available' : 'Not available'}
      </span>
    </div>
  );
}

// Action Button Component
function ActionButton({
  onClick,
  disabled,
  loading,
  label,
  description,
  variant = 'secondary',
}: {
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
  label: string;
  description: string;
  variant?: 'primary' | 'secondary' | 'accent';
}) {
  const getVariantStyles = () => {
    if (disabled) {
      return {
        backgroundColor: uiConfig.colors.gray200,
        color: uiConfig.colors.gray600,
        cursor: 'not-allowed',
      };
    }

    switch (variant) {
      case 'primary':
        return {
          background: uiConfig.gradients.primary,
          color: 'white',
        };
      case 'accent':
        return {
          backgroundColor: uiConfig.colors.primaryLight,
          color: 'white',
        };
      case 'secondary':
      default:
        return {
          backgroundColor: uiConfig.colors.primary,
          color: 'white',
        };
    }
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="text-left p-4 rounded-lg transition-all hover:shadow-lg disabled:hover:shadow-none"
      style={getVariantStyles()}
    >
      <div className="font-semibold mb-1">
        {loading ? 'Loading...' : label}
      </div>
      <div className="text-sm opacity-90">{description}</div>
    </button>
  );
}
