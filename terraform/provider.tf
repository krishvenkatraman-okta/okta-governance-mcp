terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "taskvantage-prod-tf-state"
    key            = "okta-governance-mcp/terraform.tfstate"
    region         = "us-east-2"
    dynamodb_table = "taskvantage-prod-tf-state-lock"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "okta-governance-mcp"
      ManagedBy = "terraform"
    }
  }
}
