# Demo-tenant seed (Terraform)

Provisions a self-contained governance demo dataset in your Okta preview tenant
so the four advanced governance tools (`mine_candidate_roles`,
`detect_entitlement_outliers`, `explain_user_access`, `generate_smart_campaign`)
have something meaningful to operate on.

## What gets created

Everything is prefixed `hack-govmcp-` for easy cleanup.

| Resource           | Count | Notes                                                      |
|--------------------|-------|------------------------------------------------------------|
| Users              | 15    | 3 departments × 5 users, all `STAGED` (no login, no email) |
| Groups             | 6     | 3 dept + `all-employees` + `vpn-users` + `admin`           |
| Group memberships  | 6     | Includes deliberate cross-dept anomalies                   |
| OIDC app           | 1     | `hack-govmcp-acme-app` (custom web app)                    |
| Entitlements       | 2     | `Role` (viewer/editor/admin), `Region` (us/eu)             |
| Entitlement bundles| 3     | `readonly`, `power`, `admin`                               |
| Group→app assigns  | 5     | Drives the multi-path access stories                       |
| Direct user→app    | 2     | Triggers the `directAssignments` campaign rule             |

### Limitation: manager linkage

`manager_id` (the FK that backs the `manager` peer-grouping strategy) is **not
set** by the seed. Terraform's `for_each` graph won't allow a resource to
cross-reference its own instance keys, even when the data forms a DAG. The
seed sets the free-text `manager` display field instead.

Impact: the default peer strategy (`department_title`) and the `department`
strategy work normally — only `peerGroupingStrategy: 'manager'` loses fidelity.
If you need it, run a one-shot script post-apply that PATCHes
`/api/v1/users/{id}` with `profile.managerId`.

### Deliberate anomalies (so the analytics finds something)

- **`sales_user_1`** is a member of `hack-govmcp-admin` — peer-group outlier.
- **`sales_user_2`** has a direct app assignment, no group path — direct-assignment outlier.
- **`fin_user_1`** is in both finance and engineering groups — cross-dept anomaly.

## Prerequisites

1. Terraform ≥ 1.9.
2. The same service-app credentials the MRS uses (`OKTA_CLIENT_ID`,
   `OKTA_PRIVATE_KEY_PATH`, `OKTA_PRIVATE_KEY_KID`, `OKTA_DOMAIN` in `.env`).
3. The service app must hold these scopes — grant them in the Okta admin UI
   under **Applications → \<service app\> → Okta API Scopes**:
   - `okta.users.manage`
   - `okta.groups.manage`
   - `okta.apps.manage`
   - `okta.governance.entitlements.manage` *(skip if your tenant doesn't have
     OIG entitlement management enabled — see fallback below)*

## Run

```bash
# from repo root
./scripts/seed-tenant.sh                 # apply (writes DEMO_APP_ID to .env)
./scripts/seed-tenant.sh --plan          # preview only
./scripts/seed-tenant.sh --destroy       # tear down
./scripts/seed-tenant.sh --skip-entitlements   # if entitlement API errors
```

After apply, `DEMO_APP_ID` is written into `.env` and the demo can be run
immediately:

```bash
npm run demo-advanced
```

## Fallback: entitlements unavailable

If `terraform apply` fails on `okta_entitlement` with a `403` or
`feature-not-enabled` error, your tenant doesn't have OIG entitlement
management on. Re-run with:

```bash
./scripts/seed-tenant.sh --skip-entitlements
```

The seed still produces users, groups, app, and assignments — enough for
`mine_candidate_roles` (clusters by group/app overlap), `detect_entitlement_outliers`
(at the group/app level), `explain_user_access` (group + direct paths), and
the outlier/dormant/direct-assignment rules in `generate_smart_campaign`.
The entitlement-bundle nuance is what's missing.

## State

State lives **locally** in `terraform/demo-seed/terraform.tfstate` — explicitly
*not* in the S3 backend used by `terraform/` (the AWS infra). This is to keep
the seed disposable; if the state file gets corrupt, just `rm -rf
terraform.tfstate*` and re-apply (the prefix-based naming makes the seeded
resources idempotent against a fresh apply, though you may need to manually
delete leftovers via the Okta UI first).
