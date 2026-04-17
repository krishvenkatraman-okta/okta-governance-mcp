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

    // Call MCP tool to check user's inactive apps
    const mcpResponse = await fetch(config.mcp.endpoints.toolsCall, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mcpAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'check_user_inactive_apps',
        arguments: {
          userId: session.userId,
          inactivityDays: INACTIVITY_DAYS,
        },
      }),
    });

    if (!mcpResponse.ok) {
      console.error('[InactiveApps] MCP call failed:', mcpResponse.status);
      return NextResponse.json([], { status: 200 });
    }

    const mcpResult = await mcpResponse.json();
    console.log('[InactiveApps] MCP result:', JSON.stringify(mcpResult, null, 2));

    // Extract inactive apps from MCP response
    if (mcpResult.content && Array.isArray(mcpResult.content)) {
      const textContent = mcpResult.content.find((c: any) => c.type === 'text');
      if (textContent && textContent.text) {
        try {
          const data = JSON.parse(textContent.text);
          const inactiveApps = data.inactiveApps || [];

          console.log(`[InactiveApps] Found ${inactiveApps.length} inactive apps`);

          // Return formatted response
          return NextResponse.json(inactiveApps.map((app: any) => ({
            appId: app.appId,
            appName: app.appLabel || app.appName,
            lastAccess: app.lastAccess,
            daysSinceLastAccess: app.daysSinceLastAccess,
            recommendation: app.recommendation,
          })));
        } catch (parseError) {
          console.error('[InactiveApps] Failed to parse MCP response:', parseError);
        }
      }
    }

    return NextResponse.json([]);
  } catch (error: any) {
    console.error('[InactiveApps] Error:', error);
    return NextResponse.json([], { status: 200 });
  }
}
