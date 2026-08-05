#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

const args = parseArgs(process.argv.slice(2));
const accountId = args.account || process.env.CLOUDFLARE_ACCOUNT_ID || "55195cd3d44ee867f1a9a909db643a7e";
const bucket = args.bucket || "poetry-garden-content";
const dir = path.resolve(args.dir || "imports/content");
const concurrency = Number(args.concurrency || process.env.UPLOAD_CONCURRENCY || 16);
const limit = args.limit ? Number(args.limit) : Infinity;
const retries = Number(args.retries || process.env.UPLOAD_RETRIES || 5);
const manifestPath = path.join(dir, "r2-manifest.json");
const logPath = args.log || path.join(dir, "upload-r2-direct.log");
const checkpointPath = args.checkpoint || path.join(dir, "upload-r2-checkpoint.txt");
const token = process.env.CLOUDFLARE_API_TOKEN || readWranglerOAuthToken();

if (!token) {
  throw new Error("No Cloudflare token found. Run `npx wrangler login` or set CLOUDFLARE_API_TOKEN.");
}

if (!fs.existsSync(manifestPath)) {
  throw new Error(`Manifest not found at ${manifestPath}. Run the generator first.`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")).slice(0, limit);
fs.writeFileSync(logPath, "");

// Resume support: load which keys were already uploaded in a previous run so
// we don't waste time re-PUTing 5,000+ objects.
const completedKeys = new Set(loadCheckpoint(checkpointPath));
console.log(`Manifest: ${manifest.length} objects; already-uploaded keys cached: ${completedKeys.length}`);

let index = 0;
let skipped = 0;
let uploaded = 0;
let failed = 0;
const started = Date.now();
let lastProgressLog = 0;

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      result[key] = true;
    } else {
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

function loadCheckpoint(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean);
}

function appendCheckpoint(key) {
  fs.appendFileSync(checkpointPath, `${key}\n`);
}

function objectUrl(key) {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${key}`;
}

async function headExists(key) {
  // Use HEAD to detect already-uploaded objects. If we get 200, skip.
  // Some R2 deployments have HEAD disabled — fall back to skipping.
  try {
    const res = await fetch(objectUrl(key), {
      method: "HEAD",
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "poetry-garden-r2-uploader/1.0" },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function upload(item) {
  const filePath = path.join(dir, item.file);
  const stat = fs.statSync(filePath);
  const response = await fetch(objectUrl(item.key), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "poetry-garden-r2-uploader/1.0",
      "content-type": "application/json",
      "content-length": String(stat.size),
    },
    body: Readable.toWeb(fs.createReadStream(filePath)),
    duplex: "half",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText} ${text}`.trim());
  }
}

function shouldRetry(error) {
  const message = String(error?.message || error);
  if (/^429\b/.test(message)) return true;
  if (/^5\d\d\b/.test(message)) return true;
  if (message.includes("fetch failed")) return true;
  // 401/403 are NOT retried automatically — surface them so the operator
  // can fix token/permissions rather than hammering the API.
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelay(error, attempt) {
  const message = String(error?.message || error);
  // 429s — backoff aggressively (the bucket itself returned "wait").
  if (/^429\b/.test(message)) return Math.min(60000, 15000 * attempt);
  // Network / 5xx — exponential.
  return Math.min(30000, 500 * 2 ** (attempt - 1));
}

async function uploadWithRetry(item) {
  let attempt = 0;
  let lastError;
  while (attempt <= retries) {
    try {
      await upload(item);
      return;
    } catch (error) {
      attempt++;
      lastError = error;
      if (!shouldRetry(error)) throw error;
      if (attempt > retries) throw error;
      await sleep(retryDelay(error, attempt));
    }
  }
  throw lastError;
}

function maybeLogProgress() {
  const now = Date.now();
  // Heartbeat every 5 seconds so a stuck run is visible.
  if (now - lastProgressLog >= 5000) {
    const seconds = Math.max(1, (now - started) / 1000);
    const total = uploaded + skipped + failed;
    console.log(
      `[progress] ${total}/${manifest.length} (up=${uploaded} skip=${skipped} fail=${failed}) | ` +
        `${(total / seconds).toFixed(1)} obj/s | elapsed ${Math.floor(seconds)}s`
    );
    lastProgressLog = now;
  }
}

async function worker() {
  while (index < manifest.length) {
    const current = manifest[index++];
    maybeLogProgress();
    if (completedKeys.has(current.key)) {
      skipped++;
      continue;
    }
    try {
      await uploadWithRetry(current);
      appendCheckpoint(current.key);
      uploaded++;
      if (uploaded % 100 === 0) {
        const seconds = Math.max(1, (Date.now() - started) / 1000);
        console.log(`uploaded ${uploaded}/${manifest.length} (${Math.round(uploaded / seconds)} obj/s)`);
      }
    } catch (error) {
      failed++;
      fs.appendFileSync(logPath, `${current.key}\t${error.message}\n`);
      console.error(`failed ${current.key}: ${error.message}`);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));

const seconds = Math.max(1, (Date.now() - started) / 1000);
console.log(
  `R2 upload done: uploaded=${uploaded} skipped=${skipped} failed=${failed} total=${manifest.length} (${Math.round(
    (uploaded + skipped) / seconds
  )} obj/s, ${Math.floor(seconds)}s)`
);

if (failed > 0) {
  console.error(`${failed} uploads failed. See ${logPath}. Re-run to resume from checkpoint.`);
  process.exit(1);
}
