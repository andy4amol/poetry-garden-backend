# Poetry Garden Backend v2

This backend is designed for Cloudflare free-tier limits during development:

- D1 stores only dynamic app data: users, collections, and reading history.
- R2 stores the static poem catalog, work bodies, search shards, author lists, and library trees.
- No static poem import is written into D1, so D1 stays far below the 500 MB per-database free limit.
- No D1 FTS table or duplicated full-text content is used.

The current generated full catalog is about 4.53 GB in R2, split into 3,728 objects. D1 is about 57 KB.

## One-Time Cloudflare Setup

Enable R2 in the Cloudflare Dashboard first. Without that, Wrangler will fail with:

```text
Please enable R2 through the Cloudflare Dashboard. [code: 10042]
```

Then create the storage resources:

```bash
npx wrangler d1 create poetry-garden-v2
npx wrangler r2 bucket create poetry-garden-content
```

`wrangler.toml` should bind:

```toml
[[d1_databases]]
binding = "DB"
database_name = "poetry-garden-v2"
database_id = "1a4cc052-a792-4d54-ab1e-32a6632f2a87"

[[r2_buckets]]
binding = "CONTENT"
bucket_name = "poetry-garden-content"
```

## Full Rebuild

Service downtime is acceptable in development, so the cleanest path is a full rebuild into the new D1 plus R2 bucket:

```bash
DB_NAME=poetry-garden-v2 R2_BUCKET=poetry-garden-content npm run db:rebuild:v2
npm run deploy
```

What this does:

1. Generates static catalog JSON under `imports/content/r2`.
2. Applies the small D1 schema only.
3. Uploads all generated JSON objects to R2.
4. Leaves Worker routes reading static content from R2 and dynamic state from D1.

The preferred R2 uploader uses the Cloudflare API directly and supports retries for API throttling:

```bash
UPLOAD_CONCURRENCY=8 UPLOAD_RETRIES=8 npm run r2:upload
```

Use a lower `UPLOAD_CONCURRENCY` if Cloudflare returns repeated 429 throttling errors. The generated Wrangler shell uploader is still available as `npm run r2:upload:wrangler`, but it is much slower because it starts Wrangler for every object.

## Manual Steps

Generate catalog:

```bash
npm run import:generate
```

Apply D1 schema:

```bash
npx wrangler d1 execute poetry-garden-v2 --remote --file=imports/content/0000_schema.sql
```

Upload R2 content:

```bash
npm run r2:upload
```

Deploy:

```bash
npm run deploy
```

## Validation

Check Worker packaging and bindings without deploying:

```bash
npm run deploy -- --dry-run
```

Check generated manifest:

```bash
cat imports/content/manifest.json
```

Expected D1 tables:

```text
users
collections
reading_history
```

## Legacy Database

The old `poetry-garden` D1 database is overweight for the free-tier layout and should not receive new migrations. After the v2 Worker is deployed and verified, it can be deleted from Cloudflare to avoid confusion.
