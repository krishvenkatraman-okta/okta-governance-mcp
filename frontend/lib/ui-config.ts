/**
 * UI Configuration for Okta AI Governance Console
 *
 * Centralized branding and styling configuration
 */

export const uiConfig = {
  // Branding
  title: 'Okta AI Governance Console',
  tagline: 'Powered by Okta Identity Security Fabric',
  logoPath: '/okta-logo.png',

  // Colors (Okta brand palette)
  colors: {
    // Primary blue
    primary: '#007dc1',
    primaryDark: '#00689e',
    primaryLight: '#0099e6',

    // Dark blue (for backgrounds and gradients)
    darkBlue: '#00297a',
    darkBlueDark: '#001a4d',

    // Accent colors
    success: '#16a34a',
    warning: '#f59e0b',
    error: '#dc2626',
    info: '#3b82f6',

    // Neutral colors
    gray50: '#f9fafb',
    gray100: '#f3f4f6',
    gray200: '#e5e7eb',
    gray300: '#d1d5db',
    gray600: '#4b5563',
    gray700: '#374151',
    gray800: '#1f2937',
    gray900: '#111827',
  },

  // Gradients
  gradients: {
    primary: 'linear-gradient(135deg, #00297a 0%, #007dc1 100%)',
    header: 'linear-gradient(90deg, #001a4d 0%, #00297a 50%, #007dc1 100%)',
    card: 'linear-gradient(135deg, rgba(0, 125, 193, 0.05) 0%, rgba(0, 41, 122, 0.05) 100%)',
  },

  // Animation durations
  animation: {
    logoSpin: '20s',
    transition: '200ms',
  },
} as const;

export type UIConfig = typeof uiConfig;
