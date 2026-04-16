/**
 * API Route: /api/mcp/tools
 *
 * Proxy to MCP server to list available tools
 *
 * Flow:
 * 1. Retrieve MCP access token from session
 * 2. POST to MCP server tools endpoint:
 *    URL: {MCP_BASE_URL}/mcp/v1/tools/list
 *    Headers:
 *      Authorization: Bearer <access_token>
 *      Content-Type: application/json
 *    Body: {}
 * 3. Receive list of available tools
 * 4. Return tools to frontend (no token exposure)
 */

import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { getSession } from '@/lib/session';
import { getMcpAccessToken } from '@/lib/token-cookies';

interface McpTool {
  name: string;
  description: string;
  inputSchema?: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface AuthorizationMetadata {
  resolvedRole: string;
  capabilitiesCount: number;
  targetAppsCount: number;
  targetGroupsCount?: number;
  scopeSummary: string;
}

interface McpToolsResponse {
  tools: McpTool[];
  authorization?: AuthorizationMetadata;
}

interface McpErrorResponse {
  error: string;
  error_description?: string;
}

export async function POST() {
  try {
    console.log('[MCP Tools] Fetching tools from MCP server');

    // 1. Get MCP access token from cookie
    const session = await getSession();
    const mcpAccessToken = await getMcpAccessToken();

    if (!mcpAccessToken) {
      console.error('[MCP Tools] No MCP access token found');
      return NextResponse.json(
        {
          error: 'MCP token not available',
          message: 'Please get MCP access token first',
        },
        { status: 401 }
      );
    }

    const userId = session.userId;

    console.log('[MCP Tools] Retrieved MCP access token from cookie', {
      userId: userId || 'unknown',
    });

    // 2. Call MCP server tools endpoint
    const toolsEndpoint = config.mcp.endpoints.tools;

    console.log('[MCP Tools] Calling MCP server:', toolsEndpoint);

    const response = await fetch(toolsEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mcpAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    // Handle MCP server errors
    if (!response.ok) {
      if (response.status === 401) {
        console.error('[MCP Tools] Unauthorized to MCP server');
        return NextResponse.json(
          {
            error: 'Unauthorized to MCP',
            message: 'MCP access token is invalid or expired',
          },
          { status: 401 }
        );
      }

      // Try to parse error response
      let errorMessage = 'MCP server error';
      try {
        const errorData: McpErrorResponse = await response.json();
        errorMessage = errorData.error_description || errorData.error || errorMessage;
      } catch {
        // If JSON parse fails, use default message
      }

      console.error('[MCP Tools] MCP server error:', {
        status: response.status,
        message: errorMessage,
      });

      return NextResponse.json(
        {
          error: 'MCP server error',
          message: errorMessage,
        },
        { status: response.status }
      );
    }

    // Parse success response
    const data: McpToolsResponse = await response.json();

    // Debug: Log what we received from MCP server (safe - no tokens)
    console.log('[MCP Tools] Received from MCP server:', JSON.stringify({
      toolsCount: data.tools?.length || 0,
      hasAuthorization: !!data.authorization,
      authorization: data.authorization,
    }, null, 2));

    // Debug: Log what we're sending to client (safe - no tokens)
    const clientResponse = {
      success: true,
      tools: data.tools || [],
      count: data.tools?.length || 0,
      authorization: data.authorization || null,
    };

    console.log('[MCP Tools] Sending to client:', JSON.stringify({
      success: clientResponse.success,
      count: clientResponse.count,
      hasAuthorization: !!clientResponse.authorization,
      authorization: clientResponse.authorization,
    }, null, 2));

    // 3. Return tools and authorization metadata to client (no token exposure)
    return NextResponse.json(clientResponse);
  } catch (error) {
    console.error('[MCP Tools] Error:', error);

    // Log error without exposing sensitive data
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Check for network errors
    if (errorMessage.includes('fetch') || errorMessage.includes('ECONNREFUSED')) {
      return NextResponse.json(
        {
          error: 'Cannot connect to MCP server',
          message: 'MCP server is unreachable. Please check if the server is running.',
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        error: 'Failed to fetch MCP tools',
        message: errorMessage,
      },
      { status: 500 }
    );
  }
}
