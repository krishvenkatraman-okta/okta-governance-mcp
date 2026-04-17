/**
 * AgentHeader Component
 *
 * Branded header for the Okta AI Governance Console
 * Features animated logo and gradient background
 *
 * IMPORTANT: Logo File Requirement
 * The Okta logo must be placed at: frontend/public/okta-logo.png
 * - Format: PNG with transparency (recommended)
 * - Dimensions: Square aspect ratio (e.g., 512x512px)
 * - The logo is displayed at 64x64px with slow rotation animation
 */

'use client';

import Image from 'next/image';
import { uiConfig } from '@/lib/ui-config';

export default function AgentHeader() {
  const handleLogout = () => {
    // Clear governance check flag on logout
    sessionStorage.removeItem('governanceChecked');
    console.log('[AgentHeader] Cleared governanceChecked flag on logout');

    // Redirect to logout endpoint
    window.location.href = '/api/auth/logout';
  };

  return (
    <header
      className="relative overflow-hidden"
      style={{
        background: uiConfig.gradients.header,
      }}
    >
      {/* Animated background pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent animate-pulse-slow" />
      </div>

      {/* Content */}
      <div className="relative max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center gap-6">
          {/* Logo with subtle animation */}
          <div className="relative w-16 h-16 flex-shrink-0">
            <div className="absolute inset-0 animate-spin-slow">
              <Image
                src={uiConfig.logoPath}
                alt="Okta Logo"
                width={64}
                height={64}
                className="object-contain"
                priority
              />
            </div>
          </div>

          {/* Title and Tagline */}
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-white mb-1">
              {uiConfig.title}
            </h1>
            <p className="text-blue-200 text-sm font-medium">
              {uiConfig.tagline}
            </p>
          </div>

          {/* Logout Button - Subtle */}
          <button
            onClick={handleLogout}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white/90 hover:text-white hover:bg-white/10 transition-all"
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Bottom gradient border */}
      <div
        className="h-1"
        style={{
          background: `linear-gradient(90deg, ${uiConfig.colors.primary} 0%, ${uiConfig.colors.primaryLight} 100%)`,
        }}
      />
    </header>
  );
}
