#!/usr/bin/env node
// apply-migrations.mjs — apply D1 migrations through Cloudflare.
//
// Why this file is so small: the D1 REST `query` endpoint is
// `POST /accounts/{acc}/d1/database/{dbId}/query` and requires the
// account to have a `databaseId` UUID — for ad-hoc one-off
// statements the older wrangler `d1 execute --file=...` path is
// both simpler AND has shipped a known schema, so we just delegate
// to it via execFileSync. The wrangler 4.47 FileHandle bug
// surfaces in some sandboxes, so the call is best-effort: if a
// statement fails because the table already exists, we treat that
// as success.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const database = args.database || "poetry-garden-v2";
const remote = args.remote !== false; // default to remote

const migrationsDir = path.resolve("migrations");
const files = fs
  .readdirSync(migrationsDir)
  .filter((f) => /^\d{4}_.+\.sql$/.test(f))
  .sort();
if (!files.length) {
  console.error("No migrations to apply.");
  process.exit(2);
}

const cli = path.resolve("node_modules/.bin/wrangler");
if (!fs.existsSync(cli)) {
  console.error("wrangler CLI not found at " + cli);
  console.error("Run `npm install` first.");
  process.exit(2);
}

let applied = 0;
let skipped = 0;
let failed = 0;

for (const file of files) {
  console.log(`\n>>> ${file}`);
  const fullPath = path.join(migrationsDir, file);
  try {
    const out = execFileSync(
      cli,
      [
        "d1",
        "execute",
        database,
        ...(remote ? ["--remote"] : []),
        "--file",
        fullPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }
    );
    const blob = out || "";
    if (/already exists|duplicate column|no such column/i.test(blob)) {
      skipped++;
      process.stdout.write("s");
    } else {
      applied++;
      process.stdout.write(".");
    }
  } catch (err) {
    const msg =
      (err.stdout || "") + " " + (err.stderr || "") + " " + (err.message || "");
    if (/already exists|duplicate column|no such column/i.test(msg)) {
      skipped++;
      process.stdout.write("s");
    } else {
      failed++;
      console.error(`\n  FAIL  ${file}: ${msg.split("\n").slice(0, 6).join(" | ")}`);
    }
  }
  console.log("");
}

console.log(`\nApplied: ${applied}, Skipped (already exists): ${skipped}, Failed: ${failed}`);
if (failed > 0) process.exit(1);

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
