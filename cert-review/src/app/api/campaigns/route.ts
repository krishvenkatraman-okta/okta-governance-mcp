import { NextRequest, NextResponse } from 'next/server';
import { getAccessToken } from '@/lib/get-token';
import { listMyCampaigns } from '@/lib/okta-governance';

export async function GET(request: NextRequest) {
  const token = await getAccessToken(request);
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const campaigns = await listMyCampaigns(token);
    return NextResponse.json(campaigns);
  } catch (error: any) {
    console.error('[API/campaigns] Error:', error.message);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch campaigns' },
      { status: error.status || 500 }
    );
  }
}
