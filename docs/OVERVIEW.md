# Okta Governance MCP — Project Overview

A 10-minute orientation for new contributors. For deeper reading, see [`docs/architecture.md`](architecture.md), [`docs/mcp-spec.md`](mcp-spec.md), and [`docs/mrs-authentication.md`](mrs-authentication.md).

---

## What this is

An AI-assisted Okta governance platform. A user logs in through Okta, an LLM-powered chat agent fronts the experience, and every governance action (listing apps, mining roles, certifying access, etc.) is performed by an MCP Resource Server (MRS) that re-validates Okta authorization on each tool call.

The differentiator: **tool visibility and tool authorization are both driven by the user's Okta capabilities** — the LLM only sees tools the user is entitled to, and the MRS re-checks every call.

---

## Workspaces

The repo is a multi-workspace monorepo. Each workspace has its own `package.json` / `node_modules` (no top-level workspace manifest).

| Workspace   | What it is                                                       | Local port      | Default entrypoint                    |
|-------------|------------------------------------------------------------------|-----------------|---------------------------------------|
| `/` (root)  | MCP Resource Server (TypeScript, ESM). Production HTTP entrypoint. | **9000**        | `npm run start:mrs-http`              |
| `agent/`    | Express chatbot service (Bedrock/Anthropic SDK MCP client).       | **3100**        | `cd agent && npm run dev`             |
| `frontend/` | Next.js 16 governance UI.                                         | **3000**        | `cd frontend && npm run dev`          |

Other ports referenced in code:
- **4000** — LiteLLM proxy (used by `frontend/app/api/chat/route.ts` for tool-calling chat). Either the corporate instance (work laptop) or a local Bedrock-backed proxy via [`docker/litellm/`](../docker/litellm/README.md) (personal laptop).
- **7000 / 7001** — legacy MAS / MRS-stdio companion (rarely used now)

---

## Authentication chain

End-to-end, the user's identity flows through Okta four times before hitting the MRS:

```
1. User → Okta OIDC (PKCE)                            → id_token + user_access_token
2. Frontend → Okta org auth server (token exchange)   → ID-JAG  (private_key_jwt as Agent)
3. Frontend → Okta custom auth server (ID-JAG xchg)   → access_token  (audience: api://mcp-governance)
4. Frontend → MRS  (Authorization: Bearer access_token)
```

The MRS validates the access token via JWKS (`src/oauth/okta-token-validator.ts`), extracts the user, resolves capabilities (`src/policy/capability-mapper.ts`), and exposes only the authorized tool subset. **Tool visibility ≠ authorization** — every call is re-checked in `src/policy/policy-engine.ts`.

Two OAuth clients in `.env` — don't conflate them:
- `OKTA_OAUTH_*` (org/default AS) — used by direct MCP clients
- `ACCESS_TOKEN_*` / `ID_JAG_*` (custom AS) — used by frontend

---

## Component map

```
┌─────────────────────┐        ┌────────────────────┐        ┌──────────────────┐
│  frontend (Next.js) │ ─────▶ │  Okta              │        │ Bedrock/LiteLLM  │
│  :3000              │        │  org AS + custom AS│        │ (LLM)            │
│  - /agent (chat UI) │ ◀───── │  - OIDC + token    │        └────────▲─────────┘
│  - InsightsHub      │        │    exchange        │                 │
│  - /api/mcp/call    │        │  - Governance APIs │     /api/chat ──┘
│  - /api/chat        │        └────────┬───────────┘
└──────────┬──────────┘                 │ admin APIs (private_key_jwt)
           │ Bearer access_token        │
           ▼                            ▼
┌──────────────────────────────────────────────────────────┐
│ MRS (root) — :9000                                       │
│ - HTTP + JSON-RPC tool dispatch (src/mrs/)               │
│ - Tool registry (src/tools/)                             │
│ - Policy engine + capability mapper (src/policy/)        │
│ - Endpoint registry from Postman collection (src/catalog)│
│ - Analytics layer (src/analytics/)                       │
└──────────────────────────────────────────────────────────┘
```

The Postman collection (`postman/Okta Governance API.postman_collection.json`) is **load-bearing** — the MRS HTTP boot fails fast if it's missing or doesn't include the Labels category.

---

## Tools at a glance

Tools live in `src/tools/`, are registered in `src/tools/index.ts`, and have requirements declared in `src/catalog/tool-requirements.ts`.

**Meta / explainability** (always available)
- `get_tool_requirements`, `get_operation_requirements`, `explain_tool_unavailable`, `list_available_tools_for_current_user`

**Implemented governance tools**
- `list_manageable_apps`, `generate_app_activity_report`, `generate_review_candidates`, `manage_app_labels`, `resolve_user`, `check_user_inactive_apps`, `list_manageable_groups`, `list_group_members`, `manage_group_membership`, `manage_group_campaigns`, `create_delegated_access_request`

**Advanced analytics tools** (added in Prompts 1-12)
- `mine_candidate_roles` — clusters users with similar entitlement footprints into proposed roles
- `detect_entitlement_outliers` — flags users whose entitlements diverge from their peer group
- `explain_user_access` — traces every path a user has to a target resource (group → app → entitlement)
- `generate_smart_campaign` — composes outliers + dormant access + direct-assignment rules into a previewable certification campaign

**Stubbed** (auth-checked, execution pending): `manage_app_entitlements`, `manage_app_bundles`, `manage_app_workflows`

---

## InsightsHub (frontend)

Modal launcher on the `/agent` page (`frontend/components/insights/`). Four tabs, each backed by one of the advanced tools:

| Tab        | Component                  | Tool                          |
|------------|----------------------------|-------------------------------|
| Discover   | `RoleMiningResults.tsx`    | `mine_candidate_roles`        |
| Risks      | `OutlierReport.tsx`        | `detect_entitlement_outliers` |
| Explain    | `AccessExplainer.tsx`      | `explain_user_access`         |
| Campaigns  | `SmartCampaignBuilder.tsx` | `generate_smart_campaign`     |

The chat surface also renders **tool-result summary cards** that deep-link into the relevant InsightsHub tab pre-loaded with the result.

---

## Local dev — quick start

```bash
# 0. One-time
cp .env.example .env                # fill in Okta values
cd frontend && cp .env.example .env.local && cd ..
npm install
(cd agent && npm install)
(cd frontend && npm install)
npm run generate-keypair            # MAS keys (legacy, still required)

# 1. Build & start MRS (terminal A)
npm run build && npm run start:mrs-http
# expect: "Available tools: ..." with all advanced tools listed
#         "Server listening on port 9000"

# 2. Start frontend (terminal B)
cd frontend && npm run dev
# open http://localhost:3000/agent

# 3. (optional) Start chatbot agent service (terminal C)
cd agent && npm run dev
```

After login, the frontend auto-runs the **bootstrap flow** (`frontend/app/agent/page.tsx`):
- exchanges `id_token` for ID-JAG, then ID-JAG for an MCP access token
- sets the `okta_mcp_access_token` cookie
- watch the browser console for `[Bootstrap]` log lines if anything stalls

`/api/auth/session` is a useful diagnostic — it shows which tokens the session currently holds.

---

## Demo seed (Terraform)

`terraform/demo-seed/` provisions a realistic dataset into your Okta preview tenant so the analytics tools have variance to find.

**What it creates:** 21 users (3 managers + 18 ICs across 3 departments at 6 ICs/dept), 6 groups, 3 apps (`acme` baseline, `payroll` finance-only, `devtools` engineering-only), group→app assignments, and 4 deliberate outlier users for `detect_entitlement_outliers` to flag.

**Run it:**
```bash
./scripts/seed-tenant.sh                        # full seed
./scripts/seed-tenant.sh --skip-entitlements    # if your tenant doesn't have OIG entitlement-management enabled
```

See `terraform/demo-seed/README.md` for prerequisites (service-app scopes, authentication-policy ID, DPoP off, etc.).

---

## Conventions worth knowing

- **ESM only** (root). TypeScript imports use `.js` extensions because `tsc` doesn't rewrite them: `import { x } from './y.js'`.
- **No SSWS tokens** — all Okta API calls use OAuth.
- **Frontend uses Next.js 16** with breaking changes from earlier versions. Read `frontend/AGENTS.md` and consult `frontend/node_modules/next/dist/docs/` before editing the frontend.
- **Chat path** (`frontend/app/api/chat/route.ts`) calls LiteLLM directly and does its own MCP tool-calling loop. The Express service in `agent/` is **not** on this path — they're parallel chat stacks (`agent/` uses Bedrock direct via the AWS SDK; the frontend uses LiteLLM). For personal-laptop dev without corporate LiteLLM access, run the local Bedrock-backed proxy in [`docker/litellm/`](../docker/litellm/README.md).
- **`*_SUMMARY.md` files at repo root are historical**. Trust code over those docs.
- **`keys/`** is gitignored. Service-app private key is supplied separately.

---

## Deployment

- **Docker**: `Dockerfile` produces an image whose default `CMD` runs `dist/mrs-http.js`.
- **Infra**: `terraform/` (root) provisions ECS Fargate, ECR, CloudWatch.
- **CI/CD**: `.github/workflows/deploy.yml` is `workflow_dispatch`-only. Uses GitHub OIDC → AWS via `AWS_ROLE_ARN` repo secret.

---

## Where to go next

- **Auth deep-dive**: [`docs/mrs-authentication.md`](mrs-authentication.md), [`docs/okta-oauth-implementation.md`](okta-oauth-implementation.md)
- **MCP spec / discovery**: [`docs/mcp-spec.md`](mcp-spec.md), [`docs/mcp-discovery.md`](mcp-discovery.md)
- **Tool requirements model**: [`docs/tool-requirements-registry.md`](tool-requirements-registry.md)
- **Endpoint registry**: [`docs/endpoint-registry-complete.md`](endpoint-registry-complete.md)
- **Advanced-tools spec** (Prompts 1-12 source of truth): [`docs/Okta_Governance_MCP_Spec_Addendum_Advanced_Capabilities.md`](Okta_Governance_MCP_Spec_Addendum_Advanced_Capabilities.md)
- **Original architecture doc** (pre-analytics): [`docs/architecture.md`](architecture.md)
