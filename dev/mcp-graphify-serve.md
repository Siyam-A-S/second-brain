I'll help you find the fine-grained controls for graph extraction and the MCP calls available in graphify. Let me search the repository.Let me search for the main CLI entry point and MCP configuration:Now let me search more specifically for CLI options and MCP tools:Now let me search for the CLI argument parsing more specifically:Let me get the actual content directly from the file:Now let me search for the specific CLI options and MCP tools more directly:Based on my analysis of the graphify codebase, here's the comprehensive answer to your questions:

## Fine-Grained Controls for Graph Extraction

Graphify exposes several layers of control for customizing graph extraction to specific use cases:

### **CLI-Level Controls**

```bash
# Update (incremental re-extraction)
graphify update <path>
  --force              # Overwrite graph even if new build has fewer nodes (post-refactor cleanup)
  --no-cluster         # Skip clustering, keep raw extraction only

# Clustering
graphify cluster-only <path>
  --resolution 1.5     # Community size tuning (higher = more, smaller communities)
  --exclude-hubs 99    # Exclude top-N degree nodes from partitioning (reduce hub-dominated clustering)
  --no-label           # Skip LLM community naming (keep "Community N" placeholders)
  --max-concurrency 16 # Parallel community labeling threads
  --batch-size 200     # Batch size for concurrent LLM calls
  --graph <path>       # Custom graph.json location
  --backend=gemini     # LLM backend for community naming
  --model <model>      # Specific model (e.g., gemini-2.5-pro)
  --no-viz             # Skip graph.html for large graphs (>5000 nodes)

# Query with context filtering
graphify query "question" 
  --dfs                # Use DFS instead of BFS traversal
  --context C          # Filter edges by context type (call, import, field, etc.)
  --budget N           # Token budget for output (approx 3 chars/token)
  --graph path         # Custom graph path
```

### **Environmental Controls**

```bash
GRAPHIFY_FORCE=1           # Force graph overwrite (same as --force)
GRAPHIFY_OUT=<path>        # Override output directory (for worktrees/shared setups)
GRAPHIFY_NO_TIPS=1         # Suppress tips in output
```

### **Programmatic/Library Controls**

The `graphify.serve` module exposes fine-grained parameters for MCP tools:

```python
query_graph(
    question: str,
    mode: "bfs" | "dfs" = "bfs",      # Traversal algorithm
    depth: int = 1-6,                  # Search depth
    token_budget: int = 2000,          # Output truncation threshold
    context_filter: list[str] | None   # Edge context types to include
)
```

Supported context filters: `call`, `import`, `field`, `parameter_type`, `return_type`, `generic_arg`, `export`, `attribute`

### **Graph-Time Configuration**

- **Confidence thresholds**: All edges tagged `EXTRACTED`, `INFERRED`, or `AMBIGUOUS` with confidence scores (0.0–1.0)
- **Community detection**: Leiden algorithm with configurable resolution parameter
- **Caching**: SHA256 content fingerprinting skips re-extraction of unchanged files

---

## MCP Tools Available (7 Total)

All exposed via `graphify.serve` module. These **replace** the corresponding CLI commands for programmatic/agent-based access:

| MCP Tool | Replaces CLI | Purpose |
|----------|------------|---------|
| **query_graph** | `graphify query` | Natural language search with BFS/DFS, context filtering, depth/token budget control |
| **get_node** | (none — query only) | Fetch full node details by label or ID |
| **get_neighbors** | (none — query only) | Get direct edges + metadata for a node; optional relation type filter |
| **get_community** | (none — query only) | List all nodes in a community by ID |
| **god_nodes** | (none — output in GRAPH_REPORT.md) | Return top-N most-connected nodes (core abstractions) |
| **graph_stats** | (none — query only) | Summary: node count, edge count, communities, confidence breakdown |
| **shortest_path** | `graphify path A B` | Find shortest path between two concepts with hop limits |
| **list_prs** | (none) | List open PRs with CI status and graph impact (communities touched) |
| **get_pr_impact** | (none) | Detailed: which files changed, which communities affected, node count |
| **triage_prs** | (none) | Actionable PRs with full graph impact for review prioritization |

### **MCP Resources** (read-only):
- `graphify://report` → Full GRAPH_REPORT.md
- `graphify://stats` → Node/edge/community counts
- `graphify://god-nodes` → Top 10 most-connected
- `graphify://surprises` → Cross-community connections
- `graphify://audit` → Edge confidence breakdown (EXTRACTED/INFERRED/AMBIGUOUS %)
- `graphify://questions` → Suggested queries for the codebase

---

## Invocation Summary

**All MCP tools** can be called via the stdio transport:
```bash
python -m graphify.serve graphify-out/graph.json
```

Or HTTP (Streamable):
```bash
python -m graphify.serve graphify-out/graph.json \
  --transport http --host 127.0.0.1 --port 8080 \
  --api-key your-key  # optional
```

The 10 MCP tool handlers provide **complete functional coverage** for graph querying, impact analysis, and PR triage without needing CLI subprocess calls.

---

## Second Brain Integration Notes

Second Brain should use `graphify.serve` MCP tools for read-only graph context:

- Chat grounding: `query_graph`
- Explain/detail views: `get_node`, then optionally `get_neighbors`
- Path tracing: `shortest_path`
- Graph health/status: `graph_stats`, `god_nodes`
- Community drill-down: `get_community`
- Future review workflows: `list_prs`, `get_pr_impact`, `triage_prs`

Keep CLI subprocesses for graph mutation and generated artifacts:

- `graphify extract ...` / `graphify . --update`
- `graphify cluster-only ...`
- `graphify export html`, `graphify export wiki`, `graphify export callflow-html`

Safety boundary: MCP tools must start from the active project `graphify-out/graph.json`, refresh after the graph file changes, and fall back to the CLI compatibility path only when the MCP server/tool contract is unavailable.
