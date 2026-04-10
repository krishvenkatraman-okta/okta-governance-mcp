# Render Deployment Guide

This guide covers deploying the Okta Governance MCP server to Render.com.

---

## Overview

The MCP server supports two deployment modes:

1. **Stdio Mode** (Local development): Uses stdin/stdout for MCP communication
2. **HTTP Mode** (Production/Cloud): Long-running HTTP server with REST endpoints

**For Render deployment, you MUST use HTTP mode.**

---

## Quick Start

### 1. Build Command

```bash
npm ci && npm run build
```

### 2. Start Command

```bash
npm start
```

This runs `npm run start:mrs-http`, which starts the production HTTP server.

### 3. Environment Variables

Configure these in the Render dashboard:

#### Required Variables

```bash
# Node environment
NODE_ENV=production

# Okta Configuration
OKTA_DOMAIN=your-domain.okta.com
OKTA_CLIENT_ID=your_service_app_client_id

# MCP Token Configuration
MCP_TOKEN_ISSUER=mcp://okta-governance-mas
MCP_TOKEN_AUDIENCE=mcp://okta-governance-mrs

# MRS Server Configuration
MRS_BASE_URL=https://your-app.onrender.com
MRS_SERVER_NAME=okta-governance-mcp
MRS_SERVER_VERSION=1.0.0
```

#### Private Key (Secret File)

Upload your Okta service app private key as a **secret file** in Render:

- **File Name**: `okta-private-key.pem`
- **Mount Path**: `/etc/secrets/okta-private-key.pem`
- **Environment Variable**: `OKTA_PRIVATE_KEY_PATH=/etc/secrets/okta-private-key.pem`

#### MCP Token Signing Keys (Secret Files)

Upload MAS JWT signing keys as secret files:

**Private Key**:
- **File Name**: `mas-private-key.pem`
- **Mount Path**: `/etc/secrets/mas-private-key.pem`
- **Environment Variable**: `MAS_JWT_PRIVATE_KEY_PATH=/etc/secrets/mas-private-key.pem`

**Public Key**:
- **File Name**: `mas-public-key.pem`
- **Mount Path**: `/etc/secrets/mas-public-key.pem`
- **Environment Variable**: `MAS_JWT_PUBLIC_KEY_PATH=/etc/secrets/mas-public-key.pem`

Generate these keys locally:
```bash
npm run generate-keys
# Creates keys/mas-private-key.pem and keys/mas-public-key.pem
```

---

## Render Configuration

### Service Type

**Web Service** (not Background Worker)

### Region

Choose the region closest to your Okta tenant for best performance.

### Instance Type

**Starter** (512 MB RAM) is sufficient for most use cases.

### Health Check Path

```
/health
```

The server exposes a health endpoint that returns:
```json
{
  "status": "healthy",
  "service": "okta-governance-mcp",
  "version": "1.0.0",
  "timestamp": "2026-04-09T12:00:00.000Z"
}
```

### Auto-Deploy

Enable **Auto-Deploy** to automatically deploy when you push to your main branch.

---

## Endpoints

The HTTP server exposes the following endpoints:

### Discovery Endpoint (Public)

```
GET /.well-known/mcp.json
```

Returns MCP server metadata (protocol version, capabilities, authentication).

**Example:**
```bash
curl https://your-app.onrender.com/.well-known/mcp.json
```

### Health Check (Public)

```
GET /health
```

Returns server health status.

### MCP Endpoints (Authenticated)

```
POST /mcp/v1/tools/list
POST /mcp/v1/tools/call
```

Require `Authorization: Bearer <mcp-token>` header.

---

## Port Configuration

The HTTP server binds to:

- **Host**: `0.0.0.0` (required for Docker/cloud hosting)
- **Port**: `process.env.PORT || 3002`

Render automatically sets the `PORT` environment variable. The server will use it.

---

## Deployment Steps

### 1. Create Render Service

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click **New** → **Web Service**
3. Connect your GitHub repository
4. Configure:
   - **Name**: `okta-governance-mcp`
   - **Environment**: `Docker` or `Node`
   - **Region**: Your preferred region
   - **Branch**: `main`
   - **Build Command**: `npm ci && npm run build`
   - **Start Command**: `npm start`

### 2. Configure Environment Variables

Add all required environment variables (see above).

### 3. Upload Secret Files

1. Go to **Environment** → **Secret Files**
2. Upload `okta-private-key.pem`, `mas-private-key.pem`, `mas-public-key.pem`
3. Set mount paths and environment variables

### 4. Deploy

Click **Create Web Service**. Render will:

1. Clone your repository
2. Run build command (`npm ci && npm run build`)
3. Start the server (`npm start`)
4. Expose the service at `https://your-app.onrender.com`

---

## Verification

### 1. Check Health Endpoint

```bash
curl https://your-app.onrender.com/health
```

Expected response:
```json
{
  "status": "healthy",
  "service": "okta-governance-mcp",
  "version": "1.0.0",
  "timestamp": "2026-04-09T12:00:00.000Z"
}
```

### 2. Check Discovery Endpoint

```bash
curl https://your-app.onrender.com/.well-known/mcp.json | jq .
```

Expected response:
```json
{
  "protocolVersion": "2024-11-05",
  "server": {
    "name": "okta-governance-mcp",
    "version": "1.0.0",
    "vendor": "Okta Identity Governance"
  },
  "transport": {
    "type": "http",
    "url": "https://your-app.onrender.com",
    "endpoint": "/mcp/v1"
  },
  "authentication": {
    "required": true,
    "schemes": ["bearer"]
  }
}
```

### 3. Test Authenticated Endpoint

Generate a test token:
```bash
npm run generate-token -- --sub 00u8uqjojqqmM8zwy0g7
```

Call the API:
```bash
curl -X POST https://your-app.onrender.com/mcp/v1/tools/list \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected response:
```json
{
  "tools": [
    {
      "name": "list_owned_apps",
      "description": "List applications owned by the user",
      ...
    }
  ]
}
```

---

## Troubleshooting

### Issue: "Server exits immediately after starting"

**Cause**: Using stdio mode instead of HTTP mode.

**Solution**: Ensure `npm start` runs `npm run start:mrs-http`, not `npm run start:mrs`.

Check `package.json`:
```json
{
  "scripts": {
    "start": "npm run start:mrs-http",
    "start:mrs-http": "NODE_ENV=production node dist/mrs-http.js"
  }
}
```

### Issue: "Cannot connect to server"

**Cause**: Server not binding to `0.0.0.0` or wrong port.

**Solution**: Verify `src/mrs/http-server.ts` binds to:
```typescript
const host = '0.0.0.0';
const port = process.env.PORT || 3002;
app.listen(Number(port), host, ...);
```

### Issue: "Health check failing"

**Cause**: Health endpoint not responding.

**Solution**: Check Render logs for errors. Ensure server starts successfully.

### Issue: "Authentication failing"

**Cause**: Missing environment variables or invalid keys.

**Solution**: Verify all required environment variables are set. Check secret file paths.

### Issue: "JWKS fetch failed"

**Cause**: Server cannot reach Okta JWKS endpoint.

**Solution**: Ensure `ID_JAG_JWKS_URI` is correct and Render can access Okta domain.

---

## Logs

View logs in Render dashboard:

**Dashboard** → **Your Service** → **Logs**

Expected startup logs:
```
🚀 Okta Governance MCP Server
📋 Mode: MRS (HTTP)
🌍 Environment: production

🚀 MCP Resource Server (MRS) - Production HTTP Server
──────────────────────────────────────────────────────────────────────
📍 Port: 10000
🌍 Host: 0.0.0.0
📦 Service: okta-governance-mcp v1.0.0
──────────────────────────────────────────────────────────────────────

✅ Server is running

Endpoints:
  GET  http://0.0.0.0:10000/.well-known/mcp.json
  GET  http://0.0.0.0:10000/health
  POST http://0.0.0.0:10000/mcp/v1/tools/list
  POST http://0.0.0.0:10000/mcp/v1/tools/call

🔐 Authentication: Bearer token (MCP access token from MAS)
```

---

## Security Considerations

1. **Secret Files**: Never commit private keys to Git. Use Render secret files.
2. **Environment Variables**: Use Render environment variables, not `.env` files.
3. **HTTPS**: Render provides HTTPS automatically. Always use HTTPS in production.
4. **Token Validation**: All MCP endpoints require valid bearer tokens.
5. **CORS**: CORS is enabled for browser clients. Restrict in production if needed.

---

## Local Testing

Test the HTTP server locally before deploying:

```bash
# Build
npm run build

# Start HTTP server
npm run start:mrs-http
```

Server runs at `http://localhost:3002`.

Test health endpoint:
```bash
curl http://localhost:3002/health
```

Test discovery endpoint:
```bash
curl http://localhost:3002/.well-known/mcp.json
```

---

## Differences from Stdio Mode

| Feature | Stdio Mode | HTTP Mode |
|---------|-----------|-----------|
| **Transport** | stdin/stdout | HTTP REST API |
| **Use Case** | Local development, CLI tools | Production, cloud hosting |
| **Authentication** | Environment variable | Bearer token in header |
| **Entrypoint** | `src/index.ts` (SERVER_MODE=mrs) | `src/mrs-http.ts` |
| **Start Command** | `npm run start:mrs` | `npm run start:mrs-http` |
| **Port** | N/A | 0.0.0.0:PORT |
| **Health Check** | N/A | GET /health |
| **Discovery** | N/A | GET /.well-known/mcp.json |

---

## Additional Resources

- [Render Documentation](https://render.com/docs)
- [MCP Specification](https://modelcontextprotocol.io)
- [Okta OAuth 2.0 Guide](https://developer.okta.com/docs/guides/implement-oauth-for-okta/main/)
- [Project Smoke Test Guide](./smoke-test.md)
- [MCP Discovery Documentation](./mcp-discovery.md)

---

## Support

For issues or questions:

- **GitHub Issues**: https://github.com/okta/okta-governance-mcp/issues
- **Render Support**: https://render.com/docs/support
- **Okta Support**: https://support.okta.com
