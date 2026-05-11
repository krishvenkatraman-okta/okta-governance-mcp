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
import { SignJWT, importPKCS8 } from "jose";

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

// XAA token-exchange config: ID token → ID-JAG → MCP access token
const OKTA_DOMAIN = OKTA_ISSUER.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const ORG_TOKEN_ENDPOINT = OKTA_DOMAIN ? `https://${OKTA_DOMAIN}/oauth2/v1/token` : "";
const CUSTOM_AS_ID = process.env.OKTA_CUSTOM_AUTH_SERVER_ID || "";
const CUSTOM_TOKEN_ENDPOINT = OKTA_DOMAIN && CUSTOM_AS_ID
  ? `https://${OKTA_DOMAIN}/oauth2/${CUSTOM_AS_ID}/v1/token`
  : "";
const MCP_AUDIENCE = process.env.OKTA_MCP_AUDIENCE || "";
const MCP_SCOPE = process.env.OKTA_MCP_SCOPE || "governance:mcp";

// Agent principal credentials for private_key_jwt auth on token exchange.
// PEM in .env carries literal "\n" sequences; convert to real newlines.
const AGENT_PRINCIPAL_ID = process.env.OKTA_AGENT_PRINCIPAL_ID || "";
const AGENT_KEY_ID = process.env.OKTA_AGENT_PUBLIC_KEY_ID || "";
const AGENT_PRIVATE_KEY_PEM = (process.env.OKTA_AGENT_PRIVATE_KEY || "").replace(/\\n/g, "\n");

let cachedAgentKey: Awaited<ReturnType<typeof importPKCS8>> | null = null;
async function getAgentSigningKey() {
  if (cachedAgentKey) return cachedAgentKey;
  if (!AGENT_PRIVATE_KEY_PEM) throw new Error("OKTA_AGENT_PRIVATE_KEY not set");
  cachedAgentKey = await importPKCS8(AGENT_PRIVATE_KEY_PEM, "RS256");
  return cachedAgentKey;
}

async function buildAgentClientAssertion(audience: string): Promise<string> {
  // ID-JAG ("Identity-JAG"): iss=sub=principal_id (the AI agent's UD identifier),
  // NOT the OAuth client_id. The agent identity is the subject of the exchange.
  if (!AGENT_PRINCIPAL_ID) throw new Error("OKTA_AGENT_PRINCIPAL_ID not set");
  if (!AGENT_KEY_ID) throw new Error("OKTA_AGENT_PUBLIC_KEY_ID not set");
  const key = await getAgentSigningKey();
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({
    iss: AGENT_PRINCIPAL_ID,
    sub: AGENT_PRINCIPAL_ID,
    aud: audience,
    iat: now,
    exp: now + 300,
    jti: crypto.randomUUID(),
  })
    .setProtectedHeader({ alg: "RS256", kid: AGENT_KEY_ID })
    .sign(key);
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  try {
    const payload = jwt.split(".")[1];
    return JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return {};
  }
}

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

/**
 * Exchange an OIDC id_token for an MCP access token via Okta XAA.
 *
 *  1. id_token + client auth → ORG AS /token (grant=token-exchange, requested=id-jag) → ID-JAG
 *  2. ID-JAG  + client auth → CUSTOM AS /token (grant=jwt-bearer)                    → MCP access_token
 *
 * Okta resolves the agent principal from the OAuth app's UD link automatically;
 * we don't need to send a principal_id explicitly.
 */
async function exchangeForMcpAccessToken(idToken: string): Promise<string> {
  if (!ORG_TOKEN_ENDPOINT || !CUSTOM_TOKEN_ENDPOINT) {
    throw new Error(
      "XAA endpoints not configured. Set OKTA_ISSUER + OKTA_CUSTOM_AUTH_SERVER_ID."
    );
  }
  if (!MCP_AUDIENCE) {
    throw new Error("OKTA_MCP_AUDIENCE not set.");
  }

  // Step 1: id_token → ID-JAG (private_key_jwt auth, per Okta XAA spec)
  const idJagAssertion = await buildAgentClientAssertion(ORG_TOKEN_ENDPOINT);
  console.log("ID-JAG client_assertion claims:", decodeJwtPayload(idJagAssertion));
  const idJagBody = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    requested_token_type: "urn:ietf:params:oauth:token-type:id-jag",
    subject_token: idToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
    audience: MCP_AUDIENCE,
    scope: MCP_SCOPE,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: idJagAssertion,
  });

  const idJagResp = await fetch(ORG_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: idJagBody.toString(),
  });

  if (!idJagResp.ok) {
    const text = await idJagResp.text();
    throw new Error(`ID-JAG exchange failed: ${idJagResp.status} ${text}`);
  }

  const idJag = ((await idJagResp.json()) as { access_token: string }).access_token;

  // Step 2: ID-JAG → MCP access token (custom AS, private_key_jwt auth)
  const accessAssertion = await buildAgentClientAssertion(CUSTOM_TOKEN_ENDPOINT);
  const accessBody = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: idJag,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: accessAssertion,
  });

  const accessResp = await fetch(CUSTOM_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: accessBody.toString(),
  });

  if (!accessResp.ok) {
    const text = await accessResp.text();
    throw new Error(`MCP access-token exchange failed: ${accessResp.status} ${text}`);
  }

  return ((await accessResp.json()) as { access_token: string }).access_token;
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

      // Debug: log id_token + access_token claims so we can verify aud/iss/scopes
      const idClaims = decodeJwtPayload(tokens.id_token);
      const atClaims = decodeJwtPayload(tokens.access_token);
      console.log("OIDC id_token claims:", {
        iss: idClaims.iss,
        aud: idClaims.aud,
        sub: idClaims.sub,
      });
      console.log("OIDC access_token claims:", {
        iss: atClaims.iss,
        aud: atClaims.aud,
        scp: atClaims.scp,
      });

      // XAA exchange: id_token → ID-JAG → MCP access_token (audience = MCP custom AS).
      // We store this MCP access_token instead of the org-AS access_token, since the
      // MCP server validates against the custom AS issuer/audience.
      let mcpAccessToken: string;
      try {
        mcpAccessToken = await exchangeForMcpAccessToken(tokens.id_token);
        console.log("XAA: obtained MCP access token for", userInfo.email);
      } catch (err) {
        console.error("XAA token exchange failed:", err);
        res.status(500).send(`MCP token exchange failed: ${err instanceof Error ? err.message : err}`);
        return;
      }

      // Store in session
      req.session.accessToken = mcpAccessToken;
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
