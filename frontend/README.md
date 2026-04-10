# Okta Governance AI Agent - Frontend

Next.js frontend for the Okta Governance MCP platform.

## Overview

This is the web interface for interacting with the Okta Governance MCP server. It provides:
- Secure OIDC + PKCE authentication with Okta
- Token exchange flow (ID token → ID-JAG → access token)
- Dynamic tool discovery and invocation
- Role-based UI based on user capabilities

## Architecture

```
User → Frontend (Next.js)
     ↓
     1. Authenticate with Okta (OIDC/PKCE)
     ↓
     2. Exchange ID token for ID-JAG
     ↓
     3. Exchange ID-JAG for access token
     ↓
     4. Call MCP server with access token
     ↓
Backend MCP Server → Okta Governance APIs
```

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
NEXT_PUBLIC_OKTA_DOMAIN=your-domain.okta.com
NEXT_PUBLIC_OKTA_CLIENT_ID=0oa...
NEXT_PUBLIC_OKTA_CUSTOM_AUTH_SERVER=default
NEXT_PUBLIC_REDIRECT_URI=http://localhost:3000/api/auth/callback
NEXT_PUBLIC_MCP_BASE_URL=http://localhost:3002
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

**Purpose:** Initiates Okta OIDC + PKCE authentication flow

**Will Eventually:**
1. Generate PKCE code verifier and challenge
2. Store code verifier in secure session
3. Build authorization URL with client_id, redirect_uri, scopes, code_challenge
4. Redirect user to Okta authorize endpoint

**Current Status:** Returns placeholder JSON showing expected parameters

---

### `/api/auth/callback` (GET)

**Purpose:** Handles OAuth callback after Okta authentication

**Will Eventually:**
1. Receive authorization code from Okta
2. Verify state parameter (CSRF protection)
3. Retrieve code_verifier from session
4. Exchange authorization code for ID token and access token
5. Store tokens in secure session
6. Redirect to `/agent`

**Current Status:** Returns placeholder JSON showing received code/state

---

### `/api/token/id-jag` (POST)

**Purpose:** Exchange ID token for ID-JAG using Okta token exchange

**Will Eventually:**
1. Retrieve ID token from session
2. POST to Okta token exchange endpoint:
   - grant_type: `urn:ietf:params:oauth:grant-type:token-exchange`
   - subject_token: `<id_token>`
   - subject_token_type: `urn:ietf:params:oauth:token-type:id_token`
   - requested_token_type: `urn:okta:oauth:token-type:id_jag`
   - audience: `api://mcp-governance`
3. Store ID-JAG in session
4. Return success

**Current Status:** Returns placeholder JSON showing token exchange parameters

---

### `/api/token/access-token` (POST)

**Purpose:** Exchange ID-JAG for access token using custom authorization server

**Will Eventually:**
1. Retrieve ID-JAG from session
2. POST to Okta custom auth server token endpoint:
   - grant_type: `urn:ietf:params:oauth:grant-type:token-exchange`
   - subject_token: `<id_jag>`
   - subject_token_type: `urn:okta:oauth:token-type:id_jag`
   - requested_token_type: `urn:ietf:params:oauth:token-type:access_token`
   - audience: `api://mcp-governance`
   - scope: `mcp.governance`
3. Store access token in session
4. Return success

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
NEXT_PUBLIC_OKTA_DOMAIN=your-domain.okta.com
NEXT_PUBLIC_OKTA_CLIENT_ID=0oa...
NEXT_PUBLIC_OKTA_CUSTOM_AUTH_SERVER=default
NEXT_PUBLIC_REDIRECT_URI=https://your-app.vercel.app/api/auth/callback
NEXT_PUBLIC_MCP_BASE_URL=https://your-mcp-server.onrender.com
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

// Access Okta settings
config.okta.domain
config.okta.clientId
config.okta.customAuthServer.tokenEndpoint

// Access MCP settings
config.mcp.baseUrl
config.mcp.endpoints.tools
```

All configuration is loaded from environment variables prefixed with `NEXT_PUBLIC_`.

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
