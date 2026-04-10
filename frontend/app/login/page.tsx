/**
 * Login page
 *
 * Initiates Okta OIDC + PKCE authentication flow
 * Will eventually redirect to /api/auth/start
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);

  const handleLogin = () => {
    setLoading(true);
    // TODO: Redirect to /api/auth/start to begin OIDC flow
    window.location.href = '/api/auth/start';
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Sign In
          </h1>
          <p className="text-gray-600">
            Authenticate with Okta to access governance tools
          </p>
        </div>

        <div className="space-y-6">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-semibold text-blue-900 mb-2">Authentication Flow</h3>
            <ol className="text-sm text-blue-800 space-y-1">
              <li>1. Authenticate with Okta (OIDC + PKCE)</li>
              <li>2. Exchange ID token for ID-JAG</li>
              <li>3. Exchange ID-JAG for access token</li>
              <li>4. Access MCP governance tools</li>
            </ol>
          </div>

          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors font-semibold"
          >
            {loading ? 'Redirecting...' : 'Sign in with Okta'}
          </button>

          <div className="text-center">
            <Link
              href="/"
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              ← Back to home
            </Link>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-gray-200">
          <p className="text-xs text-gray-500 text-center">
            This is a skeleton UI. Full authentication not yet implemented.
          </p>
        </div>
      </div>
    </div>
  );
}
