# Local LiteLLM proxy (for personal-laptop chat)

The frontend's `/api/chat` route requires a LiteLLM-compatible endpoint. This directory runs LiteLLM in Docker, configured to proxy to the **Anthropic API directly** so chat works on a laptop without corporate-LiteLLM access.

## Prerequisites

- Docker Desktop running
- An Anthropic API key — get one at <https://console.anthropic.com/settings/keys>

## Quick start

```bash
# 1. Drop your API key into a local .env (gitignored)
cd docker/litellm
cp .env.example .env
$EDITOR .env   # paste your sk-ant-... key

# 2. Bring up the proxy
docker compose up -d
docker compose logs -f litellm   # Ctrl-C once you see "Uvicorn running on http://0.0.0.0:4000"

# 3. Smoke test
curl http://localhost:4000/health/liveliness
curl -sX POST http://localhost:4000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"claude-sonnet-4-6","messages":[{"role":"user","content":"ping"}],"max_tokens":50}' | jq .

# 4. Add to frontend/.env.local (then restart `npm run dev`)
#    LITELLM_API_BASE=http://localhost:4000
#    LITELLM_MODEL=claude-sonnet-4-6
```

## Stopping

```bash
docker compose down
```

## Configuration files

- `config.yaml` — model_list mapping `claude-sonnet-4-6` → `anthropic/claude-sonnet-4-6` (Anthropic API)
- `docker-compose.yml` — runs LiteLLM, exposes port 4000, reads `.env` for `ANTHROPIC_API_KEY`
- `.env` (gitignored) — your `ANTHROPIC_API_KEY=sk-ant-...`
- `.env.example` — template

To change the model, edit `config.yaml`:
```yaml
model_list:
  - model_name: claude-sonnet-4-6                  # what frontend sends as `model`
    litellm_params:
      model: anthropic/claude-sonnet-4-6           # what LiteLLM sends to Anthropic
      api_key: os.environ/ANTHROPIC_API_KEY
```

`model_name` (the alias the frontend uses) and `LITELLM_MODEL` in `frontend/.env.local` must match.

## Troubleshooting

**`AuthenticationError` / `invalid x-api-key`**
The key in `.env` is wrong, expired, or has trailing whitespace. Re-copy from the Anthropic console.

**`model_not_found` / `404` on `/v1/chat/completions`**
The frontend is sending a model name that's not in `config.yaml`'s `model_list`. Check `LITELLM_MODEL` in `frontend/.env.local` matches `model_name` in `config.yaml`.

**`overloaded_error` / `rate_limit_error`**
Anthropic rate-limited you. Try again, or use a higher-tier API key.

**Chat returns empty**
Check LiteLLM logs (`docker compose logs litellm`) for `drop_params` warnings — Anthropic accepts most OpenAI params, so empties usually mean the request body is missing `messages`.

**Port 4000 already in use**
Change the host side of the port mapping in `docker-compose.yml`: `"4001:4000"`. Update `LITELLM_API_BASE=http://localhost:4001` in `frontend/.env.local`.

## What this does NOT do

- It does not give you the corporate LiteLLM features (auth, logging, cost tracking). It's just an OpenAI-compatible shim over the Anthropic API so the frontend's chat route runs locally.
- It does not affect the `agent/` Express service, which talks to Bedrock directly via the AWS SDK and doesn't use this proxy.
- It does not enforce a budget — you're billed by Anthropic for whatever your key sends. Watch usage in the console.

## Switching back to Bedrock

If you ever need Bedrock instead of Anthropic-direct (e.g. on a corporate-AWS machine), replace the `model:` line and add AWS config:

```yaml
model_list:
  - model_name: claude-sonnet-4-6
    litellm_params:
      model: bedrock/us.anthropic.claude-sonnet-4-6
      aws_region_name: us-east-2
      aws_profile_name: joey
```

…and re-add the `~/.aws` volume mount + `AWS_PROFILE` env var to `docker-compose.yml`. (Bedrock requires submitting an Anthropic use-case form per AWS account before invocations succeed.)
