/**
 * API Route: /api/mcp/call
 *
 * Execute an MCP tool by calling the MCP server
 *
 * Flow:
 * 1. Retrieve MCP access token from session
 * 2. Validate tool name and arguments
 * 3. POST to MCP server tool execution endpoint
 * 4. Return result to client (safe - no token exposure)
 *
 * Request Body:
 * {
 *   toolName: string,
 *   arguments: Record<string, unknown>
 * }
 *
 * Response:
 * {
 *   success: boolean,
 *   result?: {
 *     content: Array<{ type: string, text?: string }>,
 *     isError?: boolean
 *   },
 *   error?: string
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { getSession } from '@/lib/session';

interface ToolCallRequest {
  toolName: string;
  arguments?: Record<string, unknown>;
}

interface McpToolCallResponse {
  content: Array<{
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    console.log('[MCP Call] Starting tool execution');

    // 1. Get MCP access token from session
    const session = await getSession();

    if (!session.mcpAccessToken) {
      console.error('[MCP Call] No MCP access token found in session');
      return NextResponse.json(
        {
          success: false,
          error: 'MCP access token not available',
          message: 'Please complete the token exchange flow first',
        },
        { status: 401 }
      );
    }

    const mcpAccessToken = session.mcpAccessToken;

    // 2. Parse request body
    const body: ToolCallRequest = await request.json();
    const { toolName, arguments: toolArgs = {} } = body;

    if (!toolName) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing tool name',
          message: 'Tool name is required',
        },
        { status: 400 }
      );
    }

    console.log('[MCP Call] Executing tool:', {
      toolName,
      hasArguments: Object.keys(toolArgs).length > 0,
    });

    // 3. Call MCP server tool execution endpoint
    const toolCallEndpoint = config.mcp.endpoints.toolsCall;

    const response = await fetch(toolCallEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mcpAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: toolName,
        arguments: toolArgs,
      }),
    });

    // Handle MCP server errors
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[MCP Call] MCP server error:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText.substring(0, 200),
      });

      let errorMessage = 'MCP server error';
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.message || errorData.error || errorMessage;
      } catch {
        // If not JSON, use raw text
        errorMessage = errorText.substring(0, 200);
      }

      return NextResponse.json(
        {
          success: false,
          error: 'Tool execution failed',
          message: errorMessage,
          status: response.status,
        },
        { status: response.status }
      );
    }

    // Parse success response
    const result: McpToolCallResponse = await response.json();

    console.log('[MCP Call] Tool execution successful:', {
      toolName,
      isError: result.isError || false,
      contentCount: result.content?.length || 0,
    });

    // 4. Return result to client (safe - no token exposure)
    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error) {
    console.error('[MCP Call] Error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to execute tool',
        message: errorMessage,
      },
      { status: 500 }
    );
  }
}
