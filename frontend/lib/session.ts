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
 * 3. JWT access tokens (userAccessToken, mcpAccessToken) stored in separate cookies
 *    (see lib/token-cookies.ts) to save ~2,360 bytes in session
 * 4. Keep only workflow data and user identity in session
 */

import { getIronSession, IronSession } from 'iron-session';
import { cookies } from 'next/headers';

export interface SessionData {
  // PKCE state (cleared after callback)
  codeVerifier?: string;
  state?: string;

  // Tokens (cleaned up after use - temporary storage only)
  idToken?: string;           // Removed after ID-JAG exchange
  idJag?: string;             // Removed after MCP access token exchange

  // Token metadata (minimal)
  idTokenExpiresAt?: number;
  idJagExpiresAt?: number;

  // NOTE: userAccessToken and mcpAccessToken are now stored in separate cookies
  // (see lib/token-cookies.ts) to prevent session cookie bloat

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
      | 'awaiting_confirmation'
      | 'smart_parse_confirmation'; // Confirming smart-parsed complete request
    resourceName: string;
    parentEntryId?: string; // Parent catalog entry ID (stored instead of full object)
    childEntryIds?: string[]; // Child entitlement IDs (stored instead of full objects)
    selectedEntryId?: string; // Selected entitlement ID
    selectedEntryName?: string; // Selected entitlement name for display
    requestFieldIds?: string[]; // Required field IDs (stored instead of full field objects)
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

  // Conversation history (cleared after workflow completion to prevent bloat)
  conversationHistory?: any[];
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
