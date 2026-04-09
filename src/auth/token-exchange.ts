/**
 * Okta token exchange helper
 *
 * This is a reference implementation for the frontend agent.
 * The MCP system does not perform token exchange - that is done by the frontend.
 */

import type { TokenExchangeRequest, TokenExchangeResponse } from '../types/index.js';

/**
 * Exchange ID token for ID-JAG using Okta token exchange
 *
 * NOTE: This function is provided as a reference for frontend integration.
 * The MCP server does not perform this exchange - it only validates the ID-JAG.
 *
 * @param idToken - The ID token from user authentication
 * @param tokenUrl - Okta token endpoint
 * @param clientId - OAuth client ID
 * @param audience - Target audience for ID-JAG
 */
export async function exchangeIdTokenForIdJag(
  idToken: string,
  tokenUrl: string,
  clientId: string,
  audience: string
): Promise<TokenExchangeResponse> {
  const request: TokenExchangeRequest = {
    subjectToken: idToken,
    subjectTokenType: 'urn:ietf:params:oauth:token-type:id_token',
    audience,
  };

  const params = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: request.subjectToken,
    subject_token_type: request.subjectTokenType,
    audience: request.audience,
    client_id: clientId,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.statusText}`);
  }

  return await response.json() as TokenExchangeResponse;
}
