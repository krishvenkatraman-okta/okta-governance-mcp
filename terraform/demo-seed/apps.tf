resource "okta_app_oauth" "seeded" {
  for_each = local.apps

  label                 = "${local.prefix}-${each.value.label}"
  type                  = "web"
  grant_types           = ["authorization_code", "refresh_token"]
  redirect_uris         = ["https://example.com/callback"]
  response_types        = ["code"]
  consent_method        = "TRUSTED"
  authentication_policy = var.authentication_policy_id
}
