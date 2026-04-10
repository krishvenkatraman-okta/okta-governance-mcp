# Okta Governance AI Agent - Frontend

Next.js frontend for the Okta Governance MCP platform.

## Overview

This is the web interface for interacting with the Okta Governance MCP server. It provides:
- Secure OIDC + PKCE authentication with Okta
- Token exchange flow (ID token → ID-JAG → access token)
- Dynamic tool discovery and invocation
- Role-based UI based on user capabilities

## Two OAuth Clients Explained

This application uses **TWO separate OAuth clients** for different purposes:

### 1. USER OAuth Client

**Purpose:** User authentication and access token exchange

**Used in:**
- `/api/auth/start` - User login (OIDC + PKCE)
- `/api/auth/callback` - Code exchange for ID token
- `/api/token/access-token` - ID-JAG → access token exchange

**Configuration:**
- `NEXT_PUBLIC_OKTA_USER_OAUTH_CLIENT_ID` (required)
- `OKTA_USER_OAUTH_CLIENT_SECRET` (optional, only for confidential clients)

**Type:** Public client (SPA/PKCE) or Confidential web app

---

### 2. AGENT OAuth Client

**Purpose:** ID-JAG exchange ONLY (on behalf of the AI agent)

**Used in:**
- `/api/token/id-jag` - ID token → ID-JAG exchange

**Configuration:**
- `NEXT_PUBLIC_OKTA_AGENT_CLIENT_ID` (required)
- `NEXT_PUBLIC_OKTA_AGENT_ID` (required)
- `NEXT_PUBLIC_OKTA_AGENT_KEY_ID` (required)
- `AGENT_PRIVATE_KEY_JWK` or `AGENT_PRIVATE_KEY_PATH` (required, server-side only)

**Type:** Confidential client with `private_key_jwt` authentication

**Authentication:** Signed client assertion (JWT signed with agent private key)

---

## Architecture

```
User → Frontend (Next.js)
     ↓
     1. Authenticate with Okta (OIDC/PKCE) → ORG auth server
        [USER OAuth Client]
     ↓
     2. Exchange ID token for ID-JAG → ORG auth server
        [AGENT OAuth Client + signed client assertion]
     ↓
     3. Exchange ID-JAG for access token → CUSTOM auth server
        [USER OAuth Client]
     ↓
     4. Call MCP server with access token
     ↓
Backend MCP Server → Okta Governance APIs
```

### Authorization Servers

**ORG Authorization Server** (`/oauth2/v1/...`):
- Step 1: OIDC + PKCE authentication (USER client)
- Step 2: ID token → ID-JAG exchange (AGENT client with signed assertion)

**CUSTOM Authorization Server** (`/oauth2/{serverId}/v1/...`):
- Step 3: ID-JAG → access token exchange (USER client)
- Default server ID: `default`

### Why Two Clients?

**Separation of concerns:**
- USER client = End user identity and permissions
- AGENT client = AI agent identity and capabilities

**Security:**
- USER client can be public (PKCE, no secret)
- AGENT client uses private_key_jwt (no shared secrets)
- ID-JAG exchange requires agent authentication (proves the agent is authorized)

## Tech Stack

- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Authentication:** Okta OIDC + PKCE
- **Deployment:** Vercel

## Prerequisites

- Node.js 18+ and npm
- Okta tenant with custom authorization server configured
- MCP backend server running (see parent repo)

## Local Development

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Update the values:

```env
# Okta Domain
NEXT_PUBLIC_OKTA_DOMAIN=your-domain.okta.com
NEXT_PUBLIC_OKTA_CUSTOM_AUTH_SERVER_ID=default

# USER OAuth Client (for login and access token exchange)
NEXT_PUBLIC_OKTA_USER_OAUTH_CLIENT_ID=0oa...
# OKTA_USER_OAUTH_CLIENT_SECRET=...  # Optional, server-side only

# AGENT OAuth Client (for ID-JAG exchange only)
NEXT_PUBLIC_OKTA_AGENT_CLIENT_ID=0oa...
NEXT_PUBLIC_OKTA_AGENT_ID=agent-...
NEXT_PUBLIC_OKTA_AGENT_KEY_ID=kid-...
AGENT_PRIVATE_KEY_JWK={"kty":"RSA",...}  # Server-side only

# OAuth Configuration
NEXT_PUBLIC_REDIRECT_URI=http://localhost:3000/api/auth/callback

# MCP Server
NEXT_PUBLIC_MCP_BASE_URL=http://localhost:3002

# Session
SESSION_SECRET=your-random-secret
```

### 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Build for Production

```bash
npm run build
npm start
```

## Routes

### Pages

| Route | Description | Status |
|-------|-------------|--------|
| `/` | Home page with feature overview | ✅ Skeleton |
| `/login` | Login page with Okta sign-in | ✅ Skeleton |
| `/agent` | Main agent interface for tools | ✅ Skeleton |

### API Routes

| Route | Description | Status |
|-------|-------------|--------|
| `/api/auth/start` | Initiates OIDC+PKCE flow, redirects to Okta | 🚧 Placeholder |
| `/api/auth/callback` | OAuth callback handler, exchanges code for tokens | 🚧 Placeholder |
| `/api/token/id-jag` | Exchanges ID token for ID-JAG | 🚧 Placeholder |
| `/api/token/access-token` | Exchanges ID-JAG for access token | 🚧 Placeholder |
| `/api/mcp/tools` | Proxy to MCP server tools endpoint | 🚧 Placeholder |

## Route Details

### `/api/auth/start` (GET)

**OAuth Client:** USER OAuth Client

**Authorization Server:** ORG (`/oauth2/v1/authorize`)

**Purpose:** Initiates Okta OIDC + PKCE authentication flow

**Will Eventually:**
1. Generate PKCE code verifier and challenge
2. Store code verifier in secure session
3. Build authorization URL with:
   - `client_id`: USER OAuth client ID
   - `redirect_uri`, `scopes`, `code_challenge`
4. Redirect user to ORG authorize endpoint: `https://{domain}/oauth2/v1/authorize`

**Current Status:** Returns placeholder JSON showing expected parameters

---

### `/api/auth/callback` (GET)

**OAuth Client:** USER OAuth Client

**Authorization Server:** ORG (`/oauth2/v1/token`)

**Purpose:** Handles OAuth callback after Okta authentication

**Will Eventually:**
1. Receive authorization code from Okta
2. Verify state parameter (CSRF protection)
3. Retrieve code_verifier from session
4. Exchange authorization code for ID token via ORG token endpoint:
   - `client_id`: USER OAuth client ID
   - `code`, `code_verifier`, `redirect_uri`
   - `grant_type=authorization_code`
5. Store ID token in secure session
6. Redirect to `/agent`

**Current Status:** Returns placeholder JSON showing received code/state

---

### `/api/token/id-jag` (POST)

**OAuth Client:** AGENT OAuth Client (NOT the user client)

**Authorization Server:** ORG (`/oauth2/v1/token`)

**Client Authentication:** Signed client assertion (private_key_jwt) - NO client secret required

**Purpose:** Exchange ID token for ID-JAG using Okta token exchange

**Will Eventually:**
1. Retrieve ID token from session (issued to USER client)
2. Build signed client assertion JWT using AGENT private key:
   - Header: `{ alg: "RS256", kid: "{agent_key_id}" }`
   - Claims: `{ iss: "{agent_client_id}", sub: "{agent_client_id}", aud: "{org_token_endpoint}", iat, exp, jti }`
3. POST to ORG token endpoint: `https://{domain}/oauth2/v1/token`:
   - grant_type: `urn:ietf:params:oauth:grant-type:token-exchange`
   - subject_token: `<id_token>` (from USER client)
   - subject_token_type: `urn:ietf:params:oauth:token-type:id_token`
   - requested_token_type: `urn:okta:oauth:token-type:id_jag`
   - audience: `api://mcp-governance`
   - client_assertion_type: `urn:ietf:params:oauth:client-assertion-type:jwt-bearer`
   - client_assertion: `<signed_jwt>` (signed with AGENT private key)
4. Store ID-JAG in session
5. Return success

**Note:** This endpoint uses the AGENT client to exchange the user's ID token for an ID-JAG.

**Current Status:** Returns placeholder JSON showing token exchange parameters

---

### `/api/token/access-token` (POST)

**OAuth Client:** USER OAuth Client (back to the user client)

**Authorization Server:** CUSTOM (`/oauth2/{serverId}/v1/token`)

**Purpose:** Exchange ID-JAG for access token using custom authorization server

**Will Eventually:**
1. Retrieve ID-JAG from session
2. POST to CUSTOM auth server token endpoint: `https://{domain}/oauth2/{serverId}/v1/token`:
   - grant_type: `urn:ietf:params:oauth:grant-type:token-exchange`
   - subject_token: `<id_jag>`
   - subject_token_type: `urn:okta:oauth:token-type:id_jag`
   - requested_token_type: `urn:ietf:params:oauth:token-type:access_token`
   - audience: `api://mcp-governance`
   - scope: `mcp.governance`
   - client_id: `<user_oauth_client_id>` (USER client, not AGENT client)
3. Store access token in session
4. Return success

**Note:** This endpoint uses the USER client ID, not the agent client ID.

**Current Status:** Returns placeholder JSON showing token exchange parameters

---

### `/api/mcp/tools` (GET)

**Purpose:** Proxy to MCP server to list available tools

**Will Eventually:**
1. Retrieve access token from session
2. POST to MCP server: `{MCP_BASE_URL}/mcp/v1/tools/list`
   - Headers: `Authorization: Bearer <access_token>`
3. Return filtered tool list based on user capabilities

**Current Status:** Returns mock tool list for UI development

---

## Folder Structure

```
frontend/
├── app/                      # Next.js App Router
│   ├── page.tsx             # Home page (/)
│   ├── layout.tsx           # Root layout
│   ├── globals.css          # Global styles
│   ├── login/
│   │   └── page.tsx         # Login page (/login)
│   ├── agent/
│   │   └── page.tsx         # Agent interface (/agent)
│   └── api/                 # API routes
│       ├── auth/
│       │   ├── start/
│       │   │   └── route.ts # Start OIDC flow
│       │   └── callback/
│       │       └── route.ts # OAuth callback
│       ├── token/
│       │   ├── id-jag/
│       │   │   └── route.ts # ID-JAG exchange
│       │   └── access-token/
│       │       └── route.ts # Access token exchange
│       └── mcp/
│           └── tools/
│               └── route.ts # MCP tools proxy
├── lib/
│   └── config.ts            # Configuration module
├── public/                  # Static assets
├── .env.example             # Environment template
├── package.json
├── tsconfig.json
├── tailwind.config.ts
└── README.md                # This file
```

## Vercel Deployment

### 1. Connect Repository

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click "New Project"
3. Import your Git repository
4. Select the `frontend` directory as the root directory

### 2. Configure Environment Variables

Add these environment variables in Vercel dashboard:

```
# Okta Domain
NEXT_PUBLIC_OKTA_DOMAIN=your-domain.okta.com
NEXT_PUBLIC_OKTA_CUSTOM_AUTH_SERVER_ID=default

# USER OAuth Client
NEXT_PUBLIC_OKTA_USER_OAUTH_CLIENT_ID=0oa...
# OKTA_USER_OAUTH_CLIENT_SECRET=...  # Optional, server-side only

# AGENT OAuth Client
NEXT_PUBLIC_OKTA_AGENT_CLIENT_ID=0oa...
NEXT_PUBLIC_OKTA_AGENT_ID=agent-...
NEXT_PUBLIC_OKTA_AGENT_KEY_ID=kid-...
AGENT_PRIVATE_KEY_JWK=<your-agent-private-key-jwk>

# OAuth Configuration
NEXT_PUBLIC_REDIRECT_URI=https://your-app.vercel.app/api/auth/callback

# MCP Server
NEXT_PUBLIC_MCP_BASE_URL=https://your-mcp-server.onrender.com

# Session
SESSION_SECRET=<generate-random-secret>
```

### 3. Deploy

```bash
# Deploy via Vercel CLI
npm i -g vercel
vercel

# Or push to main branch for auto-deploy
git push origin main
```

### 4. Update Okta Configuration

After deployment, update your Okta app settings:

**Login Redirect URIs:**
- `https://your-app.vercel.app/api/auth/callback`

**Logout Redirect URIs:**
- `https://your-app.vercel.app`

**Trusted Origins:**
- Origin: `https://your-app.vercel.app`
- Type: CORS

## Configuration

The app uses a centralized configuration module in `lib/config.ts`:

```typescript
import { config } from '@/lib/config';

// Okta domain
config.okta.domain

// USER OAuth client (login + access token exchange)
config.okta.userOAuthClient.clientId
config.okta.userOAuthClient.clientSecret  // Optional, server-side only

// AGENT OAuth client (ID-JAG exchange only)
config.okta.agent.clientId
config.okta.agent.keyId
config.okta.agent.privateKeyJwk  // Server-side only

// ORG auth server (OIDC + ID-JAG exchange)
config.okta.orgAuthServer.authorizeEndpoint
config.okta.orgAuthServer.tokenEndpoint

// CUSTOM auth server (access token exchange)
config.okta.customAuthServer.tokenEndpoint

// MCP server
config.mcp.baseUrl
config.mcp.endpoints.tools
```

All configuration is loaded from environment variables. Public settings use `NEXT_PUBLIC_` prefix, server-side settings (like private keys and secrets) do not.

## Current Status

**✅ Completed:**
- Next.js app scaffold
- Page routing structure
- API route structure
- Configuration module
- Placeholder UI components
- Tailwind CSS styling

**🚧 TODO (Later):**
- PKCE implementation (code verifier, challenge)
- Session management (cookies or server-side session)
- Okta OIDC integration
- Token exchange implementation (ID → ID-JAG → access token)
- MCP server integration
- Tool invocation UI
- Error handling and loading states
- User profile display
- Logout functionality

## Development Notes

### PKCE Flow

Will use:
- Code verifier: Random 43-128 character string
- Code challenge: Base64URL(SHA256(code_verifier))
- Code challenge method: S256

### Session Management

Options to implement:
1. **Iron Session** (recommended) - Encrypted cookies
2. **NextAuth.js** - Full auth library (may be overkill)
3. **Custom JWT cookies** - Simple but needs careful implementation

### Token Storage

Tokens will be stored server-side in encrypted session cookies:
- ID token (from Okta)
- ID-JAG (from token exchange)
- Access token (for MCP server)

Never expose tokens to client-side JavaScript.

## Troubleshooting

### Port Already in Use

```bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill -9
```

### CORS Errors

Ensure Okta Trusted Origins includes your frontend URL with CORS enabled.

### Token Exchange Fails

Verify:
1. Custom authorization server is configured in Okta
2. Token exchange grant type is enabled
3. Audience `api://mcp-governance` is configured
4. Scopes include `mcp.governance`

## Support

For issues or questions:
- **Backend:** See parent repo README
- **Okta Setup:** See `docs/smoke-test.md` in parent repo
- **Vercel Deploy:** https://vercel.com/docs

## License

MIT
