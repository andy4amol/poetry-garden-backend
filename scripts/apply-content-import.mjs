#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const args = parseArgs(process.argv.slice(2));
const importDir = path.resolve(args.dir || path.join(repoRoot, "imports", "content"));
const database = args.database || "poetry-garden";
const remote = args.remote !== false && args.local !== true;

if (!remote) {
  console.warn("Using wrangler local D1 import. If Wrangler fails with a Node FileHandle GC error, validate SQL with sqlite3 or use Node 22.");
}

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

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed`);
  }
}

const sqlFiles = fs
  .readdirSync(importDir)
  .filter((file) => /^\d+_.+\.sql$/.test(file))
  .sort();

for (const file of sqlFiles) {
  const filePath = path.join(importDir, file);
  run("npx", [
    "wrangler",
    "d1",
    "execute",
    database,
    remote ? "--remote" : "--local",
    "--file",
    filePath,
  ]);
}
