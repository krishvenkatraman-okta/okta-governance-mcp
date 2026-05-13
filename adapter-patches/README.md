# MCP Adapter Patches

Two patches to the Okta MCP Adapter (v0.14.0) that enable bearer-passthrough
for the Governance end-user API.

## Why

The Okta Governance end-user API (`/api/v1/governance/`) only accepts tokens
from the **Org Authorization Server**. The standard adapter XAA flow produces
custom auth server tokens. These patches let the adapter forward the user's
original Org AS token for specific resources.

## Patches

### 1. `resource_token_resolver.py` — Auth method override

Adds support for per-resource auth method override via environment variable:

```
AUTH_METHOD_OVERRIDE_{RESOURCE_NAME}=bearer-passthrough
```

Example: `AUTH_METHOD_OVERRIDE_OKTA_GOVERNANCE=bearer-passthrough`

When set, the adapter skips XAA token exchange and forwards the user's
Org AS token directly to the downstream MCP server.

### 2. `app.py` — Extra OIDC scopes

Adds `GATEWAY_EXTRA_SCOPES` environment variable support. The adapter
appends these scopes to every OIDC authorize request:

```
GATEWAY_EXTRA_SCOPES=okta.governance.reviewer.read okta.governance.reviewer.manage
```

This ensures the user's Org AS token carries the governance reviewer
permissions needed for the end-user API.

## How to Apply

1. Extract the adapter zip: `unzip okta-agent-mcp-adapter-0.14.0.zip`
2. Replace the two files:
   ```
   cp adapter-patches/resource_token_resolver.py \
      okta-agent-mcp-adapter-0.14.0/okta_agent_proxy/auth/resource_token_resolver.py
   cp adapter-patches/app.py \
      okta-agent-mcp-adapter-0.14.0/okta_agent_proxy/app.py
   ```
3. Rebuild the Docker image
4. Set the environment variables on the ECS task definition:
   - `AUTH_METHOD_OVERRIDE_OKTA_GOVERNANCE=bearer-passthrough`
   - `GATEWAY_EXTRA_SCOPES=okta.governance.reviewer.read okta.governance.reviewer.manage`

## Required Okta Configuration

The adapter's OIDC app needs these Org-level scope grants:
- `okta.governance.reviewer.read`
- `okta.governance.reviewer.manage`

Grant via: `POST /api/v1/apps/{appId}/grants` with
`{"scopeId": "okta.governance.reviewer.read", "issuer": "https://{org}.okta.com"}`
