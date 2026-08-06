#!/usr/bin/env bash
# deploy-phase2.sh — one-command deploy of the Phase 2 deliverables
# (insights table, JWT secret, AI binding, then full re-verify).
#
# Run from the poetry-garden-backend/ directory on a machine that has
# wrangler login completed.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

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

echo "## Step 1 — apply D1 migration to the remote database"
echo "(idempotent: errors on existing tables are skipped)"
echo
npx wrangler d1 execute "$DATABASE_NAME" --remote --file=migrations/0002_insights.sql

echo
echo "## Step 2 — store JWT signing secret in the Worker secrets store"
echo "${JWT_SECRET}" | npx wrangler secret put JWT_SECRET

echo
echo "## Step 3 — deploy Worker (with the [ai] binding + JWT_SECRET binding active)"
npm run deploy

echo
echo "## Step 4 — verify Phase 2 endpoints after deploy"
echo "(auth register/login/me should yield 200; insights/generate needs an"
echo "  R2 work shard at the chosen poem_id AND Workers AI enabled on the"
echo "  Cloudflare account to yield 200)"
echo
bash scripts/verify-endpoints.sh "${VERIFY_API_URL:-$API_URL_DEFAULT}"

echo
echo "## Done. Inspect output above:"
echo "  - 12. insights GET — should be 404 (no cache exists yet)"
echo "  - 13. insights generate — 200 only if AI binding + R2 work shard ready"
echo "  - 14. auth register — should be 200 (or 201 if route returns 201)"
echo "  - 15. auth login — should be 200 with a non-empty token"
echo "  - 16. auth /me — should be 200 with the registered user shape"
