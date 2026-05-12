variable "okta_org_name" {
  type        = string
  description = "Okta org subdomain (e.g. joe-wf-oie-demos)."
}

variable "okta_base_url" {
  type        = string
  description = "Okta base URL (oktapreview.com or okta.com)."
  default     = "oktapreview.com"
}

variable "okta_client_id" {
  type        = string
  description = "Okta service-app client_id (private_key_jwt)."
}

variable "okta_private_key_path" {
  type        = string
  description = "Filesystem path to the service-app PEM private key."
}

variable "okta_private_key_id" {
  type        = string
  description = "Service-app key id (kid) registered in Okta."
}

variable "okta_scopes" {
  type        = list(string)
  description = "OAuth scopes the service app must hold for the seed."
  default = [
    "okta.users.manage",
    "okta.groups.manage",
    "okta.apps.manage",
    "okta.governance.entitlements.manage",
  ]
}

variable "user_email_domain" {
  type        = string
  description = "Email domain to use for seeded users (must be deliverable for Okta validation, but staged users get no email)."
  default     = "example.com"
}

variable "authentication_policy_id" {
  type        = string
  description = "Okta authentication-policy ID (ACCESS_POLICY type) to attach to the seeded app. Required because the provider's default-policy auto-discovery is unreliable in some tenants."
}

variable "skip_entitlements" {
  type        = bool
  description = "Set true if the org does not have OIG entitlement management enabled. Skips entitlement + bundle resources."
  default     = false
}
