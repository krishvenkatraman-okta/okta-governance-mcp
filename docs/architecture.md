# Okta Governance AI Platform - Architecture

## 1. Objective

Build an AI-driven governance platform using Okta as the identity and governance control plane.

The platform enables:
- End-user self-service access workflows
- Delegated governance for app owners
- Full governance for administrators
- AI-assisted interactions with strict policy enforcement

---

## 2. High-Level Architecture

User → First-Party Agent → Okta → (Dual Path)

                    ┌───────────────────────────────┐
                    │        Okta Platform          │
                    │  - Authentication (OIDC)      │
                    │  - Token Exchange (ID → ID-JAG)│
                    │  - Governance APIs            │
                    │  - Roles / Permissions        │
                    │  - System Logs                │
                    └──────────────┬────────────────┘
                                   │
                ┌──────────────────┴──────────────────┐
                │                                     │
     End User Direct APIs                  MCP System (MAS + MRS)
     (User Token)                         (Delegated Admin Path)
3. Core Components
3.1 First-Party Agent (Frontend)

Responsibilities:

Authenticate users using OIDC (PKCE)
Maintain user session
Handle AI interaction layer
Call:
Okta End User APIs directly (self-service)
MCP system for governance/admin actions
3.2 Okta Platform

Responsibilities:

User authentication
Token issuance (ID token + access token)
Token exchange (ID token → ID-JAG)
Managed connection / Cross App Access policy
Governance APIs (IGA)
Roles, permissions, and resource scoping
System logs for reporting and audit
4. Dual-Path Execution Model
Path A: End-User Direct APIs (User Token)

Used for:

Resource catalog search
My access requests
My assigned certification reviews
My security access reviews
My settings

Characteristics:

Uses user OAuth access token
No MCP involvement
No elevated privileges
Self-service only
Path B: MCP Governance System (Delegated Admin)

Used for:

Entitlement management
Labels
Collections / bundles
Campaigns / certifications
Delegated access requests
Access workflows
Syslog reporting (scoped)
Governance settings and policy operations

Characteristics:

Uses delegated identity via token exchange
Enforced by MCP system
Requires role + target + policy validation
5. MCP System Architecture

The MCP system consists of two logical components:

5.1 MCP Authorization Server (MAS)

Responsibilities:

Accept ID-JAG from frontend agent
Validate:
issuer
audience
signature
expiry
trust relationship
Issue MCP access token
Bind token to MCP Resource Server audience
5.2 MCP Resource Server (MRS)

Responsibilities:

Validate MCP access token
Resolve authorization context
Dynamically expose allowed tools
Enforce governance policy
Call Okta APIs using service-app OAuth
Audit all actions
6. Authentication Flow
User logs in via Okta (OIDC PKCE)
Agent receives:
id_token
user access token
Agent sends id_token to Okta (token exchange)
Okta returns ID-JAG
Agent sends ID-JAG to MCP Authorization Server (MAS)
MAS validates ID-JAG and returns MCP access token
Agent calls MCP Resource Server (MRS) with MCP access token
MRS processes request
7. Important Design Rule

The frontend agent must NOT call the MCP Resource Server with the ID-JAG directly.

Correct flow:

ID token → ID-JAG (Okta)
ID-JAG → MCP Authorization Server
MCP access token → MCP Resource Server
8. Authorization Model

Authorization is enforced inside the MCP Resource Server.

Inputs:

Okta admin roles
Role targets (apps/groups)
Reviewer assignments
Governance policy

Output:

Capability model
Allowed tool set
9. Capability-Based Model

Capabilities determine access.

Regular User
resource_catalog.search
access_requests.self
reviews.assigned
security_access_reviews.self
settings.self.manage
App Owner / Delegated Admin
entitlements.manage.owned
labels.manage.owned
bundles.manage.owned
campaigns.manage.owned
request_for_others.owned
workflow.manage.owned
reports.syslog.owned
Super Admin
Full governance capabilities
10. Dynamic Tool Exposure

The MCP Resource Server:

Resolves authorization context
Filters tools
Returns only allowed tools

Important:

Tool visibility ≠ authorization
Every tool call is revalidated
11. Okta API Access Model
11.1 End-user APIs
Called directly from frontend
Use user access token
11.2 Governance/Admin APIs
Called only from MCP server
Use service-app OAuth

Service App Requirements:

client credentials flow
private_key_jwt
org authorization server
least-privilege scopes
12. Data Sources

The MCP server integrates with:

Roles API
Apps API
Groups API
Governance APIs:
Campaigns
Collections
Labels
Principal Access
Principal Settings
System Log API
13. AI + MCP Interaction Model
AI suggests actions
MCP evaluates permissions
MCP enforces policy
Okta executes
14. Security Principles
Zero trust between frontend and admin APIs
No SSWS tokens
OAuth service app only
Least privilege scopes
Role + target enforcement
Full audit logging
No direct admin API exposure to frontend
15. Separation of Responsibilities
Layer     Responsibility
Frontend Agent User interaction, session
Okta Identity, token exchange, governance APIs
MAS  MCP token issuance
MRS  Policy enforcement, tool execution
Okta Service App    Admin API access
16. Design Principles
Capability over role

Roles are inputs; capabilities drive decisions.

Explainability

System must explain:

required scopes
missing permissions
unavailable tools
Least privilege

Only required scopes and tools are exposed.

Enterprise alignment

Follows Cross App / managed connection model.

17. Final Architecture Statement

The platform uses Okta as the identity and governance control plane, where a first-party AI agent authenticates users and leverages token exchange to obtain delegated identity context. This context is validated by an MCP Authorization Server, which issues an MCP access token. The MCP Resource Server enforces governance policy, resolves user capabilities using Okta roles and resource targets, and dynamically exposes only authorized tools. End-user self-service flows are executed directly using Okta’s end-user APIs, while all delegated administrative actions are enforced through the MCP system.