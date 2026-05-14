import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { listMyCampaigns } from '@/lib/okta-governance';

export async function GET(request: NextRequest) {
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  const accessToken = (token?.accessToken as string) || null;
  const expiresAt = token?.expiresAt as number;
  const now = Math.floor(Date.now() / 1000);
  
  console.log('[API/campaigns] Token present:', !!accessToken);
  console.log('[API/campaigns] Token expiresAt:', expiresAt, 'now:', now, 'expired:', expiresAt ? expiresAt < now : 'N/A');
  console.log('[API/campaigns] Token length:', accessToken?.length || 0);

  if (!accessToken) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const campaigns = await listMyCampaigns(accessToken);
    return NextResponse.json(campaigns);
  } catch (error: any) {
    console.error('[API/campaigns] Okta API error:', error.message);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch campaigns' },
      { status: error.status || 500 }
    );
  }
}
