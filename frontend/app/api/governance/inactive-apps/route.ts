/**
 * API Route: /api/governance/inactive-apps
 *
 * Returns apps the user hasn't logged into for 60+ days.
 * Calls MCP server which uses service credentials to:
 * 1. Query system logs for user's app sign-in activity
 * 2. Identify apps not accessed in 60 days
 * 3. Create a self-certification campaign for the user
 * 4. Return apps list with campaign link
 *
 * Campaign logic:
 * - If campaign created in last 60 days and user still hasn't logged in, ignore until next 60-day period
 * - User can go to Okta campaign link to certify their access
 */

import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getMcpAccessToken } from '@/lib/token-cookies';
import { config } from '@/lib/config';

const INACTIVITY_DAYS = 60;

export async function GET() {
  try {
    const session = await getSession();

    if (!session.userId) {
      return NextResponse.json([], { status: 200 });
    }

    const mcpAccessToken = await getMcpAccessToken();

    if (!mcpAccessToken) {
      console.error('[InactiveApps] No MCP access token');
      return NextResponse.json([], { status: 200 });
    }

    console.log(`[InactiveApps] Checking inactive apps for user ${session.userId}`);

    // TODO: Create MCP tool 'check_user_inactive_apps' that:
    // 1. Gets user's app assignments using service credentials
    // 2. Queries system logs to find last sign-in for each app
    // 3. Identifies apps not accessed in INACTIVITY_DAYS
    // 4. Checks if self-cert campaign exists and was created in last 60 days
    // 5. If no recent campaign, creates new self-certification campaign
    // 6. Returns list of inactive apps with campaign link

    // For now, call generate_access_review_candidates as a workaround
    // This will be replaced with the proper tool

    const mcpResponse = await fetch(config.mcp.endpoints.toolsCall, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mcpAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'list_manageable_apps',
        arguments: {},
      }),
    });

    if (!mcpResponse.ok) {
      console.error('[InactiveApps] MCP call failed:', mcpResponse.status);
      return NextResponse.json([], { status: 200 });
    }

    const mcpResult = await mcpResponse.json();

    // For now, return empty array
    // TODO: Parse MCP response and return inactive apps with campaign info
    console.log('[InactiveApps] MCP tool for inactive apps not yet fully implemented');

    return NextResponse.json([]);
  } catch (error: any) {
    console.error('[InactiveApps] Error:', error);
    return NextResponse.json([], { status: 200 });
  }
}
