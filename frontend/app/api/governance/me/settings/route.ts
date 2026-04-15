/**
 * API Route: /api/governance/me/settings
 *
 * Returns the authenticated user's governance settings from Okta.
 *
 * Flow:
 * 1. Extract user's MCP access token from session
 * 2. Create OktaGovernanceUserAPI client
 * 3. Call getMySettings()
 * 4. Return governance response
 *
 * Required:
 * - User must be authenticated (session.userId exists)
 * - Session must contain mcpAccessToken
 * - NEXT_PUBLIC_OKTA_DOMAIN environment variable must be set
 *
 * Response: GovernanceResponse<any>
 * {
 *   data: [...],
 *   next?: string,
 *   summary?: { total: number, count: number },
 *   error?: { code: string, message: string, scope?: string }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { OktaGovernanceUserAPI } from '@/lib/okta-governance-user-api';

export async function GET(request: NextRequest) {
  try {
    // Step 1: Get user session
    const session = await getSession();

    if (!session.userId) {
      return NextResponse.json(
        {
          data: [],
          error: {
            code: 'UNAUTHORIZED',
            message: 'User not authenticated',
          },
        },
        { status: 401 }
      );
    }

    // Step 2: Extract MCP access token
    const accessToken = session.mcpAccessToken;

    if (!accessToken) {
      return NextResponse.json(
        {
          data: [],
          error: {
            code: 'NO_TOKEN',
            message: 'MCP access token not found in session',
          },
        },
        { status: 401 }
      );
    }

    // Step 3: Get Okta domain from environment
    const oktaDomain = process.env.NEXT_PUBLIC_OKTA_DOMAIN;

    if (!oktaDomain) {
      console.error('[Settings Handler] NEXT_PUBLIC_OKTA_DOMAIN not configured');
      return NextResponse.json(
        {
          data: [],
          error: {
            code: 'MISSING_CONFIG',
            message: 'Okta domain not configured',
          },
        },
        { status: 500 }
      );
    }

    // Ensure domain is a full URL
    const orgUrl = oktaDomain.startsWith('https://')
      ? oktaDomain
      : `https://${oktaDomain}`;

    // Step 4: Create API client and call getMySettings()
    const client = new OktaGovernanceUserAPI(accessToken, orgUrl);
    const response = await client.getMySettings();

    // Return the governance response
    return NextResponse.json(response);
  } catch (error: any) {
    console.error('[Settings Handler] Unexpected error:', error);

    return NextResponse.json(
      {
        data: [],
        error: {
          code: 'API_ERROR',
          message: error?.message || 'Unknown error occurred',
        },
      },
      { status: 500 }
    );
  }
}
