/**
 * Session management utilities using iron-session
 *
 * Provides secure, encrypted session storage for tokens and PKCE state.
 * Server-side only - never exposes sensitive data to browser.
 *
 * COOKIE SIZE OPTIMIZATION:
 * To prevent "Cookie length is too big" errors, we:
 * 1. Store only minimal required data
 * 2. Remove tokens after they're no longer needed:
 *    - idToken removed after ID-JAG exchange
 *    - idJag removed after MCP access token exchange
 * 3. Don't store orgAccessToken (not needed for token exchanges)
 * 4. Keep only essential metadata (expiry timestamps)
 */

import { getIronSession, IronSession } from 'iron-session';
import { cookies } from 'next/headers';

export interface SessionData {
  // PKCE state (cleared after callback)
  codeVerifier?: string;
  state?: string;

  // Tokens (cleaned up after use)
  idToken?: string;           // Removed after ID-JAG exchange
  idJag?: string;             // Removed after MCP access token exchange
  mcpAccessToken?: string;    // Kept for MCP server calls

  // Token metadata (minimal)
  idTokenExpiresAt?: number;
  idJagExpiresAt?: number;
  mcpAccessTokenExpiresAt?: number;

  // User's access token from OIDC (for end-user governance APIs)
  // Separate from mcpAccessToken (which is for delegated admin)
  userAccessToken?: string;
  userAccessTokenExpiresAt?: number;

  // User info (always kept)
  userId?: string;
  userEmail?: string;

  // Pending write operations (for confirmation flow)
  pendingAction?: {
    type: string;
    appId?: string;
    appName?: string | null;
    action: string;
    [key: string]: unknown;
  };

  // Pending app resolution (for disambiguation flow)
  pendingAppResolution?: {
    type: 'app_resolution';
    intent: string; // tool name or operation type
    originalQuery: string;
    candidates: Array<{
      id: string;
      label: string;
      name: string;
    }>;
  };

  // Pending access request workflow (for multi-turn request flow)
  pendingAccessRequestWorkflow?: {
    stage:
      | 'awaiting_entitlement_selection'
      | 'collecting_fields'
      | 'awaiting_confirmation';
    resourceName: string;
    parentEntryId?: string; // Parent catalog entry ID (stored instead of full object)
    childEntryIds?: string[]; // Child entitlement IDs (stored instead of full objects)
    selectedEntryId?: string; // Selected entitlement ID
    selectedEntryName?: string; // Selected entitlement name for display
    requestFields?: any[]; // Required fields for request
    collectedValues?: Record<string, any>; // Field values collected so far
    currentFieldIndex?: number; // Which field we're collecting
  };

  // Pending label workflow (for label value selection flow)
  pendingLabelWorkflow?: {
    stage: 'awaiting_value_selection';
    toolName: string;
    action: string;
    appId: string;
    appName: string | null;
    labelName: string;
    availableValues: string[];
    label?: any; // Label metadata including labelId
  };
}

const sessionOptions = {
  password: process.env.SESSION_SECRET || 'complex_password_at_least_32_characters_long_for_dev',
  cookieName: 'okta_governance_session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax' as const,
    maxAge: 3600, // 1 hour
    path: '/',
  },
};

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

export async function clearSession(): Promise<void> {
  const session = await getSession();
  session.destroy();
}
