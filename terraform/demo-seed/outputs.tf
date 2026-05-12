output "demo_app_id" {
  description = "Primary demo app ID (acme — the baseline app everyone has). Set as DEMO_APP_ID before running npm run demo-advanced."
  value       = okta_app_oauth.seeded["acme"].id
}

output "app_ids" {
  description = "All seeded app IDs by key."
  value       = { for k, a in okta_app_oauth.seeded : k => a.id }
}

output "user_ids" {
  description = "Map of seeded user keys to Okta user IDs."
  value       = { for k, u in okta_user.seeded : k => u.id }
}

output "user_logins" {
  description = "Map of seeded user keys to Okta logins."
  value       = { for k, u in okta_user.seeded : k => u.login }
}

output "group_ids" {
  description = "Map of seeded group keys to Okta group IDs."
  value       = { for k, g in okta_group.seeded : k => g.id }
}

output "outlier_user_ids" {
  description = "Users we deliberately seeded as anomalies. Each one breaks their department's typical app pattern, so detect_entitlement_outliers should flag them and explain_user_access has multi-path stories to tell."
  value = {
    eng_user_with_finance_app   = okta_user.seeded["eng_user_1"].id
    finance_user_with_eng_app   = okta_user.seeded["fin_user_1"].id
    sales_user_with_eng_app     = okta_user.seeded["sales_user_2"].id
    sales_user_with_admin_group = okta_user.seeded["sales_user_1"].id
  }
}

output "summary" {
  value = <<-EOT

  ┌─ Seed complete ───────────────────────────────────────────
  │ Apps:   ${length(okta_app_oauth.seeded)} (acme = baseline, payroll = finance, devtools = engineering)
  │ Users:  ${length(okta_user.seeded)} across 3 departments
  │ Groups: ${length(okta_group.seeded)}
  │ Group→app: ${length(okta_app_group_assignment.seeded)}
  │ Direct: ${length(okta_app_user.seeded_direct)} (deliberate outliers)
  │ Bundles: ${var.skip_entitlements ? "skipped" : tostring(length(okta_entitlement_bundle.seeded))}
  │
  │ Next:
  │   export DEMO_APP_ID=${okta_app_oauth.seeded["acme"].id}
  │   npm run demo-advanced
  └───────────────────────────────────────────────────────────
  EOT
}
