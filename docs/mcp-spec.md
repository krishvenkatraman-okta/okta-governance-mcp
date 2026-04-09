# Okta Governance MCP Server Specification

## 1. Purpose

This MCP system provides a protected governance control plane for an Okta-based AI agent platform.

It must:

- support enterprise IdP / Cross App style authorization flows
- accept delegated user context from the frontend agent
- use Okta token exchange patterns to obtain an enterprise-controlled authorization artifact
- issue an MCP access token before allowing access to MCP tools
- dynamically expose tools based on the user's Okta role, target scope, reviewer state, and governance policy
- enforce authorization again on every tool invocation

This system is not a generic API relay. It is a policy-enforcing governance plane.

---

## 2. Core Architecture

The MCP system has two logical server roles:

1. **MCP Authorization Server (MAS)**
   - accepts ID-JAG from the frontend agent
   - validates the ID-JAG
   - issues an MCP access token

2. **MCP Resource Server (MRS)**
   - accepts MCP access tokens
   - resolves authorization context
   - returns a filtered tool list
   - executes allowed governance operations

### High-level flow

1. User signs in to the first-party agent with Okta.
2. Agent receives an ID token.
3. Agent exchanges the ID token with Okta for an ID-JAG using the managed connection / token exchange model.
4. Agent sends the ID-JAG to the MCP Authorization Server.
5. MCP Authorization Server validates the ID-JAG and returns an MCP access token.
6. Agent calls the MCP Resource Server with the MCP access token.
7. MCP Resource Server resolves authorization context and exposes only the allowed tools.
8. Every tool invocation is re-authorized server-side.

---

## 3. Important Design Rule

### The frontend agent must NOT call the MCP Resource Server with the ID-JAG directly.

Correct model:

- **ID token** → exchanged with Okta for **ID-JAG**
- **ID-JAG** → presented to **MCP Authorization Server**
- **MCP access token** → presented to **MCP Resource Server**

This separation is required for Cross App / enterprise IdP policy-aware MCP flows.

---

## 4. Trust Model

### 4.1 Frontend Agent
The first-party agent:
- authenticates the user with Okta
- receives an ID token
- performs token exchange with Okta to obtain an ID-JAG
- requests an MCP access token from the MCP Authorization Server

### 4.2 Okta
Okta acts as:
- identity provider
- managed connection / policy decision point
- token exchange authority for the ID token to ID-JAG step

### 4.3 MCP Authorization Server
The MAS:
- validates the ID-JAG
- checks issuer, audience, expiry, signature, and expected claims
- issues an MCP access token for the MCP Resource Server

### 4.4 MCP Resource Server
The MRS:
- validates the MCP access token
- derives user/session identity context
- resolves authorization context from Okta
- returns dynamic tool exposure
- enforces tool execution policy

---

## 5. Dual-Path Platform Model

The overall platform still has two execution paths:

### Path A: End-user direct APIs
Used directly from the frontend with the user's Okta token for:
- search resource catalog
- create/view own access requests
- list/complete assigned reviews
- my security access reviews
- my settings

These are not MCP-governed admin tools.

### Path B: MCP-governed delegated admin APIs
Used for:
- entitlement management
- labels
- collections / bundles
- campaigns / certifications
- delegated request workflows
- request on behalf of other users
- owned-app reporting from syslog
- principal settings / delegates / resource-owner operations
- policy-heavy governance logic

---

## 6. Authentication Components

## 6.1 Okta-managed frontend authentication
The frontend uses OIDC login for the user.

Artifacts:
- ID token
- user access token for end-user direct APIs

## 6.2 Okta token exchange artifact
The frontend exchanges the ID token with Okta and receives an **ID-JAG** or equivalent delegated artifact.

## 6.3 MCP Authorization Server token issuance
The MAS accepts the ID-JAG and mints an MCP access token for the MRS.

## 6.4 Okta API access from MCP
The MCP system uses a separate Okta **service app** for Okta admin/governance API calls.

This service app uses:
- OAuth client credentials
- `private_key_jwt`
- org authorization server
- least-privilege scopes

---

## 7. Authorization Context Model

The MCP Resource Server builds a normalized authorization context.

Example:

```json
{
  "subject": "00u123",
  "roles": {
    "superAdmin": false,
    "appAdmin": true,
    "groupAdmin": false,
    "regularUser": false
  },
  "targets": {
    "apps": ["0oa123", "0oa456"],
    "groups": []
  },
  "reviewer": {
    "hasAssignedReviews": true,
    "hasSecurityAccessReviews": true
  },
  "capabilities": [
    "entitlements.manage.owned",
    "labels.manage.owned",
    "bundles.manage.owned",
    "campaigns.manage.owned",
    "request_for_others.owned",
    "workflow.manage.owned",
    "reports.syslog.owned"
  ]
}
Inputs to authorization context resolution:

delegated identity from MCP token
Okta admin roles
role targets / owned apps
reviewer assignment state
governance policy
resource ownership constraints
8. Dynamic Tool Exposure

The MCP Resource Server must expose only the tools allowed for the current user/session.

8.1 Regular end user

Regular-user self-service stays on the direct API path, not the MCP admin tool path.

The MCP server may expose read-only helper tools such as:

get_tool_requirements
get_operation_requirements
explain_why_tool_is_unavailable
8.2 App owner / delegated admin

Expose only scoped governance tools for owned/targeted apps:

list_owned_apps
manage_owned_app_entitlements
manage_owned_app_labels
create_bundle_for_owned_app
create_campaign_for_owned_app
request_access_for_other_user_on_owned_app
create_access_request_workflow_for_owned_app
generate_owned_app_syslog_report
8.3 Super admin

Expose the broadest governance tool set, still with audit and confirmation for sensitive actions.

8.4 Execution rule

Visibility is not authorization.

Every tool invocation must be re-checked for:

role
target ownership
reviewer status if relevant
governance policy
service-token scope sufficiency
9. Tool Requirements Registry

The MCP system must maintain a tool requirements registry.

Each tool declares:

required Okta OAuth scopes
optional / conditional scopes
required roles or permissions
target constraints
endpoint families
documentation references

Example:

{
  "tool": "manage_owned_app_labels",
  "requiredScopes": [
    "okta.governance.labels.manage",
    "okta.apps.manage"
  ],
  "requiredRoles": [
    "APP_ADMIN",
    "SUPER_ADMIN"
  ],
  "targetConstraints": [
    "must_be_owned_app"
  ],
  "endpointFamilies": [
    "Labels",
    "Applications"
  ]
}
10. LLM Support / Explainability Tools

The MCP Resource Server must expose read-only explainability tools so the LLM can answer:

what scopes are needed for this operation?
why is this tool unavailable?
what is missing for this action?

Required helper tools:

get_tool_requirements
get_operation_requirements
explain_why_tool_is_unavailable
list_available_tools_for_current_user

These tools are metadata-driven and do not mutate governance state.

11. Okta Scope Model for MCP Service App

The MCP service app may need these scopes depending on the enabled tool set.

Core admin scopes
okta.apps.read
okta.apps.manage
okta.groups.read
okta.groups.manage
okta.logs.read
okta.appGrants.read
okta.appGrants.manage
Access request scopes
okta.accessRequests.catalog.read
okta.accessRequests.condition.read
okta.accessRequests.condition.manage
okta.accessRequests.request.read
okta.accessRequests.request.manage
okta.accessRequests.tasks.read
okta.accessRequests.tasks.manage
Governance scopes
okta.governance.accessCertifications.read
okta.governance.accessCertifications.manage
okta.governance.accessRequests.read
okta.governance.accessRequests.manage
okta.governance.assignmentCandidates.read
okta.governance.collections.read
okta.governance.collections.manage
okta.governance.delegates.read
okta.governance.delegates.manage
okta.governance.entitlements.read
okta.governance.entitlements.manage
okta.governance.labels.read
okta.governance.labels.manage
okta.governance.operations.read
okta.governance.principalSettings.read
okta.governance.principalSettings.manage
okta.governance.resourceOwner.read
okta.governance.resourceOwner.manage
okta.governance.riskRule.read
okta.governance.riskRule.manage
okta.governance.securityAccessReviews.admin.read
okta.governance.securityAccessReviews.admin.manage
okta.governance.securityAccessReviews.endUser.read
okta.governance.securityAccessReviews.endUser.manage
okta.governance.settings.read
okta.governance.settings.manage

The runtime should request only the scopes needed for the operation when feasible.

12. Endpoint Families Backing the MCP Server

From the governance collection, the MCP server is designed around these governance management families:

Campaigns
Principal Access
Principal Access - V2
Collections
Labels
Principal Settings

The collection is only the endpoint-catalog source; its placeholder Authorization header/API-key model must be replaced by OAuth service-app execution logic.

13. MAS Responsibilities

The MCP Authorization Server must:

accept the ID-JAG from the client
validate issuer, audience, signature, timestamps, and intended relying party
bind the issued MCP access token to the expected MCP Resource Server audience
return an MCP access token with enough context for the MRS to identify the subject/session
reject untrusted or expired ID-JAGs

Possible implementation note:

in a small deployment, MAS and MRS may live in the same codebase, but they are still separate logical roles and must be modeled separately in code and documentation
14. MRS Responsibilities

The MCP Resource Server must:

validate MCP access tokens
derive the current subject
resolve authorization context
filter the tool list
re-check authorization on every call
obtain an Okta service-app OAuth token when calling Okta APIs
log all privileged actions
15. Runtime Authorization Flow
Client calls tools/list or equivalent entrypoint with MCP access token.
MRS validates MCP access token.
MRS resolves user authorization context.
MRS filters tools based on role, targets, reviewer state, and policy.
MRS returns only allowed tools.
Client calls a tool.
MRS re-checks authorization and scope requirements.
MRS obtains or reuses the appropriate Okta service-app token.
MRS calls the Okta governance/admin API.
MRS returns the result.
16. Security Rules
Never derive final governance scopes from the raw ID token.
Never call the MRS with the ID-JAG directly when following the enterprise IdP / Cross App model.
Never use SSWS tokens for this architecture.
Never expose the full Okta admin API surface as MCP tools.
Always enforce least privilege.
Always validate target ownership and delegated scope.
Always audit privileged actions.
Keep end-user self-service on the direct API path when native end-user APIs exist.
17. Design Principles
Capability over role

Role names alone are insufficient. Capabilities are derived from:

role
targets
reviewer state
policy
Explainability

The LLM must be able to ask the MCP server what a tool requires and why it is or is not available.

Enterprise policy alignment

The architecture must align with managed connection / enterprise IdP control patterns, not bypass them.

Separation of concerns
frontend handles user interaction
Okta handles identity and token exchange
MAS handles MCP token issuance
MRS handles governance policy and tool execution
Okta service app handles downstream admin/governance API access
18. Final Statement

This MCP system supports enterprise-controlled Cross App authorization by separating the ID-JAG exchange flow from MCP resource access. The frontend agent obtains an ID-JAG from Okta, exchanges it with the MCP Authorization Server for an MCP access token, and then uses that token to access the MCP Resource Server. The MCP Resource Server dynamically exposes governance tools based on Okta roles, targets, reviewer assignments, and policy, while privileged Okta API calls are executed using a separate OAuth service app with least-privilege scopes.