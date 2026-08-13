# Kilo Auto-Debug System

Self-improving debugging memory and automated fix system for Kilo Code agents.

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
Lightweight HTTP MCP server (port 3211) exposing three tools:
- `debug_lookup` — search Redis memory for past bugs/fixes
- `debug_fix` — get AI-suggested fix via local Ollama
- `debug_log` — log bugs/fixes to Redis for future lookup

### 2. debug-ops.md
Kilo agent rules enforcing:
- Circuit breaker: max 3 debug invocations per session
- Memory lookup before attempting fixes
- Git commit before any fix application
- Auto-revert on test failure
- Protected service exclusions (hermes-gateway, rag-enterprise, ubuntu-gateway)

### 3. sync.js
Redis-to-JSONL sync script. Appends new Redis entries to `debug_log.jsonl` with deduplication. JSONL is the durable source of truth; Redis is the fast cache.

### 4. learner.js
Background service that analyzes debug patterns every 60s and appends learning snapshots to the agent rules file.

### 5. schema.ts
Type definitions for debug entries: bug, fix, pattern.

## Setup

### Prerequisites
- Node.js 18+
- Redis running on localhost:6379
- Ollama running on localhost:11434 with `qwen2.5:3b` pulled

### Install

```bash
# 1. Clone this repo into your Kilo config directory
git clone <this-repo-url> ~/.kilo/debug-system

# 2. Enable Redis persistence
redis-cli CONFIG SET appendonly yes

# 3. Start the debug MCP server
node ~/.kilo/debug-system/.kilo/debug-mcp.js &

# 4. Add to Kilo config
# In kilo.json, add under mcp.servers:
# "debug-ops": {
#   "type": "streamableHttp",
#   "url": "http://127.0.0.1:3211/mcp",
#   "description": "Local debug memory and lightweight Ollama fix suggestions"
# }

# 5. Load the agent rules
# Copy .kilo/agent/debug-ops.md into your Kilo agents directory
```

## Model Choice

Uses `qwen2.5:3b` (local, ~2GB) for fast responses on Intel i7/i5 + 8GB RAM hardware. No GPU required.

## Safety

- All fixes require git commit before application
- Failed fixes auto-revert
- Critical services are never auto-fixed
- Circuit breaker prevents infinite debug loops

## License

MIT
