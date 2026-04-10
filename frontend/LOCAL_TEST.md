# Local Testing Guide - Okta AI Governance Console

## Build Status

✅ **Build Successful** - Next.js 16.2.3 (Turbopack)
- Compiled in 1566ms
- TypeScript validation passed
- All routes generated successfully

## Project Structure

### Routes Built

**Static Pages:**
- `/` - Home page
- `/agent` - Main Okta AI Governance Console UI (with Okta branding)
- `/login` - Login page
- `/_not-found` - 404 page

**API Routes (Server-side):**
- `/api/auth/start` - Initiate OIDC + PKCE authentication
- `/api/auth/callback` - OAuth callback handler
- `/api/token/id-jag` - Exchange ID token for ID-JAG (session-based)
- `/api/token/access-token` - Exchange ID-JAG for MCP access token (session-based)
- `/api/mcp/tools` - Fetch available MCP tools (session-based)
- `/api/demo/client-assertion` - Demo endpoint for client assertion

## Required Environment Variables

Create a `.env.local` file in the `frontend/` directory with these variables:

```bash
# Okta Configuration
NEXT_PUBLIC_OKTA_DOMAIN=dev-12345678.okta.com

# USER OAuth Client (for user authentication)
NEXT_PUBLIC_OKTA_USER_OAUTH_CLIENT_ID=0oa...xyz
# Optional: Only if using confidential client
OKTA_USER_OAUTH_CLIENT_SECRET=secret_here

# Custom Authorization Server
NEXT_PUBLIC_OKTA_CUSTOM_AUTH_SERVER_ID=aus...xyz

# AGENT OAuth Client (for token exchanges with private_key_jwt)
NEXT_PUBLIC_OKTA_AGENT_CLIENT_ID=0oa...abc
NEXT_PUBLIC_OKTA_AGENT_ID=agent_id_here
NEXT_PUBLIC_OKTA_AGENT_KEY_ID=kid_here

# Agent Private Key (choose ONE method)
# Method 1: JWK as JSON string (recommended for production)
AGENT_PRIVATE_KEY_JWK='{"kty":"RSA","n":"...","e":"AQAB","d":"...","p":"...","q":"...","dp":"...","dq":"...","qi":"..."}'

# Method 2: Path to PEM file (for local development)
AGENT_PRIVATE_KEY_PATH=/path/to/private_key.pem

# MCP Server
NEXT_PUBLIC_MCP_BASE_URL=https://your-mcp-server.onrender.com

# OAuth Redirect
NEXT_PUBLIC_REDIRECT_URI=http://localhost:3000/api/auth/callback

# Session Secret (must be at least 32 characters)
SESSION_SECRET=your_super_secret_session_password_at_least_32_chars_long
```

## How to Run Locally

### 1. Install Dependencies

```bash
cd frontend
npm install
```

### 2. Set Up Environment

```bash
# Copy and edit environment variables
cp .env.example .env.local
# Edit .env.local with your actual values
```

### 3. Place Okta Logo

Place your Okta logo image at:
```
frontend/public/okta-logo.png
```

**Logo Requirements:**
- Format: PNG with transparency
- Dimensions: Square aspect ratio (e.g., 512x512px)
- Displayed at: 64x64px with slow rotation animation

### 4. Start Development Server

```bash
npm run dev
```

The app will be available at: **http://localhost:3000**

### 5. Build for Production

```bash
npm run build
npm run start
```

## Complete Browser Test Flow

### Step 1: Open Agent Page

Navigate to: **http://localhost:3000/agent**

You should see:
- Animated Okta logo header
- Blue gradient background
- Login Status: "Not authenticated"
- Token State: All showing "Not available"
- Action buttons (most disabled)

### Step 2: Login with Okta

1. Click **"Login with Okta"** button
2. Browser redirects to Okta login page
3. Enter your Okta credentials
4. Authorize the application
5. Browser redirects back to `/agent` page

**Expected Result:**
- Login Status: "Authenticated" (green indicator)
- User ID and Email displayed
- Token State: "ID Token" shows "Available" (green)
- "Get ID-JAG" button now enabled

### Step 3: Get ID-JAG

1. Click **"Get ID-JAG"** button
2. Wait for success message

**Expected Result:**
- Success alert: "ID-JAG obtained successfully"
- Token State: "ID-JAG" shows "Available" (green)
- "Get MCP Access Token" button now enabled

### Step 4: Get MCP Access Token

1. Click **"Get MCP Access Token"** button
2. Wait for success message

**Expected Result:**
- Success alert: "MCP access token obtained successfully"
- Token State: "MCP Access Token" shows "Available" (green)
- "List MCP Tools" button now enabled

### Step 5: List MCP Tools

1. Click **"List MCP Tools"** button
2. Wait for tools to load

**Expected Result:**
- Success alert: "Successfully loaded X MCP tools"
- Tools list appears below actions section
- Each tool shows:
  - Tool name
  - Description
  - Input schema requirements

### Expected Tools (from MCP Server)

Based on your deployed MCP server, you should see:
- `list_owned_apps` - List applications owned by the user
- `list_entitlements` - List entitlements for an application
- `generate_access_review_candidates` - Generate access review candidates based on risk

## Token Flow Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  1. User Login (OIDC + PKCE)                                │
│     /api/auth/start → Okta → /api/auth/callback             │
│     Result: ID Token + ORG Access Token (in session)        │
└─────────────────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────────────────┐
│  2. ID Token → ID-JAG Exchange                              │
│     POST /api/token/id-jag (session-based)                  │
│     Uses: AGENT client + private_key_jwt                    │
│     Result: ID-JAG (in session)                             │
└─────────────────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────────────────┐
│  3. ID-JAG → MCP Access Token Exchange                      │
│     POST /api/token/access-token (session-based)            │
│     Uses: AGENT client + private_key_jwt                    │
│     Result: MCP Access Token (in session)                   │
└─────────────────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────────────────┐
│  4. Call MCP Server                                         │
│     POST /api/mcp/tools (session-based)                     │
│     Authorization: Bearer <MCP Access Token>                │
│     Result: List of available governance tools              │
└─────────────────────────────────────────────────────────────┘
```

## Security Features

✅ **All tokens stored server-side** - Encrypted session cookies (iron-session)
✅ **No tokens in responses** - UI only receives status and metadata
✅ **No tokens in logs** - Only user IDs and operation status logged
✅ **PKCE for authentication** - Secure authorization code flow
✅ **private_key_jwt for agent** - No client secrets, signed assertions only
✅ **httpOnly session cookies** - Not accessible to JavaScript
✅ **State parameter validation** - CSRF protection

## Troubleshooting

### "Not authenticated" after login

- Check that `SESSION_SECRET` is set and at least 32 characters
- Check that `NEXT_PUBLIC_REDIRECT_URI` matches your callback URL
- Check browser console for errors
- Verify Okta application redirect URI configuration

### "Failed to get ID-JAG"

- Verify `AGENT_PRIVATE_KEY_JWK` or `AGENT_PRIVATE_KEY_PATH` is set correctly
- Check that AGENT client is configured for `private_key_jwt` in Okta
- Verify AGENT client ID and key ID match your Okta configuration
- Check server logs for detailed error messages

### "Failed to get MCP access token"

- Ensure ID-JAG was obtained successfully first
- Verify custom authorization server ID is correct
- Check that custom auth server has `governance:mcp` scope configured

### "Cannot connect to MCP server"

- Verify `NEXT_PUBLIC_MCP_BASE_URL` is set correctly
- Check that MCP server is running and accessible
- Test MCP server directly: `curl https://your-mcp-server.onrender.com/health`
- Verify MCP server is configured to accept tokens from custom auth server

### Build Warnings

**Warning about multiple lockfiles:**
This is harmless. The project has package-lock.json files at different levels.
To silence, remove unused lockfiles or configure `turbopack.root` in `next.config.js`.

## File Structure

```
frontend/
├── app/
│   ├── agent/
│   │   └── page.tsx              # Main UI with Okta branding
│   ├── api/
│   │   ├── auth/
│   │   │   ├── start/route.ts    # OIDC + PKCE initiation
│   │   │   └── callback/route.ts # OAuth callback handler
│   │   ├── token/
│   │   │   ├── id-jag/route.ts   # ID token → ID-JAG exchange
│   │   │   └── access-token/route.ts # ID-JAG → MCP token
│   │   └── mcp/
│   │       └── tools/route.ts    # MCP tools proxy
│   ├── globals.css               # Okta animations
│   └── layout.tsx
├── components/
│   └── AgentHeader.tsx           # Branded header with animated logo
├── lib/
│   ├── config.ts                 # Environment configuration
│   ├── session.ts                # Iron-session management
│   ├── pkce.ts                   # PKCE utilities
│   ├── ui-config.ts              # Okta branding configuration
│   ├── okta-scopes.ts            # Scope definitions
│   └── agent-client-assertion.ts # JWT signing for private_key_jwt
├── public/
│   └── okta-logo.png             # Okta logo (you need to add this)
├── package.json
└── .env.local                    # Environment variables (you need to create)
```

## Changed Files (This Session)

### New Files Created:
1. `lib/session.ts` - Session management with iron-session
2. `lib/pkce.ts` - PKCE utilities for OAuth flow
3. `lib/ui-config.ts` - Okta branding configuration
4. `components/AgentHeader.tsx` - Branded header component
5. `LOCAL_TEST.md` - This file

### Files Updated:
1. `app/agent/page.tsx` - Complete redesign with Okta branding and token flow
2. `app/api/auth/start/route.ts` - Full OIDC + PKCE implementation
3. `app/api/auth/callback/route.ts` - Full OAuth callback implementation
4. `app/api/token/id-jag/route.ts` - Updated to use session-based auth
5. `app/api/token/access-token/route.ts` - Updated to use session-based auth
6. `app/api/mcp/tools/route.ts` - Full MCP proxy implementation
7. `app/globals.css` - Added Okta animation keyframes
8. `package.json` - Added iron-session dependency

## Next Steps (Optional Enhancements)

- [ ] Add token expiration checking and auto-refresh
- [ ] Implement MCP tool invocation (not just listing)
- [ ] Add logout functionality
- [ ] Add session status API endpoint for token state checking
- [ ] Deploy to Vercel/Netlify
- [ ] Add health check endpoint
- [ ] Implement tool execution history
- [ ] Add user profile page

## Support

If you encounter issues:
1. Check server logs: `npm run dev` output
2. Check browser console for client-side errors
3. Verify all environment variables are set correctly
4. Test each API endpoint individually using curl or Postman
5. Ensure Okta configuration matches environment variables
