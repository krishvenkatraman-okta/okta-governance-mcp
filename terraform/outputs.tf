output "service_url" {
  description = "Governance MCP server URL"
  value       = "https://${var.domain_name}"
}

output "ecr_repository_url" {
  description = "ECR repository URL"
  value       = aws_ecr_repository.app.repository_url
}

output "alb_dns_name" {
  description = "ALB DNS name"
  value       = aws_lb.app.dns_name
}

output "ecs_cluster" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.app.name
}

output "ecs_service" {
  description = "ECS service name"
  value       = aws_ecs_service.app.name
}

output "health_check_url" {
  description = "Health check endpoint"
  value       = "https://${var.domain_name}/health"
}
