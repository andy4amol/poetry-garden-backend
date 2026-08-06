#!/usr/bin/env node
// prune-stale-r2.mjs — remove R2 objects that are no longer in the catalog
// manifest. Useful after a major import refactor (e.g. v2 → v3) when old
// keys linger.
//
// Usage:
//   node scripts/prune-stale-r2.mjs                                    # dry-run
//   node scripts/prune-stale-r2.mjs --execute                          # actually delete
//   node scripts/prune-stale-r2.mjs --manifest path/to/r2-manifest.json
//   node scripts/prune-stale-r2.mjs --bucket name --concurrency 16
//
// Default: dry-run mode. Pass --execute to perform deletion.

import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const accountId = args.account || process.env.CLOUDFLARE_ACCOUNT_ID || "55195cd3d44ee867f1a9a909db643a7e";
const bucket = args.bucket || "poetry-garden-content";
const manifestPath = path.resolve(args.manifest || "imports/content/v3/r2-manifest.json");
const execute = args.execute === true || args["no-dry-run"] === true;
const concurrency = Number(args.concurrency || process.env.PRUNE_CONCURRENCY || 8);
const logPath = path.join(path.dirname(manifestPath), "prune-stale-r2.log");
const token = process.env.CLOUDFLARE_API_TOKEN || readWranglerOAuthToken();

if (!token) {
  console.error("No Cloudflare token found. Run `npx wrangler login` or set CLOUDFLARE_API_TOKEN.");
  process.exit(1);
}

if (!fs.existsSync(manifestPath)) {
  console.error(`Manifest not found at ${manifestPath}. Run the generator first.`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const want = new Set(manifest.map((m) => m.key));

console.log(`Bucket : ${bucket}`);
console.log(`Account: ${accountId}`);
console.log(`Manifest: ${manifest.length} keys (canonical)`);
console.log(`Mode: ${execute ? "EXECUTE (deleting)" : "DRY-RUN (no deletion)"}`);
console.log("");

console.log("Listing R2 objects...");
const allR2Keys = await listAllKeys(accountId, bucket, token);
console.log(`R2 actual size: ${allR2Keys.length} objects`);

const stale = allR2Keys.filter((k) => !want.has(k));
console.log(`Stale objects to delete: ${stale.length}`);

if (stale.length === 0) {
  console.log("Nothing to clean up.");
  process.exit(0);
}

const deletedSize = await estimateSize(stale, accountId, bucket, token);
console.log(`Estimated size to reclaim: ${(deletedSize / 1024 / 1024).toFixed(2)} MiB`);

if (!execute) {
  console.log("");
  console.log("DRY RUN — passing --execute (or --no-dry-run) will delete these keys.");
  console.log("First 30 stale keys:");
  stale.slice(0, 30).forEach((k) => console.log("  " + k));
  process.exit(0);
}

fs.writeFileSync(logPath, `prune run at ${new Date().toISOString()}\n`);

let idx = 0;
let deleted = 0;
let failed = 0;

async function worker() {
  while (idx < stale.length) {
    const k = stale[idx++];
    const ok = await deleteObject(k);
    if (ok) deleted++;
    else failed++;
    if ((deleted + failed) % 50 === 0) {
      console.log(`  progress: ${deleted + failed}/${stale.length} (deleted=${deleted} failed=${failed})`);
    }
  }
}

const workers = Array.from({ length: concurrency }, () => worker());
await Promise.all(workers);

console.log("");
console.log(`Done. Deleted: ${deleted}  Failed: ${failed}`);
console.log(`Log written to ${logPath}`);
console.log("Run `bash scripts/verify-endpoints.sh` to confirm the bucket still serves all manifests.");

if (failed > 0) process.exit(1);

async function listAllKeys(accountId, bucket, token) {
  const out = [];
  let cursor;
  do {
    const params = new URLSearchParams({ per_page: "1000" });
    if (cursor) params.set("cursor", cursor);
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects?${params}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(`R2 list failed: ${JSON.stringify(json)}`);
    }
    out.push(...json.result.map((o) => o.key));
    cursor = json.result && json.result.length === 1000
      ? json.result[json.result.length - 1].key
      : null;
  } while (cursor);
  return out;
}

async function deleteObject(key) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${encodeURI(key)}`;
  const res = await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    fs.appendFileSync(logPath, `FAIL  ${key}  ${res.status}\n`);
    return false;
  }
  fs.appendFileSync(logPath, `OK    ${key}\n`);
  return true;
}

async function estimateSize(keys, accountId, bucket, token) {
  // Cheap estimate: sum only the first 100 stale keys via HEAD; ignore the rest.
  const sample = keys.slice(0, 100);
  let total = 0;
  let counted = 0;
  for (const k of sample) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${encodeURI(k)}`;
    const res = await fetch(url, { method: "HEAD", headers: { Authorization: `Bearer ${token}` } });
    const cl = Number(res.headers.get("content-length") || "0");
    total += cl;
    if (cl > 0) counted++;
  }
  const avg = counted > 0 ? total / counted : 0;
  // Scale to all stale keys by total count, assuming similar distribution.
  return Math.round(avg * keys.length);
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) result[key] = true;
    else {
      result[key] = next;
      i++;
    }
  }
  return result;
}

function readWranglerOAuthToken() {
  const configPath = path.join(process.env.HOME || "", "Library/Preferences/.wrangler/config/default.toml");
  if (!fs.existsSync(configPath)) return null;
  const text = fs.readFileSync(configPath, "utf8");
  return text.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1] || null;
}
