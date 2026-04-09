/**
 * MAS API routes
 */

import express, { Request, Response, NextFunction } from 'express';
import { validateIdJag } from '../auth/id-jag-validator.js';
import { extractBearerToken } from '../auth/jwt-utils.js';
import { issueMcpAccessToken, generateTokenMetadata } from './token-issuer.js';

export const router = express.Router();

/**
 * Health check endpoint
 */
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'MCP Authorization Server',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Token endpoint
 *
 * POST /token
 * Authorization: Bearer <ID-JAG>
 *
 * Returns MCP access token
 */
router.post('/token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Extract ID-JAG from Authorization header
    const authHeader = req.headers.authorization;
    const idJag = extractBearerToken(authHeader);

    if (!idJag) {
      res.status(401).json({
        error: 'invalid_request',
        error_description: 'Missing or invalid Authorization header',
      });
      return;
    }

    // Validate ID-JAG
    const validationResult = await validateIdJag(idJag);

    if (!validationResult.valid || !validationResult.payload) {
      res.status(401).json({
        error: 'invalid_token',
        error_description: validationResult.error || 'ID-JAG validation failed',
      });
      return;
    }

    // Issue MCP access token
    const mcpToken = issueMcpAccessToken(validationResult.payload);
    const metadata = generateTokenMetadata(mcpToken);

    res.json(metadata);
  } catch (error) {
    next(error);
  }
});

/**
 * Error handler
 */
router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('MAS error:', err);
  res.status(500).json({
    error: 'server_error',
    error_description: 'Internal server error',
  });
});
