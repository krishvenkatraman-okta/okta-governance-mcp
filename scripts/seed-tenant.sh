#!/usr/bin/env bash
# Wrapper around terraform/demo-seed/.
#
# Reads .env at the repo root, maps OKTA_* vars to TF_VAR_* vars, then runs
# terraform apply (default) or destroy (with --destroy).
#
# Usage:
#   scripts/seed-tenant.sh             # apply
#   scripts/seed-tenant.sh --destroy   # destroy
#   scripts/seed-tenant.sh --plan      # plan only
#   scripts/seed-tenant.sh --skip-entitlements   # set TF_VAR_skip_entitlements=true

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SEED_DIR="$REPO_ROOT/terraform/demo-seed"
ENV_FILE="$REPO_ROOT/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ $ENV_FILE not found." >&2
  exit 1
fi

# Strip inline comments (`# foo` after the value) from a single env line.
strip_comment() {
  sed -E 's/[[:space:]]+#.*$//' <<<"$1"
}

read_env() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" | head -n1 || true)"
  if [[ -z "$line" ]]; then
    echo "❌ $key missing from .env" >&2
    exit 1
  fi
  strip_comment "${line#${key}=}"
}

OKTA_DOMAIN="$(read_env OKTA_DOMAIN)"
OKTA_CLIENT_ID="$(read_env OKTA_CLIENT_ID)"
OKTA_PRIVATE_KEY_PATH="$(read_env OKTA_PRIVATE_KEY_PATH)"
OKTA_PRIVATE_KEY_KID="$(read_env OKTA_PRIVATE_KEY_KID)"
OKTA_DEFAULT_AUTH_POLICY_ID="$(read_env OKTA_DEFAULT_AUTH_POLICY_ID)"

# Split joe-wf-oie-demos.oktapreview.com into org + base.
ORG_NAME="${OKTA_DOMAIN%%.*}"
BASE_URL="${OKTA_DOMAIN#*.}"

# Resolve relative private-key path against repo root.
if [[ "$OKTA_PRIVATE_KEY_PATH" != /* ]]; then
  OKTA_PRIVATE_KEY_PATH="$REPO_ROOT/${OKTA_PRIVATE_KEY_PATH#./}"
fi
if [[ ! -f "$OKTA_PRIVATE_KEY_PATH" ]]; then
  echo "❌ Private key not found at $OKTA_PRIVATE_KEY_PATH" >&2
  exit 1
fi

export TF_VAR_okta_org_name="$ORG_NAME"
export TF_VAR_okta_base_url="$BASE_URL"
export TF_VAR_okta_client_id="$OKTA_CLIENT_ID"
export TF_VAR_okta_private_key_path="$OKTA_PRIVATE_KEY_PATH"
export TF_VAR_okta_private_key_id="$OKTA_PRIVATE_KEY_KID"
export TF_VAR_authentication_policy_id="$OKTA_DEFAULT_AUTH_POLICY_ID"

ACTION="apply"
EXTRA_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --destroy)            ACTION="destroy" ;;
    --plan)               ACTION="plan" ;;
    --skip-entitlements)  export TF_VAR_skip_entitlements="true" ;;
    *)                    EXTRA_ARGS+=("$arg") ;;
  esac
done

cd "$SEED_DIR"

if [[ ! -d .terraform ]]; then
  terraform init
fi

case "$ACTION" in
  plan)
    terraform plan ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}
    ;;
  apply)
    terraform apply -auto-approve ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}

    APP_ID="$(terraform output -raw demo_app_id)"
    echo
    echo "Writing DEMO_APP_ID=$APP_ID to .env"
    if grep -qE "^DEMO_APP_ID=" "$ENV_FILE"; then
      # macOS sed needs the empty extension arg.
      sed -i.bak -E "s|^DEMO_APP_ID=.*|DEMO_APP_ID=$APP_ID|" "$ENV_FILE"
      rm -f "$ENV_FILE.bak"
    else
      printf '\nDEMO_APP_ID=%s\n' "$APP_ID" >> "$ENV_FILE"
    fi
    ;;
  destroy)
    terraform destroy -auto-approve ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}
    if grep -qE "^DEMO_APP_ID=" "$ENV_FILE"; then
      sed -i.bak -E "/^DEMO_APP_ID=/d" "$ENV_FILE"
      rm -f "$ENV_FILE.bak"
    fi
    ;;
esac
