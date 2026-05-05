provider "okta" {
  org_name       = var.okta_org_name
  base_url       = var.okta_base_url
  client_id      = var.okta_client_id
  scopes         = var.okta_scopes
  private_key    = file(var.okta_private_key_path)
  private_key_id = var.okta_private_key_id
}
