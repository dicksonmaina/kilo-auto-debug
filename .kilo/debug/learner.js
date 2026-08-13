const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const REDIS_PREFIX = "kilo:debug";
const RULES_PATH = path.join(process.env.HOME, ".kilo", "agent", "debug-ops.md");
const SYNC_INTERVAL_MS = 60 * 1000;

function redisCli(args) {
  return execSync(`redis-cli ${args}`, { encoding: "utf8" }).trim();
}

function scanKeys(pattern) {
  const result = redisCli(`--scan --pattern "${pattern}"`);
  if (!result) return [];
  return result.split("\n").filter(Boolean);
}

function loadEntries() {
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
    entries.push({ key, ...hash });
  }
  return entries;
}

function analyzePatterns(entries) {
  const counts = {};
  for (const e of entries) {
    const tagKey = (e.tags || "").replace(/[\[\]"]/g, "").split(",").map((t) => t.trim()).filter(Boolean)[0] || "general";
    counts[tagKey] = (counts[tagKey] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function appendLearningNote(patterns) {
  if (!patterns.length) return;
  const top = patterns.slice(0, 3).map(([tag, count]) => `- ${tag}: ${count}`).join("\n");
  const note = `\n## Learning Snapshot ${new Date().toISOString()}\nTop patterns:\n${top}\n`;
  fs.appendFileSync(RULES_PATH, note);
}

function runCycle() {
  try {
    const entries = loadEntries();
    const patterns = analyzePatterns(entries);
    if (patterns.length > 0) {
      appendLearningNote(patterns);
    }
  } catch (err) {
    console.error("learner cycle failed:", err.message);
  }
}

setInterval(runCycle, SYNC_INTERVAL_MS);
runCycle();
console.error("debug learner running");
