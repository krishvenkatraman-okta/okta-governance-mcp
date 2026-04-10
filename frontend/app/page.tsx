/**
 * Home page
 *
 * Landing page with links to login and agent interface
 */

import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="max-w-2xl mx-auto px-6 py-12 text-center">
        <h1 className="text-5xl font-bold text-gray-900 mb-6">
          Okta Governance AI Agent
        </h1>

        <p className="text-xl text-gray-600 mb-8">
          AI-powered governance platform using Okta as the identity and governance control plane
        </p>

        <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">Features</h2>
          <ul className="text-left space-y-3 text-gray-700">
            <li className="flex items-start">
              <span className="text-green-500 mr-2">✓</span>
              <span>Secure OIDC + PKCE authentication with Okta</span>
            </li>
            <li className="flex items-start">
              <span className="text-green-500 mr-2">✓</span>
              <span>Role-based access control (SUPER_ADMIN, APP_ADMIN, GROUP_ADMIN)</span>
            </li>
            <li className="flex items-start">
              <span className="text-green-500 mr-2">✓</span>
              <span>Dynamic tool exposure based on capabilities</span>
            </li>
            <li className="flex items-start">
              <span className="text-green-500 mr-2">✓</span>
              <span>MCP-compliant governance operations</span>
            </li>
          </ul>
        </div>

        <div className="flex gap-4 justify-center">
          <Link
            href="/login"
            className="px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
          >
            Get Started
          </Link>
          <Link
            href="/agent"
            className="px-8 py-3 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors font-semibold"
          >
            Go to Agent
          </Link>
        </div>

        <div className="mt-12 pt-8 border-t border-gray-300">
          <p className="text-sm text-gray-500">
            Architecture: Frontend → Okta (OIDC + Token Exchange) → MCP Resource Server
          </p>
        </div>
      </div>
    </div>
  );
}
