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
import ExecutionTracePanel from '@/components/ExecutionTracePanel';
import DebugDrawer from '@/components/DebugDrawer';
import ToolExplorer from '@/components/ToolExplorer';
import GovernanceChecks from '@/components/GovernanceChecks';
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
  const [bootstrapState, setBootstrapState] = useState<
    'idle' | 'exchanging_id_jag' | 'exchanging_mcp_token' | 'ready' | 'error'
  >('idle');
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [showToolExplorer, setShowToolExplorer] = useState(false);
  const [showGovernanceChecks, setShowGovernanceChecks] = useState(false);

  // Check token state on mount
  useEffect(() => {
    checkTokenState();
  }, []);


  // Auto-bootstrap governed session after authentication
  useEffect(() => {
    if (tokenState.authenticated && bootstrapState === 'idle') {
      bootstrapGovernedSession();
    }
  }, [tokenState.authenticated, bootstrapState]);

  // Check for governance items after bootstrap completes
  useEffect(() => {
    if (bootstrapState === 'ready') {
      const governanceChecked = sessionStorage.getItem('governanceChecked');
      console.log('[Bootstrap] governanceChecked flag:', governanceChecked);
      if (!governanceChecked) {
        console.log('[Bootstrap] Setting showGovernanceChecks to true');
        setShowGovernanceChecks(true);
      }
    }
  }, [bootstrapState]);

  /**
   * Bootstrap governed session automatically
   * Exchanges tokens progressively until MCP access token is available
   */
  const bootstrapGovernedSession = async () => {
    try {
      console.log('[Bootstrap] Starting governed session bootstrap');

      // Already have MCP access token - done
      if (tokenState.hasMcpAccessToken) {
        console.log('[Bootstrap] MCP access token already available');
        setBootstrapState('ready');
        console.log('[Bootstrap] Governed session ready');
        return;
      }

      // Step 1: Get ID-JAG if needed
      if (!tokenState.hasIdJag) {
        console.log('[Bootstrap] Need ID-JAG, exchanging...');
        setBootstrapState('exchanging_id_jag');

        const idJagResponse = await fetch('/api/token/id-jag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });

        if (!idJagResponse.ok) {
          const data = await idJagResponse.json();
          throw new Error(data.message || 'Failed to get ID-JAG');
        }

        console.log('[Bootstrap] ID-JAG obtained');

        // Refresh token state to pick up ID-JAG
        await checkTokenState();
      }

      // Step 2: Get MCP access token
      console.log('[Bootstrap] Need MCP access token, exchanging...');
      setBootstrapState('exchanging_mcp_token');

      const mcpResponse = await fetch('/api/token/access-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!mcpResponse.ok) {
        const data = await mcpResponse.json();
        throw new Error(data.message || 'Failed to get MCP access token');
      }

      console.log('[Bootstrap] MCP access token obtained');

      // Refresh token state
      await checkTokenState();

      // Success
      setBootstrapState('ready');
      console.log('[Bootstrap] Governed session ready');
    } catch (err) {
      console.error('[Bootstrap] Error:', err);
      setBootstrapState('error');
      setBootstrapError(err instanceof Error ? err.message : 'Bootstrap failed');
    }
  };

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

  // If not authenticated, show login prompt
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen" style={{ background: uiConfig.colors.gray50 }}>
        <AgentHeader />
        <main className="max-w-4xl mx-auto px-6 py-16 text-center">
          <div className="bg-white rounded-lg shadow-lg p-12">
            <h1 className="text-3xl font-bold mb-4" style={{ color: uiConfig.colors.gray900 }}>
              Okta Governance Console
            </h1>
            <p className="text-lg mb-8" style={{ color: uiConfig.colors.gray600 }}>
              Chat-powered governance operations with governed execution
            </p>
            <a
              href="/api/auth/start"
              className="inline-block px-6 py-3 rounded-lg font-semibold text-white"
              style={{ backgroundColor: uiConfig.colors.primary }}
            >
              Sign in with Okta
            </a>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col" style={{ background: uiConfig.colors.gray50 }}>
      {/* Branded Header */}
      <AgentHeader />

      {/* Main Content: Chat-First Layout */}
      <main className="flex-1 flex overflow-hidden">
        {/* Chat Interface - Primary */}
        <div className="flex-1 flex flex-col">
          <ChatInterface />
        </div>

        {/* Execution Trace Panel - Right Side */}
        <div className="w-96 border-l" style={{ borderColor: uiConfig.colors.gray200 }}>
          <ExecutionTracePanel
            tokenState={tokenState}
            authorization={authorization}
            bootstrapState={bootstrapState}
            bootstrapError={bootstrapError}
          />
        </div>
      </main>

      {/* Debug Drawer - Collapsible */}
      <DebugDrawer
        tokenState={tokenState}
        tools={tools}
        loading={loading}
        onExecuteTool={handleExecuteTool}
        onFetchTools={handleListMcpTools}
        onCheckTokens={checkTokenState}
      />

      {/* Tool Explorer Button - Floating */}
      <button
        onClick={() => setShowToolExplorer(true)}
        className="fixed bottom-20 right-4 px-4 py-3 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2"
        style={{
          backgroundColor: uiConfig.colors.primary,
          color: 'white',
        }}
      >
        📚 Browse Tools
      </button>

      {/* Tool Explorer Modal */}
      {showToolExplorer && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="max-w-6xl w-full">
            <ToolExplorer onClose={() => setShowToolExplorer(false)} />
          </div>
        </div>
      )}

      {/* Governance Checks Modal */}
      {showGovernanceChecks && (
        <GovernanceChecks onDismiss={() => setShowGovernanceChecks(false)} />
      )}
    </div>
  );
}

// Token Status Row Component (used by DebugDrawer)
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
