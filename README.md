# kilo-auto-debug

![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)
![Ollama](https://img.shields.io/badge/Ollama-000000?style=for-the-badge&logo=ollama&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-FF6B6B?style=for-the-badge&logo=modelcontextprotocol&logoColor=white)

**Self-improving debugging memory and automated fix system for Kilo Code agents.**

## What It Does

This system gives your AI coding agents:
- **Persistent memory** — every bug, fix, and pattern is stored in Redis and synced to JSONL
- **Fast lookup** — before re-solving a known issue, agents check memory first
- **AI suggestions** — lightweight local Ollama model (`qwen2.5:3b`) provides fixes in ~5-10s
- **Circuit breaker** — max 3 auto-debug calls per session prevents infinite loops
- **Git safety** — auto-commit before fixes, auto-revert on test failure
- **Protected services** — critical services (`hermes-gateway`, `rag-enterprise`, `ubuntu-gateway`) are never auto-fixed

## Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────┐
│  Kilo Agent     │────▶│  debug-mcp   │────▶│   Ollama    │
│  (VS Code/CLI)  │     │  HTTP MCP    │     │  qwen2.5:3b │
└─────────────────┘     └──────┬───────┘     └─────────────┘
                               │
                               ▼
                        ┌──────────────┐
                        │    Redis     │
                        │  kilo:debug  │
                        │  (AOF saved) │
                        └──────┬───────┘
                               │
                        sync.js │ learner.js
                               ▼
                        ┌──────────────┐
                        │ debug_log.jsonl │
                        │  (durable)     │
                        └────────────────┘
```

## Components

### 1. debug-mcp.js
Lightweight HTTP MCP server (port 3211) exposing:
- `debug_lookup` — search Redis memory for past bugs/fixes
- `debug_fix` — get AI-suggested fix via local Ollama
- `debug_log` — log bugs/fixes to Redis for future lookup

### 2. debug-ops.md
Kilo agent rules enforcing circuit breaker, memory lookup, git safety, and protected service exclusions.

### 3. sync.js
Redis-to-JSONL sync script with deduplication. JSONL is the durable source of truth.

### 4. learner.js
Background service that analyzes debug patterns every 60s and appends learning snapshots to agent rules.

## Setup

### Prerequisites
- Node.js 18+
- Redis running on `localhost:6379`
- Ollama running on `localhost:11434` with `qwen2.5:3b` pulled

### Install

```bash
# 1. Clone this repo into your Kilo config directory
git clone https://github.com/dicksonmaina/kilo-auto-debug ~/.kilo/debug-system

# 2. Enable Redis persistence
redis-cli CONFIG SET appendonly yes

# 3. Start the debug MCP server
node ~/.kilo/debug-system/.kilo/debug-mcp.js &

# 4. Add to Kilo config (kilo.json)
# "mcp": {
#   "debug-ops": {
#     "type": "streamableHttp",
#     "url": "http://127.0.0.1:3211/mcp"
#   }
# }

# 5. Load the agent rules
# Copy .kilo/agent/debug-ops.md into your Kilo agents directory
```

## Model Choice

Uses `qwen2.5:3b` (local, ~2GB) for fast responses on Intel i7/i5 + 8GB RAM hardware. No GPU required.

## Safety Guarantees

- All fixes require `git commit` before application
- Failed fixes auto-revert via `git revert HEAD --no-edit`
- Critical services are never auto-fixed (propose only)
- Circuit breaker prevents infinite debug loops (max 3/session)

## Learning Loop

Every debugging cycle logs to Redis:
```
kilo:debug:bug:{id}
kilo:debug:fix:{id}
kilo:debug:pattern:{type}
```

Future sessions query this memory before re-solving known issues. The system gets faster and more accurate over time.

## GitHub Actions

Auto-update workflow included in `.github/workflows/`:
- Daily stats generation
- Repo metadata sync
- Cross-linking to portfolio

## License

MIT — see [LICENSE](LICENSE) for details.

## Support

- ⭐ Star if this helps your workflow
- 🍴 Fork and improve
- 💰 [Sponsor](https://github.com/sponsors/dicksonmaina) ongoing development

## Related Projects

- [dicksonmaina/dicksonmaina](https://github.com/dicksonmaina/dicksonmaina) — Profile README
- [dicksonmaina/dicksonmaina-portfolio](https://github.com/dicksonmaina/dicksonmaina-portfolio) — Project hub
- [nexus-ecosystem](https://github.com/dicksonmaina/nexus-ecosystem) — Knowledge graph pipeline
- [jarvis-agile](https://github.com/dicksonmaina/jarvis-agile) — Multi-provider AI agent

---

*Built by [dicksonmaina](https://github.com/dicksonmaina). Part of the autonomous coding foundation.*
