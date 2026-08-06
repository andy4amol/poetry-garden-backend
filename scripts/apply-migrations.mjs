#!/usr/bin/env node
// apply-migrations.mjs — apply D1 migrations through the Cloudflare REST
// API directly. Bypasses the wrangler CLI subprocess, which on version
// 4.47 has a known issue where it closes the SQL FileHandle before
// reading:
//
//   [Error: A FileHandle object was closed during garbage collection.
//    This used to be allowed with a deprecation warning but is now
//    considered an error. ...]
//   code: 'ERR_INVALID_STATE'
//
// Usage:
//   CLOUDFLARE_API_TOKEN=xxx \
//   CLOUDFLARE_ACCOUNT_ID=... \
//   node scripts/apply-migrations.mjs --database poetry-garden-v2
//
// Reads every migrations/*.sql, splits into individual statements, and
// POSTs them one at a time to the D1 REST query endpoint.

import fs from "node:fs";
import path from "node:path";

const accountId =
  process.env.CLOUDFLARE_ACCOUNT_ID || "55195cd3d44ee867f1a9a909db643a7e";
const token = process.env.CLOUDFLARE_API_TOKEN;

if (!token) {
  console.error("CLOUDFLARE_API_TOKEN env var is required.");
  process.exit(2);
}

const args = parseArgs(process.argv.slice(2));
const database = args.database || "poetry-garden-v2";

const migrationsDir = path.resolve("migrations");
const files = fs
  .readdirSync(migrationsDir)
  .filter((f) => /^\d{4}_.+\.sql$/.test(f))
  .sort();
if (!files.length) {
  console.error("No migrations to apply.");
  process.exit(2);
}

const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${database}/query`;

let applied = 0;
let skipped = 0;
let failed = 0;

for (const file of files) {
  console.log(`\n>>> ${file}`);
  const fullPath = path.join(migrationsDir, file);
  const sql = fs.readFileSync(fullPath, "utf8");
  const statements = splitSql(sql);
  console.log(`    statements: ${statements.length}`);
  for (const stmt of statements) {
    const trimmed = stmt.trim();
    if (!trimmed || trimmed.startsWith("--")) continue;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: trimmed }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.success !== false) {
      applied++;
      process.stdout.write(".");
    } else {
      const err = body.errors?.map((e) => e.message).join("; ") || res.status;
      if (
        err.includes("already exists") ||
        err.includes("duplicate column") ||
        err.includes("no such column")
      ) {
        skipped++;
        process.stdout.write("s");
      } else {
        failed++;
        console.error(`\n  FAIL  ${trimmed.slice(0, 80)}: ${err}`);
      }
    }
  }
  console.log("");
}

console.log(`\nApplied: ${applied}, Skipped (already exists): ${skipped}, Failed: ${failed}`);
if (failed > 0) process.exit(1);

function splitSql(sql) {
  // Naive splitter on `;` followed by newline. Comments and string
  // literals are not protected; for our migrations this is fine.
  const parts = [];
  let buf = "";
  for (const line of sql.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      buf += "\n";
      continue;
    }
    if (trimmed.startsWith("--")) {
      buf += line + "\n";
      continue;
    }
    buf += line + "\n";
    if (trimmed.endsWith(";")) {
      parts.push(buf);
      buf = "";
    }
  }
  if (buf.trim()) parts.push(buf);
  return parts;
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
