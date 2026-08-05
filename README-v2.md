# Poetry Garden Backend v2

This backend is designed for Cloudflare free-tier limits during development:

- D1 stores only dynamic app data: users, collections, and reading history.
- R2 stores the static poem catalog, work bodies, search shards, author lists, and library trees.
- No static poem import is written into D1, so D1 stays far below the 500 MB per-database free limit.
- No D1 FTS table or duplicated full-text content is used.

The current generated full catalog is about 4.53 GB in R2, split into 3,728 objects. D1 is about 57 KB.

## Storage Strategy (v3)

- **R2 holds the catalog in `traditional` only.** Pre-computing both `*_simplified`
  variants roughly doubled the catalog. To stay under the Cloudflare free-tier
  storage cap, `generate-content-import.mjs` no longer calls `opencc-js/t2cn`
  on every field; it writes `null` placeholders for every `*_simplified` field.
- **The front-end converts on demand.** `src/lib/display.ts`, `prose`,
  `classical` and `classical/[id]` route through `opencc-js` at render time.
  First paint of a long poem may add ~80 ms on the client, but R2 stays cheap.
- **List pages use a slim projection.** `/api/works/compact` and
  `/api/works/compact/popular` return an 8-field projection of `WorkSummary`
  (no `*_simplified`, no `content_traditional` body, no `notes`, no `metadata`)
  so list payloads drop by 5–10× and R2 Class-B reads fit comfortably in the
  free tier.
- **Bulk id lookups for shelves.** `/api/works/compact?ids=a,b,c` returns up
  to 128 compact works in one round-trip, replacing the per-id fan-out that
  collections/history pages used to do.

## Data Sources

The generator supports two pipelines sharing the same R2 layout:

- **Default** (`npm run import:generate`): a curated subset of `chinese-poetry`
  was scaffolded under `scripts/legacy-*` and pre-rendered earlier — the
  generator still reads from `../chinese-poetry` to keep that subset stable.
- **Full ingest** (`npm run import:generate:full`): pulls every chunk file
  under `../chinese-poetry`, including `全唐诗/poet.*.N.json` (Tang+Song
  poetry), `宋词/ci.song.N.json` (~21k ci), `五代诗词/huajianji/*-juan.json`
  + `nantang/poetrys.json`, `元曲/yuanqu.json`, `楚辞/chuci.json`,
  `诗经/shijing.json`, `四书五经/*.json` (Daxue / Zhongyong / Mengzi),
  `论语/lunyu.json`, `蒙学/*.json` (incl. `tangshisanbaishou.json`),
  `幽梦影/youmengying.json`, `曹操/caocao.json`, `纳兰性德/*诗集.json`,
  `水墨唐诗/shuimotangshi.json`, `御定全唐詩/json/N.json`,
  `rank/poet/*` and `rank/ci/*` (attached as `popularity_score` +
  `rank_metrics`), `strains/json/*` (attached as `strains` on each work).
  The full ingest writes into `imports/content/v3/` and is uploaded with
  `npm run r2:upload:v3`.


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

### v3 full ingest (chinese-poetry → R2)

Validate the generator before doing a full upload by running a 5,000-record
sample (writes to `imports/content/v3-sample/`):

```bash
npm run import:sample:full
# Inspect the manifest: cat imports/content/v3-sample/manifest.json
# Look for shape errors: any *_simplified field should be null.
```

When that looks clean, generate the full catalog (~50 MB sources → ~5 GB R2
output) and upload with retries enabled:

```bash
npm run import:generate:full
UPLOAD_CONCURRENCY=16 UPLOAD_RETRIES=8 npm run r2:upload:v3
```

The wrapper ignores `--limit` to run the full corpus, and the `UPLOAD_*`
environment variables control the R2-concurrency / 429 backoff.



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
