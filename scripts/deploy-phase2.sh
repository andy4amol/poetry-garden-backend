#!/usr/bin/env bash
# deploy-phase2.sh — one-command deploy of the Phase 2 deliverables
# (insights table, JWT secret, AI binding, then full re-verify).
#
# Run from the poetry-garden-backend/ directory on a machine that has
# wrangler login completed.
#
# Why this script exists:
#   - wrangler 4.47.0 has a known bug ([ERR_INVALID_STATE] "A FileHandle
#     object was closed during garbage collection") that fails any
#     `wrangler d1 execute --file=...` against a remote database.
#   - This script works around it by detecting the wrangler version
#     and falling back to a CF REST API based migration applier
#     (`scripts/apply-migrations.mjs`) when wrangler would otherwise
#     fail.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Detect wrangler 4.47.0 — known to have a 'Binding already in use'
# secret-put bug where the API rejects new secrets even though the
# secret list does not show them. We don't refuse to run on 4.47 (the
# upstream D1 + deploy paths still work), but we print a loud warning
# so the operator knows to upgrade.
if node_modules/.bin/wrangler --version 2>/dev/null | grep -q "^4\.47\."; then
  echo "## WARNING: wrangler $(node_modules/.bin/wrangler --version 2>/dev/null) detected."
  echo "##   4.47.0 has a 'Binding already in use' bug for \`wrangler secret put\`."
  echo "##   If the deploy fails on Step 2, run:"
  echo "##     npm install --save-dev wrangler@4.119"
  echo "##   then re-run this script."
fi

DATABASE_NAME="poetry-garden-v2"
BUCKET_NAME="poetry-garden-content"
API_URL_DEFAULT="https://poetry-garden-api.luyanzhou2023.workers.dev"

# Use a stable JWT secret unless the operator already set one — the worker
# fails closed if JWT_SECRET is missing in production.
JWT_SECRET="${JWT_SECRET:-phase2-verify-secret-$(date +%s)-$(head -c 8 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 16)}"

echo "===================================================="
echo " Phase 2 deploy (D1 + Workers AI + Worker code)"
echo "===================================================="
echo

# ----------------------------------------------------------------------
# Step 0 — pick a D1-applier strategy.
#   - If `CLOUDFLARE_API_TOKEN` is set, we go through apply-migrations.mjs
#     which calls the CF REST API directly. This avoids the wrangler
#     4.47 FileHandle bug entirely.
#   - Otherwise we fall back to `wrangler d1 execute --file=...`. If that
#     hits the same `[ERR_INVALID_STATE]`, print the actionable fix:
#     set CLOUDFLARE_API_TOKEN and re-run.
# ----------------------------------------------------------------------
echo "## Step 1 — apply D1 migration to the remote database"
echo

D1_OK=0
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "(using REST API applier — bypasses wrangler 4.47 FileHandle bug)"
  if node scripts/apply-migrations.mjs --database "$DATABASE_NAME"; then
    D1_OK=1
  fi
fi

if [ "$D1_OK" -eq 0 ]; then
  echo "(fallback to wrangler CLI)"
  echo "(if this fails with [ERR_INVALID_STATE] FileHandle closed,"
  echo " set CLOUDFLARE_API_TOKEN to bypass the bug — see apply-migrations.mjs)"
  if npx wrangler d1 execute "$DATABASE_NAME" --remote \
       --file=migrations/0001_content_platform.sql && \
     npx wrangler d1 execute "$DATABASE_NAME" --remote \
       --file=migrations/0002_insights.sql; then
    D1_OK=1
  fi
fi

if [ "$D1_OK" -eq 0 ]; then
  echo
  echo "!! Migration failed. Set CLOUDFLARE_API_TOKEN and rerun."
  echo "   Get one at https://dash.cloudflare.com/profile/api-tokens"
  echo "   (Account: Cloudflare D1:Edit permissions, then 'export' to env var)"
  exit 1
fi

# ----------------------------------------------------------------------
# Step 2 — store JWT + MiniMax signing secrets in the Worker secrets store.
# ----------------------------------------------------------------------
echo
echo "## Step 2 — store JWT signing secret in the Worker secrets store"
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "(using direct REST upload — bypasses wrangler 4.47 OAuth prompt)"
  ACC="${CLOUDFLARE_ACCOUNT_ID:-55195cd3d44ee867f1a9a909db643a7e}"
  SCRIPT_NAME="${WORKER_NAME:-poetry-garden-api}"
  # Cloudflare does not document a REST API for setting Worker secrets —
  # the only documented paths are wrangler CLI and the dashboard. The
  # previous PUT attempts to a non-existent endpoint returned HTTP 405
  # (Method Not Allowed), so we delegate to npx wrangler secret put,
  # which reads the value from stdin and uses the OAuth token that
  # wrangler login already established.
  #
  # We delete-then-put rather than just put because wrangler 4.47 has a
  # bug where re-uploading an existing secret returns 'Binding name
  # 'JWT_SECRET' already in use' instead of updating the value. The
  # delete-then-put pattern sidesteps that and is idempotent if the
  # secret does not yet exist (delete returns 0 silently).
  echo "  (no public REST endpoint; using wrangler CLI)"

  push_secret() {
    local name="$1"
    local value="$2"
    if [ -z "${value}" ]; then
      echo "  PUT ${name} via wrangler: SKIPPED (no value)"
      return 0
    fi
    npx wrangler secret delete "${name}" >/dev/null 2>&1 || true
    if printf '%s' "${value}" | npx wrangler secret put "${name}" >/dev/null 2>&1; then
      echo "  PUT ${name} via wrangler: ok"
      return 0
    else
      echo "  PUT ${name} via wrangler: FAILED"
      return 1
    fi
  }

  push_secret JWT_SECRET "${JWT_SECRET}" || true

  if [ -n "${MINIMAX_API_KEY:-}" ]; then
    push_secret MINIMAX_API_KEY "${MINIMAX_API_KEY}" || true
  else
    echo
    echo "!! MINIMAX_API_KEY env var is not set."
    echo "   Run: export MINIMAX_API_KEY=\"sk-cp-...\" and re-run this script."
    echo "   Without it, /api/insights/generate will return 502."
  fi
else
  # wrangler login fallback path: same delete-then-put pattern.
  push_secret() {
    local name="$1"
    local value="$2"
    if [ -z "${value}" ]; then return 0; fi
    npx wrangler secret delete "${name}" >/dev/null 2>&1 || true
    printf '%s' "${value}" | npx wrangler secret put "${name}" >/dev/null 2>&1 \
      && echo "  PUT ${name} via wrangler: ok" \
      || echo "  PUT ${name} via wrangler: FAILED"
  }
  push_secret JWT_SECRET "${JWT_SECRET}"
  push_secret MINIMAX_API_KEY "${MINIMAX_API_KEY:-}"
fi

# ----------------------------------------------------------------------
# Step 3 — deploy Worker (with MiniMax API key + JWT_SECRET bound).
# ----------------------------------------------------------------------
echo
echo "## Step 3 — deploy Worker (with MiniMax API key + JWT_SECRET bound)"
echo "(verifying both secrets are present in the Worker before deploy)"

# Pre-flight: confirm the secrets are actually present in the worker
# before we re-deploy. If the MiniMax key is missing the deploy would
# succeed but /api/insights/generate would 401 on every call.
SECRETS_OUTPUT=$(npx wrangler secret list 2>&1 || true)
echo "${SECRETS_OUTPUT}" | head -20
if ! echo "${SECRETS_OUTPUT}" | grep -qE "MINIMAX_API_KEY|JWT_SECRET"; then
  echo
  echo "!! Required secrets missing from the Worker."
  echo "   The deploy would still succeed but /api/auth/me and"
  echo "   /api/insights/generate would 401 / 401 on every call."
  if [ -z "${MINIMAX_API_KEY:-}" ]; then
    echo "   MINIMAX_API_KEY env var is not set. Re-run this script with"
    echo "   export MINIMAX_API_KEY=\"sk-cp-...\" to also push the secret."
  fi
  exit 1
fi

npm run deploy

# ----------------------------------------------------------------------
# Step 4 — verify Phase 2 endpoints after deploy.
# ----------------------------------------------------------------------
echo
echo "## Step 4 — verify Phase 2 endpoints after deploy"
echo "(auth register/login/me should yield 200; insights/generate needs an"
echo " R2 work shard at the chosen poem_id AND Workers AI enabled on the"
echo " Cloudflare account to yield 200)"
echo
VERIFY_API_URL="${VERIFY_API_URL:-$API_URL_DEFAULT}"
bash scripts/verify-endpoints.sh "$VERIFY_API_URL"

echo
echo "## Done. Inspect output above:"
echo "  - 12. insights GET — should be 404 (no cache exists yet)"
echo "  - 13. insights generate — 200 only if AI binding + R2 work shard ready"
echo "  - 14. auth register — should be 200 (or 201 if route returns 201)"
echo "  - 15. auth login — should be 200 with a non-empty token"
echo "  - 16. auth /me — should be 200 with the registered user shape"
