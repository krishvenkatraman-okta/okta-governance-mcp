/**
 * API Route: /api/governance/tools
 *
 * Fetch all available governance tools with metadata and authorization status
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { config } from '@/lib/config';
import { TOOL_METADATA, type ToolMetadata } from '@/lib/tool-metadata';

interface ToolMetadataWithAuth extends ToolMetadata {
  isAuthorized: boolean;
  authorizationNote?: string;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();

    // Verify authentication
    if (!session.mcpAccessToken) {
      return NextResponse.json(
        { error: 'Not authenticated', message: 'MCP access token required' },
        { status: 401 }
      );
    }

    // Fetch available tools from MCP server
    let availableToolNames: string[] = [];
    try {
      const response = await fetch(`${config.mcp.endpoints.tools}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.mcpAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.tools && Array.isArray(data.tools)) {
          availableToolNames = data.tools.map((t: any) => t.name);
        }
      }
    } catch (error) {
      console.error('[Governance Tools API] Failed to fetch authorized tools:', error);
      // Continue with all tools, mark authorization status unknown
    }

    // Combine metadata with authorization status
    const toolsWithAuth: ToolMetadataWithAuth[] = Object.values(TOOL_METADATA).map((tool) => {
      const isAuthorized = availableToolNames.includes(tool.name);

      return {
        ...tool,
        isAuthorized,
        authorizationNote: !isAuthorized
          ? 'You do not have permission to use this tool'
          : undefined,
      };
    });

    // Group by category
    const toolsByCategory = {
      metadata: toolsWithAuth.filter((t) => t.category === 'metadata'),
      discovery: toolsWithAuth.filter((t) => t.category === 'discovery'),
      reporting: toolsWithAuth.filter((t) => t.category === 'reporting'),
      governance: toolsWithAuth.filter((t) => t.category === 'governance'),
      management: toolsWithAuth.filter((t) => t.category === 'management'),
    };

    // Calculate stats
    const stats = {
      total: toolsWithAuth.length,
      authorized: toolsWithAuth.filter((t) => t.isAuthorized).length,
      unauthorized: toolsWithAuth.filter((t) => !t.isAuthorized).length,
      implemented: toolsWithAuth.filter((t) => t.implementationStatus === 'implemented').length,
      stub: toolsWithAuth.filter((t) => t.implementationStatus === 'stub').length,
      read: toolsWithAuth.filter((t) => t.type === 'read').length,
      write: toolsWithAuth.filter((t) => t.type === 'write').length,
    };

    return NextResponse.json({
      success: true,
      tools: toolsWithAuth,
      toolsByCategory,
      stats,
      user: {
        userId: session.userId,
        userEmail: session.userEmail,
      },
    });
  } catch (error) {
    console.error('[Governance Tools API] Error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
