/**
 * API Route: /api/governance/pending-requests
 *
 * Returns the authenticated user's PENDING access requests.
 * Uses Okta Governance End-User API V2 with user's access token.
 *
 * Required scope: okta.accessRequests.request.read
 *
 * API Reference:
 * https://developer.okta.com/docs/api/iga/openapi/governance-production-enduser-reference/my-requests/getmyrequestv2
 */

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getUserAccessToken } from '@/lib/token-cookies';

export async function GET() {
  try {
    const session = await getSession();

    if (!session.userId) {
      return NextResponse.json([], { status: 200 });
    }

    const userAccessToken = await getUserAccessToken();

    if (!userAccessToken) {
      console.error('[PendingRequests] No user access token');
      return NextResponse.json([], { status: 200 });
    }

    const oktaDomain = process.env.NEXT_PUBLIC_OKTA_DOMAIN;
    if (!oktaDomain) {
      console.error('[PendingRequests] OKTA_DOMAIN not configured');
      return NextResponse.json([], { status: 200 });
    }

    const orgUrl = oktaDomain.startsWith('https://') ? oktaDomain : `https://${oktaDomain}`;

    // Call Okta End-User API V2 for access requests
    const response = await fetch(`${orgUrl}/governance/api/v2/me/requests`, {
      headers: {
        'Authorization': `Bearer ${userAccessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.error('[PendingRequests] API error:', response.status, await response.text());
      return NextResponse.json([], { status: 200 });
    }

    const data = await response.json();
    const requests = data.items || data.data || [];

    // Filter for PENDING status only
    const pendingRequests = requests
      .filter((req: any) => req.status === 'PENDING')
      .map((req: any) => ({
        id: req.id,
        appName: req.resource?.displayName || req.resource?.name || 'Unknown App',
        resourceName: req.resource?.name || '',
        status: req.status,
        created: req.created,
        lastUpdated: req.lastUpdated,
      }));

    console.log(`[PendingRequests] Found ${pendingRequests.length} pending requests`);

    return NextResponse.json(pendingRequests);
  } catch (error: any) {
    console.error('[PendingRequests] Error:', error);
    return NextResponse.json([], { status: 200 });
  }
}
