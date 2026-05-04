# Okta Governance MCP Server

AI-driven governance platform using Okta as the identity and governance control plane, implementing the Model Context Protocol (MCP) with MAS/MRS separation.

## Architecture

This system implements a dual-server architecture:

- **MCP Authorization Server (MAS)**: Validates ID-JAG tokens and issues MCP access tokens
- **MCP Resource Server (MRS)**: Enforces governance policy and exposes authorized tools

See [docs/architecture.md](docs/architecture.md) and [docs/mcp-spec.md](docs/mcp-spec.md) for detailed architecture documentation.

## Key Features

- **Delegated Identity**: Uses Okta token exchange for enterprise-controlled authorization
- **Dynamic Tool Exposure**: Tools are filtered based on user roles, targets, and governance policy
- **Capability-Based Authorization**: Fine-grained permissions beyond simple role checks
- **Policy Enforcement**: Every tool invocation is re-validated server-side
- **Audit Logging**: Full audit trail for all governance actions
- **Explainability**: LLM can query why tools are available or unavailable

## Prerequisites

- Node.js 20+
- An Okta tenant with Governance features enabled
- Okta service app configured with OAuth client credentials + `private_key_jwt`
- JWT signing keys for MAS token issuance

## Setup

### 1. Clone and Install

```bash
git clone <repository-url>
cd okta-governance-mcp
npm install
```

### 2. Generate Keys

```bash
npm run generate-keypair
```

This creates RSA key pairs in the `keys/` directory for MAS JWT signing.

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your Okta configuration:

- `OKTA_DOMAIN`: Your Okta domain
- `OKTA_CLIENT_ID`: Service app client ID
- `OKTA_PRIVATE_KEY_PATH`: Path to service app private key
- `ID_JAG_ISSUER`, `ID_JAG_AUDIENCE`: ID-JAG validation parameters
- Other settings per `.env.example`

### 4. Parse Postman Collection (Optional)

```bash
npm run parse-postman
```

This extracts governance API endpoints from the Postman collection into the endpoint registry.

## Running Locally

### Development Mode

Run MAS and MRS in separate terminals:

```bash
# Terminal 1: Start MAS
npm run dev:mas

# Terminal 2: Start MRS
npm run dev:mrs
```

### Production Mode

```bash
# Build first
npm run build

# Run MAS or MRS
npm run start:mas
npm run start:mrs
```

## Running with Docker

### Build Image

```bash
docker build -t okta-governance-mcp .
```

### Run MAS

```bash
docker run -p 3000:3000 \
  -e SERVER_MODE=mas \
  -e OKTA_DOMAIN=your-domain.okta.com \
  -e OKTA_CLIENT_ID=your-client-id \
  -v $(pwd)/keys:/app/keys \
  --env-file .env \
  okta-governance-mcp
```

### Run MRS

```bash
docker run -p 3001:3001 \
  -e SERVER_MODE=mrs \
  -e OKTA_DOMAIN=your-domain.okta.com \
  -e OKTA_CLIENT_ID=your-client-id \
  -v $(pwd)/keys:/app/keys \
  --env-file .env \
  okta-governance-mcp
```

## Authentication Flow

1. User authenticates with Okta (OIDC PKCE) via first-party agent
2. Agent receives ID token
3. Agent exchanges ID token with Okta for ID-JAG
4. Agent sends ID-JAG to MAS
5. MAS validates ID-JAG and returns MCP access token
6. Agent calls MRS with MCP access token
7. MRS resolves authorization context and exposes allowed tools

## Available Tools (Metadata/Explainability)

The MRS initially exposes read-only metadata tools:

- `get_tool_requirements`: Get scope/role requirements for a tool
- `get_operation_requirements`: Get requirements for a specific operation
- `explain_why_tool_is_unavailable`: Explain why a tool is not available to the user
- `list_available_tools_for_current_user`: List all tools available to the current user

## Advanced Governance Capabilities

Four analytics-driven MCP tools build on a shared access-graph snapshot to surface insights that go beyond per-API CRUD:

- `mine_candidate_roles`: Cluster users with similar access into proposed roles, ranked by cohesion + size confidence.
- `detect_entitlement_outliers`: Flag users whose entitlements deviate from their peer group (department/title, manager, or department).
- `explain_user_access`: Trace and narrate every path by which a user holds access to a target app, group, or entitlement.
- `generate_smart_campaign`: Compose outliers, dormant access, direct assignments, and recent grants into a previewable certification campaign.

End-to-end demo (live Okta required):

```bash
DEMO_APP_ID=0oaXXXXXXXXXXXX npm run demo-advanced
```

The script builds an access graph for the supplied app, runs each analytics function in turn, pretty-prints the output, and reports per-step elapsed time. Full request/response shapes and authorization plumbing live in [`docs/Okta_Governance_MCP_Spec_Addendum_Advanced_Capabilities.md`](docs/Okta_Governance_MCP_Spec_Addendum_Advanced_Capabilities.md).

## Project Structure

```
src/
├── mas/                    # MCP Authorization Server
├── mrs/                    # MCP Resource Server
├── auth/                   # Token validation and JWT utilities
├── okta/                   # Okta API clients
├── policy/                 # Authorization and policy engine
├── catalog/                # API catalog and tool requirements
├── tools/                  # MCP tool definitions (metadata only)
├── config/                 # Configuration loading
└── types/                  # TypeScript type definitions
```

## Development

### Type Checking

```bash
npm run typecheck
```

### Clean Build

```bash
npm run clean
npm run build
```

## Security Principles

- **Zero Trust**: No direct admin API exposure to frontend
- **Least Privilege**: Only required scopes are used
- **OAuth Only**: No SSWS API tokens
- **Token Exchange**: Enterprise-controlled authorization flow
- **Audit Logging**: All privileged actions are logged
- **Re-authorization**: Every tool call is validated

## API Integrations

The system integrates with:

- **Governance APIs**: Campaigns, Collections, Labels, Entitlements, Access Requests
- **Apps API**: Application management (placeholder)
- **Groups API**: Group management (placeholder)
- **Roles API**: Role and target resolution (placeholder)
- **System Log API**: Audit reporting (placeholder)

## License

MIT
