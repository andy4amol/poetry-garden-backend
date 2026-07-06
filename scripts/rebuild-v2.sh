#!/usr/bin/env bash
set -euo pipefail

DB_NAME="${DB_NAME:-poetry-garden-v2}"
R2_BUCKET="${R2_BUCKET:-poetry-garden-content}"
IMPORT_DIR="${IMPORT_DIR:-imports/content}"

echo "This script assumes the D1 database already exists."
echo "Create it first if needed: npx wrangler d1 create $DB_NAME"
echo

echo "Checking R2 availability"
npx wrangler r2 bucket list >/dev/null

echo "Creating R2 bucket if needed: $R2_BUCKET"
npx wrangler r2 bucket create "$R2_BUCKET" || true

echo "Generate D1 SQL and R2 JSON import files"
npm run import:generate -- --out "$IMPORT_DIR" --r2Bucket "$R2_BUCKET"

echo "Apply D1 schema and metadata to: $DB_NAME"
npx wrangler d1 execute "$DB_NAME" --remote --file="$IMPORT_DIR/0000_schema.sql"
node scripts/apply-content-import.mjs --database "$DB_NAME" --dir "$IMPORT_DIR"

echo "Upload R2 content to: $R2_BUCKET"
node scripts/upload-r2-direct.mjs --bucket "$R2_BUCKET" --dir "$IMPORT_DIR" --concurrency "${UPLOAD_CONCURRENCY:-8}" --retries "${UPLOAD_RETRIES:-8}"

echo "Done. Update wrangler.toml database_name/database_id to $DB_NAME if needed, then deploy."
