# =============================================================================
# Okta Governance MCP Server — ECS Fargate Infrastructure
# =============================================================================
# Single-service deployment: MRS HTTP server (stateless, no database).
# =============================================================================

# ---------------------------------------------------------------------------
# ACM Certificate
# ---------------------------------------------------------------------------
resource "aws_acm_certificate" "app" {
  domain_name       = var.domain_name
  validation_method = "DNS"
  lifecycle { create_before_destroy = true }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.app.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }
  zone_id = var.hosted_zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 300
  records = [each.value.record]
}

resource "aws_acm_certificate_validation" "app" {
  certificate_arn         = aws_acm_certificate.app.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

# ---------------------------------------------------------------------------
# ECR Repository
# ---------------------------------------------------------------------------
resource "aws_ecr_repository" "app" {
  name                 = "okta-governance-mcp"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = false
  }
}

# ---------------------------------------------------------------------------
# Security Groups
# ---------------------------------------------------------------------------
resource "aws_security_group" "alb" {
  name        = "okta-gov-mcp-alb"
  description = "ALB for Okta Governance MCP"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTP (redirect)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# All ingress rules MUST be inline — standalone rules conflict with inline
# and get deleted on every apply.
resource "aws_security_group" "fargate" {
  name        = "okta-gov-mcp-fargate"
  description = "Fargate tasks for Okta Governance MCP"
  vpc_id      = var.vpc_id

  ingress {
    description     = "MRS HTTP from ALB"
    from_port       = var.container_port
    to_port         = var.container_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ---------------------------------------------------------------------------
# ALB
# ---------------------------------------------------------------------------
resource "aws_lb" "app" {
  name               = "okta-gov-mcp"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.app.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.app.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.app.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_target_group" "app" {
  name        = "okta-gov-mcp"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/health"
    interval            = 30
    timeout             = 10
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }
}

# ---------------------------------------------------------------------------
# Route53
# ---------------------------------------------------------------------------
resource "aws_route53_record" "app" {
  zone_id = var.hosted_zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_lb.app.dns_name
    zone_id                = aws_lb.app.zone_id
    evaluate_target_health = true
  }
}

# ---------------------------------------------------------------------------
# ECS Cluster
# ---------------------------------------------------------------------------
resource "aws_ecs_cluster" "app" {
  name = "okta-governance-mcp"
}

# ---------------------------------------------------------------------------
# IAM Roles
# ---------------------------------------------------------------------------
resource "aws_iam_role" "ecs_execution" {
  name = "okta-gov-mcp-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "ecs_task" {
  name = "okta-gov-mcp-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

# ---------------------------------------------------------------------------
# CloudWatch Logs
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/okta-governance-mcp"
  retention_in_days = 14
}

# ---------------------------------------------------------------------------
# ECS Task Definition
# ---------------------------------------------------------------------------
resource "aws_ecs_task_definition" "app" {
  family                   = "okta-governance-mcp"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name  = "okta-governance-mcp"
    image = "${aws_ecr_repository.app.repository_url}:latest"

    portMappings = [{
      containerPort = var.container_port
      protocol      = "tcp"
    }]

    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "SERVER_MODE", value = "mrs" },
      { name = "PORT", value = tostring(var.container_port) },
      { name = "MRS_BASE_URL", value = "https://${var.domain_name}" },
      { name = "MRS_SERVER_NAME", value = "okta-governance-mcp" },
      { name = "MRS_SERVER_VERSION", value = "1.0.0" },
      # MCP HTTP
      { name = "MCP_HTTP_ENABLED", value = "true" },
      { name = "MCP_HTTP_PORT", value = tostring(var.container_port) },
      { name = "MCP_HTTP_BASE_URL", value = "https://${var.domain_name}" },
      { name = "MCP_RESOURCE_IDENTIFIER", value = "https://${var.domain_name}/mcp" },
      # Okta
      { name = "OKTA_DOMAIN", value = var.okta_domain },
      { name = "OKTA_CLIENT_ID", value = var.okta_client_id },
      { name = "OKTA_PRIVATE_KEY_KID", value = var.okta_private_key_kid },
      { name = "OKTA_PRIVATE_KEY_PATH", value = "/app/keys/okta-private-key.pem" },
      { name = "OKTA_TOKEN_URL", value = "https://${var.okta_domain}/oauth2/v1/token" },
      { name = "OKTA_SCOPES_DEFAULT", value = "okta.users.read okta.apps.read okta.groups.read okta.groups.manage okta.roles.read okta.logs.read" },
      # OAuth validation
      { name = "OKTA_OAUTH_ISSUER", value = var.okta_oauth_issuer },
      { name = "OKTA_OAUTH_JWKS_URI", value = "${var.okta_oauth_issuer}/v1/keys" },
      { name = "OKTA_OAUTH_AUDIENCE", value = var.okta_oauth_audience },
      { name = "ACCESS_TOKEN_ISSUER", value = var.okta_oauth_issuer },
      { name = "ACCESS_TOKEN_AUDIENCE", value = var.okta_oauth_audience },
      { name = "ACCESS_TOKEN_JWKS_URI", value = "${var.okta_oauth_issuer}/v1/keys" },
      # PEM key injected via entrypoint script
      { name = "OKTA_PRIVATE_KEY_PEM", value = var.okta_private_key_pem },
      # Features
      { name = "ENABLE_AUDIT_LOGGING", value = "true" },
      { name = "ENABLE_POSTMAN_CATALOG", value = "true" },
      { name = "LOG_LEVEL", value = "info" },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.app.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }

    linuxParameters = {
      initProcessEnabled = true
    }
  }])
}

# ---------------------------------------------------------------------------
# ECS Service
# ---------------------------------------------------------------------------
resource "aws_ecs_service" "app" {
  name            = "okta-governance-mcp"
  cluster         = aws_ecs_cluster.app.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 60

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.fargate.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "okta-governance-mcp"
    container_port   = var.container_port
  }

  depends_on = [aws_lb_listener.https]
}
