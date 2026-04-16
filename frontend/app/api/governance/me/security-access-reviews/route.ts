/**
 * API Route: /api/governance/me/security-access-reviews
 *
 * Returns the authenticated user's security access reviews from Okta Governance.
 * Security access reviews are reviews assigned to the user to certify access.
 *
 * Flow:
 * 1. Extract user's access token from session
 * 2. Parse query parameters (limit, sortBy)
 * 3. Create OktaGovernanceUserAPI client
 * 4. Call getMySecurityAccessReviews(params)
 * 5. Return governance response
 *
 * Query Parameters:
 * - limit: number - Maximum number of results to return
 * - sortBy: string - Field to sort by
 *
 * Required:
 * - User must be authenticated (session.userId exists)
 * - Session must contain userAccessToken
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
import { getUserAccessToken } from '@/lib/token-cookies';
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

    // Step 2: Get user access token from cookies
    const userAccessToken = await getUserAccessToken();

    if (!userAccessToken) {
      return NextResponse.json(
        {
          data: [],
          error: {
            code: 'NO_TOKEN',
            message: 'User access token not found in session',
          },
        },
        { status: 401 }
      );
    }

    // Step 3: Get Okta domain from environment
    const oktaDomain = process.env.NEXT_PUBLIC_OKTA_DOMAIN;

    if (!oktaDomain) {
      console.error('[Security Reviews Handler] NEXT_PUBLIC_OKTA_DOMAIN not configured');
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

    // Step 4: Parse query parameters
    const url = new URL(request.url);
    const limitParam = url.searchParams.get('limit');
    const sortBy = url.searchParams.get('sortBy') || undefined;

    const limit = limitParam ? parseInt(limitParam, 10) : undefined;

    // Step 5: Create API client and call getMySecurityAccessReviews()
    const client = new OktaGovernanceUserAPI(userAccessToken, orgUrl);
    const response = await client.getMySecurityAccessReviews({
      limit,
      sortBy,
    });

    // Return the governance response
    return NextResponse.json(response);
  } catch (error: any) {
    console.error('[Security Reviews Handler] Unexpected error:', error);

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
