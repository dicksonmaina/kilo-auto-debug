const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const REDIS_PREFIX = "kilo:debug";
const JSONL_PATH = process.env.DEBUG_LOG_PATH || path.join(process.env.HOME, "debug_log.jsonl");

function redisCli(args) {
  return execSync(`redis-cli ${args}`, { encoding: "utf8" }).trim();
}

function scanKeys(pattern) {
  const result = redisCli(`--scan --pattern "${pattern}"`);
  if (!result) return [];
  return result.split("\n").filter(Boolean);
}

function sync() {
  const keys = scanKeys(`${REDIS_PREFIX}:*`);
  const entries = [];

  for (const key of keys) {
    const type = redisCli(`TYPE "${key}"`);
    if (type !== "hash") continue;

    const data = redisCli(`HGETALL "${key}"`);
    const lines = data.split("\n");
    const hash = {};
    for (let i = 0; i < lines.length; i += 2) {
      hash[lines[i]] = lines[i + 1] || "";
    }

    if (!hash.id) continue;

    entries.push({
      timestamp: hash.timestamp || new Date().toISOString(),
      id: hash.id,
      type: key.split(":")[2] || "unknown",
      problem: hash.problem || "",
      root_cause: hash.root_cause || "",
      fix_applied: hash.fix_applied || "",
      outcome: hash.outcome || "",
      session_id: hash.session_id || "",
      tags: hash.tags ? JSON.parse(hash.tags) : [],
    });
  }

  entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const seen = new Set();
  const unique = entries.filter((e) => {
    const sig = `${e.id}:${e.type}:${e.timestamp}`;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });

  const lines = unique.map((e) => JSON.stringify(e));
  fs.writeFileSync(JSONL_PATH, lines.join("\n") + "\n");
  console.log(`Synced ${unique.length} unique entries to ${JSONL_PATH}`);
}

sync();
