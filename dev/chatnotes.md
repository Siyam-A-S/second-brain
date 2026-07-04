```
npm run dev:renderer   # Vite only, opens in browser
npm run dev:headless   # Uses xvfb-run for headless Electron
```

### Verification:

npm run build passes.
npm run dev no longer fails on chrome-sandbox.
It now fails here with Missing X server or $DISPLAY, which means this shell has no GUI display attached.
### Use:
```
npm run dev
```
from a real graphical Ubuntu terminal.

### For SSH/headless:
```
npm run dev:renderer
```
For headless Electron smoke testing, install Xvfb first:

sudo apt install xvfb
npm run dev:headless
To use Chromium’s real setuid sandbox later, fix the binary permissions and opt in:

sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
SECOND_BRAIN_DEV_CHROMIUM_SANDBOX=1 npm run dev


-----

Two things were happening:

1. Your original `dev:headless` did start Electron, but Chromium was complaining about DBus/GPU inside Xvfb.
2. My test also found a port conflict risk: if `dev:renderer` is already running on `5173`, headless should not try to reuse it.

I updated:
- [package.json](/home/rushat/second-brain/package.json): `dev:headless` now uses port `5174`.
- [vite.config.ts](/home/rushat/second-brain/vite.config.ts): Vite reads `VITE_PORT`.
- [start-electron-dev.cjs](/home/rushat/second-brain/scripts/start-electron-dev.cjs): headless launches with Linux Xvfb-friendly GPU flags.

`npm run build` passes.

Now run:

```bash
npm run dev:headless
```

You may still see `xdg-desktop-portal`, `GSettings`, or `DBus` warnings. Those are from the host’s minimal headless desktop stack, not from the app. For a cleaner headless environment, install the missing desktop runtime pieces:

```bash
sudo apt install xvfb dbus-x11 gsettings-desktop-schemas xdg-desktop-portal xdg-desktop-portal-gtk gvfs-fuse at-spi2-core
```

Also: `dev:headless` is mostly useful as a smoke test. For actually viewing and developing UI, keep using:

```bash
npm run dev:renderer
```

-------
1. **Windows executable Python/Graphify detection**

Partially.

For graph creation, [GraphifyController.ts](/home/rushat/second-brain/src/main/services/GraphifyController.ts:297) runs:

```ts
graphify update .
```

So on Windows it will work **if `graphify.exe` is on PATH** for the packaged Electron process.

For MCP, current Windows behavior is weaker. [resolveMcpCommand()](/home/rushat/second-brain/src/main/services/GraphifyController.ts:406) returns:

```ts
python
```

on `win32`, then starts:

```bash
python -m graphify.serve <graph.json>
```

So it does **not yet discover the exact Python that owns Graphify**. It assumes `python` resolves correctly and that `import graphify` works there. You can override with:

```bash
SECOND_BRAIN_GRAPHIFY_MCP_COMMAND=C:\Path\To\python.exe
SECOND_BRAIN_GRAPHIFY_MCP_ARGS="-m graphify.serve {graphPath}"
```

I’d recommend hardening this before relying on Windows users: try `py -3`, `python`, `where graphify`, then verify each candidate with `python -c "import graphify"`.

2. **Graphify utilities for graph/card control**

The useful knobs are:

- `graphify extract <path>`: full extraction. Best for raw user vault ingestion.
- `--mode deep`: richer semantic inferred edges, useful for smarter topic/subtopic grouping.
- `--directed`: preserve edge direction if you want parent/child style relationships.
- `--no-cluster`: skip community clustering when you want raw nodes only.
- `graphify update <path>`: incremental code update. Current app uses this, but for PDFs/docs/jobs we may want `extract` or a semantic update flow.
- `graphify cluster-only <path>`: rerun clustering on an existing graph.
- `graphify label <path>`: rename communities.
- `graphify query`, `path`, `explain`: runtime graph navigation for the AI.
- `graphify tree`: emits hierarchical tree HTML; conceptually useful for topic/subtopic UI.
- `graphify export obsidian/wiki/svg/graphml`: export forms if you want alternate card sources.

For **topic and subtopic cards**, Graphify itself gives the raw ingredients, not the final app cards:

- `graph.json.nodes[*].community` -> topic grouping
- `.graphify_labels.json` or labeled report -> topic names
- node `label`, `source_file`, `source_location`, `file_type` -> subtopic/card metadata
- `links`/`edges` with `relation`, `confidence`, `weight` -> card connections
- `god_nodes` from report/analysis -> likely pinned or high-importance cards

Important: the app does **not yet convert Graphify communities into board topic/subtopic cards**. It currently updates Graphify and uses MCP for Job Tracker extraction. The next architectural step is a `GraphifyBoardService` that reads `graph.json`, maps communities to `OrganizedBoardTopic[]`, and lets you configure clustering/card rules like “community as topic”, “source file as topic”, or “job/company as topic.”



-------

When structuring a production-ready application that queries large amounts of graph data, **Option 1 (Quick, frequent calls with short payloads) is significantly more economical** than dumping large, infrequent payloads into the context window.

Here is the breakdown of the token economics on Vertex AI and how to optimize your proxy server's architecture for the lowest cost.

### 1. The Math Behind Short/Frequent Calls

Input tokens on Gemini Flash models are extraordinarily cheap, but output tokens are more expensive. Using a "pre-flight" or query-rewriting step is a classic cost-saving pattern.

If you make a fast, focused call to extract 3–6 search keywords (using maybe 50–100 input tokens and generating 10 output tokens), the cost is fractions of a cent. However, this tiny investment allows you to query your semantic graph with high precision. By only pulling the exact nodes and edges the user cares about into the final generation prompt, you might reduce your primary prompt from 80,000 input tokens down to 2,000. The tokens saved on the final generation heavily outweigh the tiny cost of the quick pre-flight call.

### 2. The Trap of Large/Infrequent Payloads

Because Gemini Flash has a massive context window (1M+ tokens), it is tempting to just dump the conversational history, the unoptimized user prompt, and a huge swath of graph context into a single call and let the LLM sort it out.

The problem is that you pay for every input token. If your backend is processing massive PDFs, spreadsheets, or long transcripts, sending unoptimized "fat" payloads will quickly burn through your token budget, hit rate limits, and artificially increase latency, negating the speed benefits of the Flash architecture.

### 3. The Exception: Vertex AI Context Caching

There is one scenario where large payloads become highly economical: **Static Context Caching**.

Vertex AI natively supports Context Caching (both implicit and explicit). If your proxy server handles requests by passing a massive, unchanging payload—such as deep system instructions, global schema definitions, or a static baseline knowledge graph—Vertex AI recognizes the repeated prefix.

* **The Discount:** Cached input tokens receive a **~90% discount** compared to standard input pricing.
* **How to use it:** If you structure your proxy to always put the massive, static context at the very top of the prompt, and append the short, dynamic conversational turns at the bottom, Vertex will automatically cache the heavy top portion.

### The Ideal Architecture

For the most economical scaling, combine both strategies in your proxy endpoint:

1. **Pre-flight:** Use a quick, zero-temperature Flash call to formulate precise search queries from the user's prompt.
2. **Focused Retrieval:** Use those keywords to extract a tight, relevant subgraph.
3. **Cached System Prompt:** When sending the final generation call, keep the heavy system instructions and formatting rules perfectly static at the top of the prompt to trigger Vertex AI's 90% caching discount, appending only the focused graph data and the user's question at the bottom.

-----
## preflight message
It is in [ChatService.ts](/home/rushat/second-brain/src/main/services/ChatService.ts:861), inside:

`ChatService.formulateSemanticRoute(...)`

That is the main preflight LLM call now. The system prompt starts at [ChatService.ts:873](/home/rushat/second-brain/src/main/services/ChatService.ts:873):

```ts
"You are Second Brain's fast semantic router."
...
"Search keywords must be 3-8 compact terms useful for graph retrieval."
```

It returns JSON with:

```ts
{
  intent,
  search_keywords,
  proposed_trackers
}
```

Those keywords are used here:

- Non-streaming chat: [ChatService.ts:608](/home/rushat/second-brain/src/main/services/ChatService.ts:608)
- Streaming chat: [ChatService.ts:695](/home/rushat/second-brain/src/main/services/ChatService.ts:695)

Specifically:

```ts
const semantic = await this.formulateSemanticRoute(thread, text, settings);
const searchQuery = semantic.searchKeywords.join(" ") || (await this.formulateSearchQuery(thread, text, settings));
const graphify = await this.queryGraphify(searchQuery, input.budget);
```

There is also an older fallback keyword-only preflight at [ChatService.ts:1006](/home/rushat/second-brain/src/main/services/ChatService.ts:1006):

`ChatService.formulateSearchQuery(...)`

Its prompt is:

```ts
"You are a search optimizer. Generate a concise search query (3-6 keywords) ..."
```

But that only runs if `semantic.searchKeywords` is empty.

The actual handoff to `graphify.serve` is indirect:

1. [ChatService.queryGraphify()](/home/rushat/second-brain/src/main/services/ChatService.ts:852) calls local MCP tool `query_graphify_context`.
2. [LocalToolRegistry.ts:174](/home/rushat/second-brain/src/main/services/LocalToolRegistry.ts:174) maps that tool to `GraphifyContextService.query(...)`.
3. [GraphifyContextService.ts:529](/home/rushat/second-brain/src/main/services/GraphifyContextService.ts:529) expands the query against graph vocabulary, then calls MCP tool `query_graph`.
4. `graphify.serve` is started with `python -m graphify.serve <graph.json>` at [GraphifyContextService.ts:1074](/home/rushat/second-brain/src/main/services/GraphifyContextService.ts:1074).

So the answer is: **the LLM preflight keyword/router message is in `ChatService.formulateSemanticRoute`; the older keyword-only backup is `ChatService.formulateSearchQuery`; `graphify.serve` itself is queried later by `GraphifyContextService.query`.**

----
## Naming the artifact and memory creation
There are two separate mechanisms.

**Artifact Naming**
The LLM instruction for naming artifacts is in [ChatService.ts](/home/rushat/second-brain/src/main/services/ChatService.ts:430), inside `artifactPlannerSystemPrompt()`.

Key lines:
- [ChatService.ts:434](/home/rushat/second-brain/src/main/services/ChatService.ts:434): schema tells the LLM to return `title` and `filename`.
- [ChatService.ts:1494](/home/rushat/second-brain/src/main/services/ChatService.ts:1494): the user prompt includes `preferred_filename`.
- [ChatService.ts:1557](/home/rushat/second-brain/src/main/services/ChatService.ts:1557): proxy artifact planner sends `artifactPlannerSystemPrompt(tools)` as the system message.
- [ChatService.ts:1510](/home/rushat/second-brain/src/main/services/ChatService.ts:1510): local model planner uses the same system prompt.
- [ChatService.ts:1610](/home/rushat/second-brain/src/main/services/ChatService.ts:1610): returned `title` / `filename` are normalized.
- [ChatService.ts:1445](/home/rushat/second-brain/src/main/services/ChatService.ts:1445): generated artifact uses planned filename, otherwise fallback.

Fallback naming is deterministic here:
- [ChatService.ts:411](/home/rushat/second-brain/src/main/services/ChatService.ts:411): `artifactTitleFromQuestion()`
- [ChatService.ts:425](/home/rushat/second-brain/src/main/services/ChatService.ts:425): `artifactFileName()`

**Saving Chat Queries To Graphify Memory**
This is not an LLM instruction. It is app logic after a successful answer.

Entry points:
- Non-streaming chat saves at [ChatService.ts:630](/home/rushat/second-brain/src/main/services/ChatService.ts:630)
- Streaming chat saves at [ChatService.ts:820](/home/rushat/second-brain/src/main/services/ChatService.ts:820)

The actual saver is:
- [ChatService.ts:968](/home/rushat/second-brain/src/main/services/ChatService.ts:968): `saveGraphifyResultBestEffort(...)`
- [ChatService.ts:980](/home/rushat/second-brain/src/main/services/ChatService.ts:980): calls local MCP tool `save_graphify_result`
- [ChatService.ts:978](/home/rushat/second-brain/src/main/services/ChatService.ts:978): collects node IDs from `graphify.nodeHits`

The local MCP tool is registered here:
- [LocalToolRegistry.ts:227](/home/rushat/second-brain/src/main/services/LocalToolRegistry.ts:227): `save_graphify_result`
- [LocalToolRegistry.ts:241](/home/rushat/second-brain/src/main/services/LocalToolRegistry.ts:241): executes `graphifyContext.saveResult(...)`

The Graphify CLI call is built here:
- [GraphifyContextService.ts:590](/home/rushat/second-brain/src/main/services/GraphifyContextService.ts:590): `saveResult(...)`
- [GraphifyContextService.ts:599](/home/rushat/second-brain/src/main/services/GraphifyContextService.ts:599): runs `graphify save-result --question ... --answer ... --type query`
- [GraphifyContextService.ts:600](/home/rushat/second-brain/src/main/services/GraphifyContextService.ts:600): adds `--nodes` when node hits exist

Shared input type:
- [brain.ts](/home/rushat/second-brain/src/shared/brain.ts:334): `SaveGraphifyResultInput`

So, short version: **artifact names are LLM-planned in `artifactPlannerSystemPrompt()`; Graphify memory saving is deterministic post-response logic through `saveGraphifyResultBestEffort()` -> `save_graphify_result` -> `graphify save-result`.**