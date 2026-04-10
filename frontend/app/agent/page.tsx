/**
 * Agent page
 *
 * Main interface for:
 * - Displaying login status
 * - Listing available MCP tools
 * - Invoking tools (later)
 */

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Tool {
  name: string;
  description: string;
  inputSchema?: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export default function AgentPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // TODO: Check authentication status on mount
  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = () => {
    // TODO: Check if access token exists in session/cookie
    // For now, just placeholder
    setIsAuthenticated(false);
  };

  const loadTools = async () => {
    setLoading(true);
    setError(null);

    try {
      // TODO: Call /api/mcp/tools with access token
      const response = await fetch('/api/mcp/tools');

      if (!response.ok) {
        throw new Error('Failed to load tools');
      }

      const data = await response.json();
      setTools(data.tools || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">
            Governance Agent
          </h1>
          <div className="flex items-center gap-4">
            {isAuthenticated ? (
              <span className="flex items-center text-green-600">
                <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                Authenticated
              </span>
            ) : (
              <Link
                href="/login"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Authentication Status Card */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            Status
          </h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Authentication:</span>
              <span className={isAuthenticated ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
                {isAuthenticated ? 'Authenticated' : 'Not authenticated'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">MCP Connection:</span>
              <span className="text-gray-400 font-semibold">Not connected</span>
            </div>
          </div>
        </div>

        {/* Available Tools */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-900">
              Available Tools
            </h2>
            <button
              onClick={loadTools}
              disabled={loading || !isAuthenticated}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
            >
              {loading ? 'Loading...' : 'Load Tools'}
            </button>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
              <p className="text-red-800">{error}</p>
            </div>
          )}

          {!isAuthenticated && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
              <p className="text-yellow-800">
                You must be authenticated to view and use tools.
              </p>
            </div>
          )}

          {tools.length === 0 && !loading && (
            <div className="text-center py-12 text-gray-500">
              <p className="mb-2">No tools loaded yet</p>
              <p className="text-sm">Click "Load Tools" to fetch available governance tools</p>
            </div>
          )}

          {tools.length > 0 && (
            <div className="space-y-3">
              {tools.map((tool) => (
                <div
                  key={tool.name}
                  className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors"
                >
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-semibold text-gray-900">{tool.name}</h3>
                    <button
                      className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                      disabled
                    >
                      Invoke (TBD)
                    </button>
                  </div>
                  <p className="text-gray-600 text-sm">{tool.description}</p>
                  {tool.inputSchema && (
                    <div className="mt-2 text-xs text-gray-500">
                      Requires: {tool.inputSchema.required?.join(', ') || 'No required parameters'}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Info Notice */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-800">
            <strong>Note:</strong> This is a skeleton UI. Full authentication and tool invocation will be implemented later.
          </p>
        </div>
      </main>
    </div>
  );
}
