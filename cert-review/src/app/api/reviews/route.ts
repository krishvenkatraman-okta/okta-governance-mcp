import { NextRequest, NextResponse } from 'next/server';
import { getAccessToken } from '@/lib/get-token';
import { listMyReviewItems } from '@/lib/okta-governance';

export async function GET(request: NextRequest) {
  const token = await getAccessToken(request);
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get('campaignId');
  if (!campaignId) {
    return NextResponse.json({ error: 'campaignId is required' }, { status: 400 });
  }

  try {
    const items = await listMyReviewItems(campaignId, token, {
      filter: searchParams.get('filter') || undefined,
      search: searchParams.get('search') || undefined,
      sortBy: searchParams.get('sortBy') || undefined,
      sortOrder: searchParams.get('sortOrder') || undefined,
      limit: searchParams.has('limit') ? parseInt(searchParams.get('limit')!) : 200,
    });
    return NextResponse.json(items);
  } catch (error: any) {
    console.error('[API/reviews] Error:', error.message);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch reviews' },
      { status: error.status || 500 }
    );
  }
}
