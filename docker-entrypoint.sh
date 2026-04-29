#!/bin/sh
# Write PEM keys from environment variables to files.
# ECS Fargate pattern: secrets are injected as env vars, but the app
# expects file paths. This script bridges the gap.

if [ -n "$OKTA_PRIVATE_KEY_PEM" ]; then
  mkdir -p /app/keys
  printf '%s\n' "$OKTA_PRIVATE_KEY_PEM" > /app/keys/okta-private-key.pem
  chmod 600 /app/keys/okta-private-key.pem
fi

if [ -n "$MAS_JWT_PRIVATE_KEY_PEM" ]; then
  mkdir -p /app/keys
  printf '%s\n' "$MAS_JWT_PRIVATE_KEY_PEM" > /app/keys/mas-private-key.pem
  chmod 600 /app/keys/mas-private-key.pem
fi

exec "$@"
