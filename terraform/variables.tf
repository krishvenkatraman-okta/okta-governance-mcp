# =============================================================================
# Infrastructure
# =============================================================================

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-2"
}

variable "domain_name" {
  description = "Domain for the MRS HTTP server"
  type        = string
  default     = "governance-mcp.supersafe-ai.io"
}

variable "hosted_zone_id" {
  description = "Route53 hosted zone ID for supersafe-ai.io"
  type        = string
  default     = "Z00185461V63CVG1AM3GW"
}

variable "vpc_id" {
  description = "VPC to deploy into"
  type        = string
  default     = "vpc-079921c670b3eb522" # taskvantage-oag-vpc
}

variable "public_subnet_ids" {
  description = "Public subnets for the ALB"
  type        = list(string)
  default = [
    "subnet-0124a15b79a7051e8", # oag-public-1 (us-east-2a)
    "subnet-07944f744c1a7e73f", # oag-public-2 (us-east-2b)
  ]
}

variable "private_subnet_ids" {
  description = "Private subnets for Fargate tasks"
  type        = list(string)
  default = [
    "subnet-0ac35fabc02c7ab9d", # oag-private-1 (us-east-2a)
    "subnet-0d47b4bb4cdb1449f", # oag-private-2 (us-east-2b)
  ]
}

variable "container_port" {
  description = "Container port for the MRS HTTP server"
  type        = number
  default     = 3002
}

# =============================================================================
# Okta Configuration
# =============================================================================

variable "okta_domain" {
  description = "Okta org domain (e.g., your-org.okta.com)"
  type        = string
}

variable "okta_client_id" {
  description = "Okta service app client ID"
  type        = string
}

variable "okta_private_key_kid" {
  description = "Key ID for the Okta service app private key"
  type        = string
  default     = ""
}

variable "okta_private_key_pem" {
  description = "PEM-encoded RSA private key for Okta service app"
  type        = string
  sensitive   = true
}

variable "okta_oauth_issuer" {
  description = "Okta OAuth issuer (e.g., https://your-org.okta.com/oauth2/default)"
  type        = string
}

variable "okta_oauth_audience" {
  description = "Expected audience for OAuth tokens"
  type        = string
  default     = "api://mcp-governance"
}
