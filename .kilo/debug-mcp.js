const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const PORT = process.env.DEBUG_MCP_PORT || 3211;
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.DEBUG_MODEL || "qwen2.5:3b";
const REDIS_PREFIX = "kilo:debug";

function redisCli(args) {
  return execSync(`redis-cli ${args}`, { encoding: "utf8" }).trim();
}

function scanKeys(pattern) {
  const result = redisCli(`--scan --pattern "${pattern}"`);
  if (!result) return [];
  return result.split("\n").filter(Boolean);
}

function lookupMemory(problem) {
  const keys = scanKeys(`${REDIS_PREFIX}:*`);
  const matches = [];
  const problemLower = (problem || "").toLowerCase();

  for (const key of keys) {
    const type = redisCli(`TYPE "${key}"`);
    if (type !== "hash") continue;

    const data = redisCli(`HGETALL "${key}"`);
    const lines = data.split("\n");
    const hash = {};
    for (let i = 0; i < lines.length; i += 2) {
      hash[lines[i]] = lines[i + 1] || "";
    }

    if (!hash.id || !hash.problem) continue;

    const haystack = `${hash.problem} ${hash.root_cause || ""} ${hash.tags || ""}`.toLowerCase();
    if (problemLower.split(/\s+/).some((w) => w.length > 3 && haystack.includes(w))) {
      matches.push(hash);
    }
  }

  matches.sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));
  return matches;
}

function callOllama(prompt, model) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: model || DEFAULT_MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.2, num_ctx: 8192 },
    });

    const url = new URL(`${OLLAMA_URL}/api/generate`);
    const req = http.request(url, { method: "POST", headers: { "Content-Type": "application/json" } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          const raw = Buffer.concat(chunks).toString("utf8");
          const parsed = JSON.parse(raw);
          resolve(parsed.response || raw);
        } catch (e) {
          resolve(Buffer.concat(chunks).toString("utf8"));
        }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (url.pathname === "/health" && req.method === "GET") {
    res.writeHead(200);
    res.end(JSON.stringify({ status: "ok", model: DEFAULT_MODEL }));
    return;
  }

  if (url.pathname === "/mcp" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      let request;
      try {
        request = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" } }));
        return;
      }

      const response = { jsonrpc: "2.0", id: request.id };

      if (request.method === "initialize") {
        response.result = {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "debug-mcp", version: "1.0.0" },
        };
        res.writeHead(200);
        res.end(JSON.stringify(response));
        return;
      }

      if (request.method === "tools/list") {
        response.result = {
          tools: [
            {
              name: "debug_lookup",
              description: "Look up past bugs/fixes in Redis memory before attempting a fix.",
              inputSchema: { type: "object", properties: { problem: { type: "string" } }, required: ["problem"] },
            },
            {
              name: "debug_fix",
              description: "Get an AI-suggested fix for a code problem using local Ollama. Uses lightweight model for fast responses.",
              inputSchema: {
                type: "object",
                properties: {
                  problem: { type: "string" },
                  context: { type: "string" },
                  model: { type: "string" },
                },
                required: ["problem"],
              },
            },
            {
              name: "debug_log",
              description: "Log a bug or fix to Redis memory for future lookup.",
              inputSchema: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["bug", "fix", "pattern"] },
                  problem: { type: "string" },
                  root_cause: { type: "string" },
                  fix_applied: { type: "string" },
                  outcome: { type: "string" },
                  session_id: { type: "string" },
                  tags: { type: "array", items: { type: "string" } },
                },
                required: ["type", "problem"],
              },
            },
          ],
        };
        res.writeHead(200);
        res.end(JSON.stringify(response));
        return;
      }

      if (request.method === "tools/call") {
        const name = request.params?.name;
        const args = request.params?.arguments || {};

        if (name === "debug_lookup") {
          const matches = lookupMemory(args.problem);
          response.result = {
            content: [{ type: "text", text: JSON.stringify({ count: matches.length, matches }) }],
          };
          res.writeHead(200);
          res.end(JSON.stringify(response));
          return;
        }

        if (name === "debug_fix") {
          try {
            const memoryHints = lookupMemory(args.problem).slice(0, 3);
            const memoryBlock =
              memoryHints.length > 0
                ? `\nPast similar issues:\n${memoryHints.map((m) => `- ${m.problem}: ${m.fix_applied} (${m.outcome})`).join("\n")}\n`
                : "";

            const prompt = `You are a coding assistant. Provide a concise, practical fix for the problem below. Include the likely root cause and exact steps to apply the fix.\n\nProblem: ${args.problem}\n${memoryBlock}${args.context ? `Context: ${args.context}\n` : ""}Format your answer as:\n1. Root cause\n2. Fix steps\n3. Verification`;

            const answer = await callOllama(prompt, args.model);
            response.result = { content: [{ type: "text", text: answer }] };
          } catch (err) {
            response.result = { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
          }
          res.writeHead(200);
          res.end(JSON.stringify(response));
          return;
        }

        if (name === "debug_log") {
          const id = args.id || `${new Date().toISOString().replace(/[:.]/g, "-")}`;
          const timestamp = new Date().toISOString();
          const key = `${REDIS_PREFIX}:${args.type}:${id}`;
          const tags = Array.isArray(args.tags) ? JSON.stringify(args.tags) : "[]";

          redisCli(`HSET "${key}" timestamp "${timestamp}" id "${id}" type "${args.type}" problem "${args.problem.replace(/"/g, '\\"')}" root_cause "${(args.root_cause || "").replace(/"/g, '\\"')}" fix_applied "${(args.fix_applied || "").replace(/"/g, '\\"')}" outcome "${(args.outcome || "").replace(/"/g, '\\"')}" session_id "${(args.session_id || "").replace(/"/g, '\\"')}" tags "${tags}"`);
          response.result = { content: [{ type: "text", text: JSON.stringify({ logged: true, key, id }) }] };
          res.writeHead(200);
          res.end(JSON.stringify(response));
          return;
        }

        response.error = { code: -32601, message: "Unknown tool" };
        res.writeHead(200);
        res.end(JSON.stringify(response));
        return;
      }

      response.error = { code: -32601, message: "Method not found" };
      res.writeHead(200);
      res.end(JSON.stringify(response));
    });
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.error(`debug-mcp listening on http://127.0.0.1:${PORT}`);
});
