/**
 * API Route: /api/demo/client-assertion
 *
 * Demo endpoint to test client assertion generation
 *
 * SECURITY: This endpoint is for testing/demo only. It shows JWT metadata
 * without exposing the private key or full signed token.
 *
 * In production, consider protecting this endpoint or removing it entirely.
 */

import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import {
  buildAgentClientAssertion,
  decodeClientAssertionMetadata,
  validateClientAssertionClaims,
} from '@/lib/agent-client-assertion';

export async function GET() {
  try {
    // Check if agent is configured
    const { agent, orgAuthServer } = config.okta;

    if (!agent.principalId || !agent.keyId) {
      return NextResponse.json(
        {
          error: 'Agent not configured',
          message: 'Agent principal ID and key ID must be set in environment',
        },
        { status: 500 }
      );
    }

    if (!agent.privateKeyJwk && !agent.privateKeyPath) {
      return NextResponse.json(
        {
          error: 'Agent private key not configured',
          message: 'Agent private key (JWK or path) must be set in environment',
        },
        { status: 500 }
      );
    }

    // Build client assertion
    const audience = orgAuthServer.tokenEndpoint;
    const jwt = await buildAgentClientAssertion({ audience });

    // Decode metadata (without exposing full JWT)
    const metadata = decodeClientAssertionMetadata(jwt);

    // Validate claims
    const validation = validateClientAssertionClaims(jwt);

    return NextResponse.json({
      success: true,
      message: 'Client assertion generated successfully',
      metadata: {
        header: metadata.header,
        payload: {
          ...metadata.payload,
          // Mask JTI for security
          jti: metadata.payload.jti.substring(0, 8) + '...',
        },
      },
      validation: {
        valid: validation.valid,
        errors: validation.errors,
      },
      config: {
        agentPrincipalId: agent.principalId,
        agentKeyId: agent.keyId,
        audience: audience,
        privateKeySource: agent.privateKeyJwk ? 'JWK string' : 'PEM file',
      },
      security_note:
        'Full JWT not shown for security. Use this only for testing client assertion generation.',
    });
  } catch (error) {
    console.error('Client assertion demo error:', error);
    return NextResponse.json(
      {
        error: 'Failed to generate client assertion',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
