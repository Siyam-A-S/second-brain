# Graph Report - second-brain  (2026-06-11)

## Corpus Check
- 57 files · ~32,177 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 675 nodes · 1274 edges · 38 communities (31 shown, 7 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.78)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `345d47ff`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_GraphRAG Services|GraphRAG Services]]
- [[_COMMUNITY_Electron Shell|Electron Shell]]
- [[_COMMUNITY_Packaging Config|Packaging Config]]
- [[_COMMUNITY_Demo Mockup Logic|Demo Mockup Logic]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Markdown Storage|Markdown Storage]]
- [[_COMMUNITY_Project Dependencies|Project Dependencies]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Drop UI Components|Drop UI Components]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Embedding Pipeline|Embedding Pipeline]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Base TS Config|Base TS Config]]
- [[_COMMUNITY_Renderer TS Config|Renderer TS Config]]
- [[_COMMUNITY_Graphify Workflow|Graphify Workflow]]
- [[_COMMUNITY_Main TS Config|Main TS Config]]
- [[_COMMUNITY_Preload TS Config|Preload TS Config]]
- [[_COMMUNITY_Onboarding Demo Tests|Onboarding Demo Tests]]
- [[_COMMUNITY_Constellation Visual|Constellation Visual]]
- [[_COMMUNITY_Hook Config|Hook Config]]
- [[_COMMUNITY_TS Project Refs|TS Project Refs]]
- [[_COMMUNITY_Vite Dev Server|Vite Dev Server]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]

## God Nodes (most connected - your core abstractions)
1. `GraphifyController` - 57 edges
2. `StorageService` - 22 edges
3. `BrainNode` - 21 edges
4. `AiSettings` - 20 edges
5. `LlmService` - 18 edges
6. `ProcessDroppedItem` - 16 edges
7. `GraphRagService` - 15 edges
8. `scripts` - 13 edges
9. `LocalMcpServer` - 13 edges
10. `SmartClipService` - 13 edges

## Surprising Connections (you probably didn't know these)
- `Drop Lane` --semantically_similar_to--> `Onboarding Drop Tests`  [INFERRED] [semantically similar]
  mockups/second-brain-live-demo/index.html → tests/onboarding/README.md
- `Development Commands` --conceptually_related_to--> `Second Brain Live Demo App`  [INFERRED]
  dev/chatnotes.md → mockups/second-brain-live-demo/index.html
- `Project Graphify Instructions` --references--> `Query Flow`  [EXTRACTED]
  AGENTS.md → .codex/skills/graphify/references/query.md
- `GraphifyController` --references--> `LlmService`  [EXTRACTED]
  src/main/services/GraphifyController.ts → src/main/services/LlmService.ts
- `Window` --references--> `SecondBrainApi`  [EXTRACTED]
  src/vite-env.d.ts → src/shared/ipc.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Graphify Extraction Pipeline** — graphify_skill_default_build_pipeline, graphify_skill_structural_extraction, graphify_skill_semantic_extraction [EXTRACTED 1.00]
- **Second Brain Ingest And Onboarding Surface** — second_brain_live_demo_index_drop_lane, second_brain_live_demo_index_board_canvas, onboarding_readme_onboarding_drop_tests [INFERRED 0.75]
- **Vault Constellation Graph Motif** — assets_vault_constellation_constellation_network, assets_vault_constellation_knowledge_nodes, assets_vault_constellation_graph_connections [EXTRACTED 1.00]

## Communities (38 total, 7 thin omitted)

### Community 0 - "GraphRAG Services"
Cohesion: 0.06
Nodes (29): AiSettingsProvider, asRecord(), asString(), bufferFromDroppedValue(), chunkArray(), collapsibleTextExtensions, errorMessage(), GraphifyController (+21 more)

### Community 1 - "Electron Shell"
Cohesion: 0.12
Nodes (21): asRecord(), asString(), buildDegreeMap(), countBy(), extractLinks(), extractNodes(), fallbackDate, GraphifyBoardService (+13 more)

### Community 2 - "Packaging Config"
Cohesion: 0.05
Nodes (37): appId, asar, directories, buildResources, output, files, linux, target (+29 more)

### Community 3 - "Demo Mockup Logic"
Cohesion: 0.25
Nodes (7): graphify reference: extra exports and benchmark, Step 6b - Wiki (only if --wiki flag), Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag), Step 7b - SVG export (only if --svg flag), Step 7c - GraphML export (only if --graphml flag), Step 7d - MCP server (only if --mcp flag), Step 8 - Token reduction benchmark (only if total_words > 5000)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (30): Sidebar(), TitleBar(), ExportState, formatRelativeTime(), LoadState, TopicCanvas(), TopicCanvasProps, validationClass() (+22 more)

### Community 5 - "Markdown Storage"
Cohesion: 0.07
Nodes (31): CandidateScore, deriveTopicTitle(), GraphRagService, validationBoost(), exportBoardPlaintextSchema, fetchFileSegmentsSchema, ingestAndRouteFragmentSchema, searchBoardTopologySchema (+23 more)

### Community 6 - "Project Dependencies"
Cohesion: 0.07
Nodes (26): author, dependencies, gray-matter, @modelcontextprotocol/sdk, uuid, @xenova/transformers, zod, description (+18 more)

### Community 7 - "Community 7"
Cohesion: 0.17
Nodes (7): CachedEmbedding, EmbeddingService, fingerprintNode(), searchableText(), TransformersModule, BrainSearchResult, SearchBrainNodesInput

### Community 9 - "Drop UI Components"
Cohesion: 0.50
Nodes (3): For SSH/headless:, Use:, Verification:

### Community 10 - "Community 10"
Cohesion: 0.10
Nodes (23): ExportState, LoadState, progressClass(), progressWidth(), statusOptions, TrackerTable(), TrackerTableProps, normalizeDate() (+15 more)

### Community 11 - "Embedding Pipeline"
Cohesion: 0.16
Nodes (13): createMainWindow(), createWidgetWindow(), isDev, loadRenderer(), preloadEntry, rendererEntry, restoreMainWindow(), showWidget() (+5 more)

### Community 12 - "Community 12"
Cohesion: 0.11
Nodes (19): ClipboardList(), ClipboardListProps, icons, SidebarProps, compact(), extractBashCommands(), extractPaths(), extractTextClip() (+11 more)

### Community 13 - "Base TS Config"
Cohesion: 0.18
Nodes (10): compilerOptions, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, lib, noUncheckedIndexedAccess, resolveJsonModule, skipLibCheck (+2 more)

### Community 14 - "Renderer TS Config"
Cohesion: 0.18
Nodes (10): compilerOptions, allowSyntheticDefaultImports, composite, jsx, module, moduleResolution, noEmit, types (+2 more)

### Community 15 - "Graphify Workflow"
Cohesion: 0.06
Nodes (32): Project Graphify Instructions, Codex Semantic Subagents, Default Build Pipeline, For /graphify add and --watch, For /graphify query, For the commit hook and native CLAUDE.md integration, For --update and --cluster-only, /graphify (+24 more)

### Community 16 - "Main TS Config"
Cohesion: 0.20
Nodes (9): compilerOptions, composite, module, moduleResolution, outDir, rootDir, types, extends (+1 more)

### Community 17 - "Preload TS Config"
Cohesion: 0.20
Nodes (9): compilerOptions, composite, module, moduleResolution, outDir, rootDir, types, extends (+1 more)

### Community 18 - "Onboarding Demo Tests"
Cohesion: 0.29
Nodes (6): Development Commands, Deterministic Fake Vectorizer, Onboarding Drop Tests, Board Canvas, Drop Lane, Second Brain Live Demo App

### Community 19 - "Constellation Visual"
Cohesion: 0.67
Nodes (4): Constellation Network, Graph Connections, Knowledge Nodes, Vault Constellation SVG

### Community 24 - "Community 24"
Cohesion: 0.50
Nodes (3): For /graphify add, For --watch, graphify reference: add a URL and watch a folder

### Community 25 - "Community 25"
Cohesion: 0.50
Nodes (3): For git commit hook, For native CLAUDE.md integration, graphify reference: commit hook and native CLAUDE.md integration

### Community 26 - "Community 26"
Cohesion: 0.50
Nodes (3): For /graphify explain, For /graphify path, graphify reference: query, path, explain

### Community 27 - "Community 27"
Cohesion: 0.50
Nodes (3): For --cluster-only, For --update (incremental re-extraction), graphify reference: incremental update and cluster-only

### Community 32 - "Community 32"
Cohesion: 0.08
Nodes (31): AgentMethodConfig, agentPrompts, AiSettingsProvider, ChatCompletionResponse, ChatMessage, compactText(), ExtractedTrackerMetadata, GraphCardDefinition (+23 more)

### Community 33 - "Community 33"
Cohesion: 0.12
Nodes (11): BoardRenderer(), BoardRendererProps, BoardTab, boardTabs, formatDate(), GraphHtmlViewer(), GraphHtmlDocument, BoardState (+3 more)

### Community 34 - "Community 34"
Cohesion: 0.20
Nodes (10): BoardChannel, BrainChannel, ClipboardChannel, FileChannel, SettingsChannel, TrackerChannel, WidgetBounds, WindowChannel (+2 more)

### Community 35 - "Community 35"
Cohesion: 0.42
Nodes (5): AiSettingsService, normalizeApiKey(), normalizeEndpoint(), normalizeModel(), UpdateAiSettingsInput

### Community 36 - "Community 36"
Cohesion: 0.12
Nodes (12): DropTarget(), DropTargetProps, DropTone, toneColors, createDropPayload(), ElectronFile, DroppedFile, FilesDroppedPayload (+4 more)

### Community 37 - "Community 37"
Cohesion: 0.18
Nodes (10): api, boardChannels, brainChannels, clipboardChannels, fileChannels, settingsChannels, trackerChannels, windowChannels (+2 more)

### Community 38 - "Community 38"
Cohesion: 0.09
Nodes (17): AgentController, DraftFragment, inferContextHints(), inferTitle(), looksTrackable(), summarize(), LocalMcpServer, LocalMcpServerOptions (+9 more)

## Knowledge Gaps
- **228 isolated node(s):** `PreToolUse`, `appId`, `productName`, `output`, `buildResources` (+223 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `GraphifyController` connect `GraphRAG Services` to `Community 32`, `Embedding Pipeline`, `Community 38`?**
  _High betweenness centrality (0.072) - this node is a cross-community bridge._
- **Why does `AiSettings` connect `GraphRAG Services` to `Community 32`, `Community 34`, `Community 35`, `Markdown Storage`, `Community 12`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `LlmService` connect `Community 32` to `GraphRAG Services`, `Community 10`, `Embedding Pipeline`, `Community 38`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **What connects `PreToolUse`, `appId`, `productName` to the rest of the system?**
  _228 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `GraphRAG Services` be split into smaller, more focused modules?**
  _Cohesion score 0.05671466353217749 - nodes in this community are weakly interconnected._
- **Should `Electron Shell` be split into smaller, more focused modules?**
  _Cohesion score 0.125 - nodes in this community are weakly interconnected._
- **Should `Packaging Config` be split into smaller, more focused modules?**
  _Cohesion score 0.05263157894736842 - nodes in this community are weakly interconnected._