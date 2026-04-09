/**
 * Authentication and token types
 */

/**
 * ID-JAG (ID token for Just-in-time Attribute Governance)
 * Obtained via Okta token exchange
 */
export interface IdJagToken {
  iss: string; // Issuer
  sub: string; // Subject (user ID)
  aud: string; // Audience
  exp: number; // Expiration timestamp
  iat: number; // Issued at timestamp
  jti?: string; // JWT ID
  // Additional claims from Okta
  [key: string]: unknown;
}

/**
 * MCP Access Token
 * Issued by MAS for use with MRS
 */
export interface McpAccessToken {
  iss: string; // Issuer (MAS)
  sub: string; // Subject (user ID)
  aud: string; // Audience (MRS)
  exp: number; // Expiration timestamp
  iat: number; // Issued at timestamp
  jti: string; // JWT ID
  sessionId?: string; // Session identifier
  // Additional context
  [key: string]: unknown;
}

/**
 * ID-JAG validation result
 */
export interface IdJagValidationResult {
  valid: boolean;
  payload?: IdJagToken;
  error?: string;
}

/**
 * MCP token validation result
 */
export interface McpTokenValidationResult {
  valid: boolean;
  payload?: McpAccessToken;
  error?: string;
}

/**
 * Token exchange request
 */
export interface TokenExchangeRequest {
  subjectToken: string; // ID token
  subjectTokenType: string; // urn:ietf:params:oauth:token-type:id_token
  audience: string; // Target audience
  scope?: string; // Requested scopes
}

/**
 * Token exchange response from Okta
 */
export interface TokenExchangeResponse {
  access_token: string; // ID-JAG
  issued_token_type: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}
