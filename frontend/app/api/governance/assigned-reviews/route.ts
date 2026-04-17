/**
 * API Route: /api/governance/assigned-reviews
 *
 * Returns the authenticated user's assigned security access reviews.
 * Uses Okta Governance End-User API with user's access token.
 *
 * Required scopes:
 * - okta.governance.securityAccessReviews.endUser.read
 * - okta.governance.securityAccessReviews.endUser.manage
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
      console.error('[AssignedReviews] No user access token');
      return NextResponse.json([], { status: 200 });
    }

    const oktaDomain = process.env.NEXT_PUBLIC_OKTA_DOMAIN;
    if (!oktaDomain) {
      console.error('[AssignedReviews] OKTA_DOMAIN not configured');
      return NextResponse.json([], { status: 200 });
    }

    const orgUrl = oktaDomain.startsWith('https://') ? oktaDomain : `https://${oktaDomain}`;

    // Call Okta End-User API for security access reviews
    const response = await fetch(`${orgUrl}/governance/api/v1/me/access-reviews`, {
      headers: {
        'Authorization': `Bearer ${userAccessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.error('[AssignedReviews] API error:', response.status, await response.text());
      return NextResponse.json([], { status: 200 });
    }

    const data = await response.json();
    const reviews = data.items || data.data || data || [];

    // Map to simplified format
    const assignedReviews = (Array.isArray(reviews) ? reviews : [])
      .filter((review: any) => review.status === 'PENDING' || review.decision === 'UNREVIEWED')
      .map((review: any) => ({
        id: review.id,
        campaignId: review.campaignId || review.id,
        campaignName: review.campaignName || review.name || 'Access Review',
        pendingReviewCount: 1,
        status: review.status,
        dueDate: review.dueDate || null,
      }));

    console.log(`[AssignedReviews] Found ${assignedReviews.length} assigned reviews`);

    return NextResponse.json(assignedReviews);
  } catch (error: any) {
    console.error('[AssignedReviews] Error:', error);
    return NextResponse.json([], { status: 200 });
  }
}
