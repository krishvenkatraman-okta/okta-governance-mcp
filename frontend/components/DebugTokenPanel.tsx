/**
 * DebugTokenPanel Component
 *
 * LOCAL DEBUG ONLY - Shows token information for development
 *
 * SECURITY WARNING:
 * - Only use in local development
 * - Never enable DEBUG_EXPOSE_TOKENS in production
 * - Raw tokens only shown if debug flag is enabled
 */

'use client';

import { useState, useEffect } from 'react';
import { uiConfig } from '@/lib/ui-config';

interface TokenInfo {
  raw?: string;
  decoded: any;
}

interface DebugResponse {
  debugMode: boolean;
  warning: string;
  hasIdToken: boolean;
  hasIdJag: boolean;
  hasMcpAccessToken: boolean;
  tokens: {
    idToken?: TokenInfo;
    idJag?: TokenInfo;
    mcpAccessToken?: TokenInfo;
  };
}

export default function DebugTokenPanel() {
  const [debugData, setDebugData] = useState<DebugResponse | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchDebugData();
  }, []);

  const fetchDebugData = async () => {
    try {
      const response = await fetch('/api/debug/session-tokens');
      if (response.ok) {
        const data = await response.json();
        setDebugData(data);
      }
    } catch (error) {
      console.error('Failed to fetch debug data:', error);
    }
  };

  const toggleReveal = (tokenType: string) => {
    setRevealed({
      ...revealed,
      [tokenType]: !revealed[tokenType],
    });
  };

  const copyToClipboard = async (tokenType: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied({ ...copied, [tokenType]: true });
      setTimeout(() => {
        setCopied({ ...copied, [tokenType]: false });
      }, 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  if (!debugData) {
    return (
      <div className="bg-gray-900 text-white p-4 rounded-lg">
        <p>Loading debug data...</p>
      </div>
    );
  }

  const renderTokenSection = (
    title: string,
    tokenKey: string,
    tokenInfo?: TokenInfo
  ) => {
    if (!tokenInfo) {
      return (
        <div key={tokenKey} className="border-t border-gray-700 pt-4 mt-4">
          <h3 className="font-semibold text-sm mb-2">{title}</h3>
          <p className="text-xs text-gray-400">Not available</p>
        </div>
      );
    }

    const isRevealed = revealed[tokenKey];
    const isCopied = copied[tokenKey];
    const hasRawToken = !!tokenInfo.raw;

    return (
      <div key={tokenKey} className="border-t border-gray-700 pt-4 mt-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm">{title}</h3>
          <div className="flex gap-2">
            {hasRawToken && (
              <>
                <button
                  onClick={() => toggleReveal(tokenKey)}
                  className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded"
                >
                  {isRevealed ? 'Hide' : 'Reveal'}
                </button>
                <button
                  onClick={() => copyToClipboard(tokenKey, tokenInfo.raw!)}
                  className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded"
                >
                  {isCopied ? 'Copied!' : 'Copy'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Raw Token */}
        {hasRawToken && (
          <div className="mb-3">
            <p className="text-xs text-gray-400 mb-1">Raw Token:</p>
            <div className="bg-black p-2 rounded text-xs font-mono overflow-x-auto">
              {isRevealed ? (
                <pre className="whitespace-pre-wrap break-all">
                  {tokenInfo.raw}
                </pre>
              ) : (
                <span className="text-gray-500">
                  ••••••••••••••••••••••••••••••••
                </span>
              )}
            </div>
          </div>
        )}

        {/* Decoded Payload */}
        <div>
          <p className="text-xs text-gray-400 mb-1">Decoded Payload:</p>
          <div className="bg-black p-2 rounded text-xs font-mono overflow-x-auto max-h-60">
            <pre>{JSON.stringify(tokenInfo.decoded, null, 2)}</pre>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-gray-900 text-white p-6 rounded-lg shadow-lg">
      {/* Warning Banner */}
      <div className="bg-red-900 border border-red-700 rounded-lg p-3 mb-4">
        <p className="font-bold text-sm">⚠️ Local Debug Only — Tokens Visible</p>
        <p className="text-xs mt-1">{debugData.warning}</p>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">Debug Token Panel</h2>
        <button
          onClick={fetchDebugData}
          className="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded"
        >
          Refresh
        </button>
      </div>

      {/* Debug Mode Status */}
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              debugData.debugMode ? 'bg-yellow-500' : 'bg-gray-500'
            }`}
          />
          <span className="text-sm">
            {debugData.debugMode
              ? 'Debug mode: ENABLED (raw tokens exposed)'
              : 'Debug mode: DISABLED (raw tokens hidden)'}
          </span>
        </div>
      </div>

      {/* Token Sections */}
      {renderTokenSection('ID Token', 'idToken', debugData.tokens.idToken)}
      {renderTokenSection('ID-JAG', 'idJag', debugData.tokens.idJag)}
      {renderTokenSection(
        'MCP Access Token',
        'mcpAccessToken',
        debugData.tokens.mcpAccessToken
      )}

      {/* Footer Note */}
      <div className="mt-4 pt-4 border-t border-gray-700">
        <p className="text-xs text-gray-400">
          Set <code className="bg-black px-1 py-0.5 rounded">DEBUG_EXPOSE_TOKENS=true</code> in
          .env.local to reveal raw tokens
        </p>
      </div>
    </div>
  );
}
