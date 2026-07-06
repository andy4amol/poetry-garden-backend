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
const token = process.env.CLOUDFLARE_API_TOKEN || readWranglerOAuthToken();

if (!token) {
  throw new Error("No Cloudflare token found. Run `npx wrangler login` or set CLOUDFLARE_API_TOKEN.");
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")).slice(0, limit);
fs.writeFileSync(logPath, "");

let index = 0;
let completed = 0;
let failed = 0;
const started = Date.now();

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

function objectUrl(key) {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${key}`;
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
  return message.includes("fetch failed") || /^429\b/.test(message) || /^5\d\d\b/.test(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelay(error, attempt) {
  const message = String(error?.message || error);
  if (/^429\b/.test(message)) return Math.min(60000, 10000 * attempt);
  return Math.min(30000, 500 * 2 ** (attempt - 1));
}

async function uploadWithRetry(item) {
  let attempt = 0;
  while (true) {
    try {
      await upload(item);
      return;
    } catch (error) {
      attempt++;
      if (attempt > retries || !shouldRetry(error)) throw error;
      await sleep(retryDelay(error, attempt));
    }
  }
}

async function worker() {
  while (index < manifest.length) {
    const current = manifest[index++];
    try {
      await uploadWithRetry(current);
      completed++;
      if (completed % 100 === 0 || completed === manifest.length) {
        const seconds = Math.max(1, (Date.now() - started) / 1000);
        console.log(`uploaded ${completed}/${manifest.length} (${Math.round(completed / seconds)} obj/s)`);
      }
    } catch (error) {
      failed++;
      fs.appendFileSync(logPath, `${current.key}\t${error.message}\n`);
      console.error(`failed ${current.key}: ${error.message}`);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));

if (failed > 0) {
  throw new Error(`${failed} uploads failed. See ${logPath}`);
}

console.log(`R2 direct upload complete: ${completed}/${manifest.length}`);
