/**
 * Okta OIDC authentication for the agent web UI.
 *
 * Implements the Authorization Code + PKCE flow:
 *   1. /auth/login   → redirect to Okta authorize endpoint
 *   2. /auth/callback → exchange code for tokens, store in session
 *   3. /auth/logout  → clear session, redirect to Okta logout
 *   4. requireAuth   → middleware that gates routes behind SSO
 *
 * The access token from Okta is passed to the MCP server on every
 * tool call so the MCP server knows WHO is asking and can scope
 * tools to that user's authorization context.
 */

import crypto from "crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import fetch from "node-fetch";

// Extend session to hold our auth data
declare module "express-session" {
  interface SessionData {
    user?: {
      email: string;
      name: string;
      sub: string;
    };
    accessToken?: string;
    idToken?: string;
    codeVerifier?: string;
    state?: string;
  }
}

const OKTA_ISSUER = process.env.OKTA_ISSUER || "";
const OKTA_CLIENT_ID = process.env.OKTA_AGENT_CLIENT_ID || "";
const OKTA_CLIENT_SECRET = process.env.OKTA_AGENT_CLIENT_SECRET || "";
const CALLBACK_URL = process.env.AGENT_CALLBACK_URL || "http://localhost:3100/auth/callback";
const OKTA_SCOPES = process.env.OKTA_SCOPES || "openid profile email";

// PKCE helpers
function base64URLEncode(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function generateCodeVerifier(): string {
  return base64URLEncode(crypto.randomBytes(32));
}

function generateCodeChallenge(verifier: string): string {
  return base64URLEncode(crypto.createHash("sha256").update(verifier).digest());
}

// Discover Okta endpoints
let discoveryCache: {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  end_session_endpoint: string;
  jwks_uri: string;
} | null = null;

async function discover() {
  if (discoveryCache) return discoveryCache;

  const resp = await fetch(`${OKTA_ISSUER}/.well-known/openid-configuration`);
  if (!resp.ok) throw new Error(`OIDC discovery failed: ${resp.status}`);
  discoveryCache = (await resp.json()) as typeof discoveryCache;
  return discoveryCache!;
}

export function authRouter(): Router {
  const router = Router();

  // Login — redirect to Okta
  router.get("/login", async (req: Request, res: Response) => {
    try {
      const oidc = await discover();
      const state = crypto.randomBytes(16).toString("hex");
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = generateCodeChallenge(codeVerifier);

      req.session.state = state;
      req.session.codeVerifier = codeVerifier;

      const params = new URLSearchParams({
        response_type: "code",
        client_id: OKTA_CLIENT_ID,
        redirect_uri: CALLBACK_URL,
        scope: OKTA_SCOPES,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      });

      res.redirect(`${oidc.authorization_endpoint}?${params.toString()}`);
    } catch (err) {
      console.error("Login error:", err);
      res.status(500).send("Authentication error");
    }
  });

  // Callback — exchange code for tokens
  router.get("/callback", async (req: Request, res: Response) => {
    try {
      const { code, state } = req.query;

      if (state !== req.session.state) {
        res.status(403).send("Invalid state parameter");
        return;
      }

      const oidc = await discover();
      const codeVerifier = req.session.codeVerifier;

      // Exchange code for tokens
      const tokenResp = await fetch(oidc.token_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: code as string,
          redirect_uri: CALLBACK_URL,
          client_id: OKTA_CLIENT_ID,
          ...(OKTA_CLIENT_SECRET ? { client_secret: OKTA_CLIENT_SECRET } : {}),
          code_verifier: codeVerifier || "",
        }).toString(),
      });

      if (!tokenResp.ok) {
        const err = await tokenResp.text();
        console.error("Token exchange failed:", err);
        res.status(500).send("Token exchange failed");
        return;
      }

      const tokens = (await tokenResp.json()) as {
        access_token: string;
        id_token: string;
        token_type: string;
      };

      // Get user info
      const userResp = await fetch(oidc.userinfo_endpoint, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const userInfo = (await userResp.json()) as {
        sub: string;
        email: string;
        name: string;
      };

      // Store in session
      req.session.accessToken = tokens.access_token;
      req.session.idToken = tokens.id_token;
      req.session.user = {
        email: userInfo.email,
        name: userInfo.name || userInfo.email,
        sub: userInfo.sub,
      };

      // Clean up PKCE state
      delete req.session.state;
      delete req.session.codeVerifier;

      res.redirect("/");
    } catch (err) {
      console.error("Callback error:", err);
      res.status(500).send("Authentication callback error");
    }
  });

  // Logout
  router.get("/logout", async (req: Request, res: Response) => {
    const idToken = req.session.idToken;
    req.session.destroy(() => {});

    try {
      const oidc = await discover();
      const params = new URLSearchParams({
        id_token_hint: idToken || "",
        post_logout_redirect_uri: CALLBACK_URL.replace("/auth/callback", ""),
      });
      res.redirect(`${oidc.end_session_endpoint}?${params.toString()}`);
    } catch {
      res.redirect("/");
    }
  });

  // User info API
  router.get("/me", (req: Request, res: Response) => {
    if (req.session.user) {
      res.json(req.session.user);
    } else {
      res.status(401).json({ error: "Not authenticated" });
    }
  });

  return router;
}

/**
 * Middleware: require authentication. Redirects to /auth/login if not logged in.
 * For API routes, returns 401 JSON instead.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session.user) {
    next();
    return;
  }

  if (req.path.startsWith("/api/")) {
    res.status(401).json({ error: "Not authenticated. Visit /auth/login" });
  } else {
    res.redirect("/auth/login");
  }
}

/**
 * Get the current user's access token from the session.
 * Used by the chat handler to pass identity to the MCP server.
 */
export function getAccessToken(req: Request): string | undefined {
  return req.session.accessToken;
}
