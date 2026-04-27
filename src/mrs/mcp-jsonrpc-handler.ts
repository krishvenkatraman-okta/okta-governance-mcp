/**
 * MCP JSON-RPC Handler for Streamable HTTP Transport
 *
 * Implements the Model Context Protocol (MCP) over HTTP using JSON-RPC 2.0.
 * This is the modern transport that VS Code and GitHub MCP use.
 *
 * @see https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#http
 */

import type { Request, Response } from 'express';
import { getAvailableTools } from './tool-registry.js';
import { executeTool } from './tool-executor.js';
import type { AuthorizationContext } from '../types/index.js';

/**
 * JSON-RPC 2.0 Request structure
 */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: any;
  id?: string | number;
}

/**
 * JSON-RPC 2.0 Response structure
 */
interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id: string | number | null;
}

/**
 * JSON-RPC 2.0 Error codes
 */
const JsonRpcErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/**
 * Handle MCP JSON-RPC request
 *
 * Supports these MCP methods:
 * - initialize: Initialize MCP session
 * - tools/list: List available tools
 * - tools/call: Execute a tool
 */
export async function handleMcpJsonRpc(
  req: Request,
  res: Response,
  context: AuthorizationContext
): Promise<void> {
  try {
    const request = req.body as JsonRpcRequest;

    // Validate JSON-RPC structure
    if (request.jsonrpc !== '2.0') {
      sendJsonRpcError(res, JsonRpcErrorCode.INVALID_REQUEST, 'Invalid JSON-RPC version', null);
      return;
    }

    if (!request.method || typeof request.method !== 'string') {
      sendJsonRpcError(res, JsonRpcErrorCode.INVALID_REQUEST, 'Missing or invalid method', request.id ?? null);
      return;
    }

    console.log('[MCP-JSONRPC] Processing request:', {
      method: request.method,
      id: request.id,
      subject: context.subject,
    });

    // Route to appropriate handler
    switch (request.method) {
      case 'initialize':
        await handleInitialize(request, res, context);
        break;

      case 'tools/list':
        await handleToolsList(request, res, context);
        break;

      case 'tools/call':
        await handleToolsCall(request, res, context);
        break;

      default:
        sendJsonRpcError(
          res,
          JsonRpcErrorCode.METHOD_NOT_FOUND,
          `Method not found: ${request.method}`,
          request.id ?? null
        );
    }
  } catch (error) {
    console.error('[MCP-JSONRPC] Error handling request:', error);
    sendJsonRpcError(
      res,
      JsonRpcErrorCode.INTERNAL_ERROR,
      error instanceof Error ? error.message : 'Internal error',
      null
    );
  }
}

/**
 * Handle initialize method
 */
async function handleInitialize(
  request: JsonRpcRequest,
  res: Response,
  _context: AuthorizationContext
): Promise<void> {
  const response: JsonRpcResponse = {
    jsonrpc: '2.0',
    result: {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: 'okta-governance-mcp',
        version: '1.0.0',
      },
    },
    id: request.id ?? null,
  };

  res.json(response);
}

/**
 * Handle tools/list method
 */
async function handleToolsList(
  request: JsonRpcRequest,
  res: Response,
  context: AuthorizationContext
): Promise<void> {
  try {
    const tools = getAvailableTools(context);

    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      result: {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      },
      id: request.id ?? null,
    };

    res.json(response);
  } catch (error) {
    console.error('[MCP-JSONRPC] Error listing tools:', error);
    sendJsonRpcError(
      res,
      JsonRpcErrorCode.INTERNAL_ERROR,
      error instanceof Error ? error.message : 'Failed to list tools',
      request.id ?? null
    );
  }
}

/**
 * Handle tools/call method
 */
async function handleToolsCall(
  request: JsonRpcRequest,
  res: Response,
  context: AuthorizationContext
): Promise<void> {
  try {
    const params = request.params || {};
    const { name, arguments: args } = params;

    if (!name || typeof name !== 'string') {
      sendJsonRpcError(
        res,
        JsonRpcErrorCode.INVALID_PARAMS,
        'Missing or invalid tool name',
        request.id ?? null
      );
      return;
    }

    console.log('[MCP-JSONRPC] Executing tool:', { name, subject: context.subject });

    // Execute tool
    const result = await executeTool(
      {
        name,
        arguments: args || {},
      },
      context
    );

    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      result: {
        content: result.content,
        isError: result.isError,
      },
      id: request.id ?? null,
    };

    res.json(response);
  } catch (error) {
    console.error('[MCP-JSONRPC] Error executing tool:', error);
    sendJsonRpcError(
      res,
      JsonRpcErrorCode.INTERNAL_ERROR,
      error instanceof Error ? error.message : 'Failed to execute tool',
      request.id ?? null
    );
  }
}

/**
 * Send JSON-RPC error response
 */
function sendJsonRpcError(
  res: Response,
  code: number,
  message: string,
  id: string | number | null
): void {
  const response: JsonRpcResponse = {
    jsonrpc: '2.0',
    error: {
      code,
      message,
    },
    id,
  };

  res.status(200).json(response); // JSON-RPC errors are sent with 200 status
}
