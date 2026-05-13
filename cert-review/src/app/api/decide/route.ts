import { NextRequest, NextResponse } from 'next/server';
import { getAccessToken } from '@/lib/get-token';
import { submitDecision } from '@/lib/okta-governance';

export async function POST(request: NextRequest) {
  const token = await getAccessToken(request);
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await request.json();
  const { campaignId, reviewItemId, decision, reviewerLevelId, note } = body;

  if (!campaignId || !reviewItemId || !decision) {
    return NextResponse.json(
      { error: 'campaignId, reviewItemId, and decision are required' },
      { status: 400 }
    );
  }

  try {
    const result = await submitDecision(
      campaignId, reviewItemId, decision,
      reviewerLevelId || 'ONE', note || '', token
    );
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[API/decide] Error:', error.message);
    return NextResponse.json(
      { error: error.message || 'Failed to submit decision' },
      { status: error.status || 500 }
    );
  }
}
