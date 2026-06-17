# Graph Report - second-brain  (2026-06-16)

## Corpus Check
- 52 files · ~33,756 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 748 nodes · 1588 edges · 37 communities (31 shown, 6 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.78)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `541b9e3c`
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
- [[_COMMUNITY_Community 8|Community 8]]
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

## God Nodes (most connected - your core abstractions)
1. `GraphifyController` - 72 edges
2. `GraphFilesystemService` - 26 edges
3. `StorageService` - 22 edges
4. `BrainNode` - 21 edges
5. `LlmService` - 18 edges
6. `AiSettings` - 18 edges
7. `ProcessDroppedItem` - 16 edges
8. `GraphRagService` - 15 edges
9. `GraphifyIngestionResult` - 14 edges
10. `scripts` - 13 edges

## Surprising Connections (you probably didn't know these)
- `Drop Lane` --semantically_similar_to--> `Onboarding Drop Tests`  [INFERRED] [semantically similar]
  mockups/second-brain-live-demo/index.html → tests/onboarding/README.md
- `Development Commands` --conceptually_related_to--> `Second Brain Live Demo App`  [INFERRED]
  dev/chatnotes.md → mockups/second-brain-live-demo/index.html
- `Project Graphify Instructions` --references--> `Query Flow`  [EXTRACTED]
  AGENTS.md → .codex/skills/graphify/references/query.md
- `GraphifyController` --references--> `LlmService`  [EXTRACTED]
  src/main/services/GraphifyController.ts → src/main/services/LlmService.ts
- `GraphifyController` --references--> `GraphifyIngestionResult`  [EXTRACTED]
  src/main/services/GraphifyController.ts → src/shared/brain.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Graphify Extraction Pipeline** — graphify_skill_default_build_pipeline, graphify_skill_structural_extraction, graphify_skill_semantic_extraction [EXTRACTED 1.00]
- **Second Brain Ingest And Onboarding Surface** — second_brain_live_demo_index_drop_lane, second_brain_live_demo_index_board_canvas, onboarding_readme_onboarding_drop_tests [INFERRED 0.75]
- **Vault Constellation Graph Motif** — assets_vault_constellation_constellation_network, assets_vault_constellation_knowledge_nodes, assets_vault_constellation_graph_connections [EXTRACTED 1.00]

## Communities (37 total, 6 thin omitted)

### Community 0 - "GraphRAG Services"
Cohesion: 0.12
Nodes (4): GraphifyController, isCmdShim(), parseArgs(), GraphifyMcpToolSpec

### Community 1 - "Electron Shell"
Cohesion: 0.10
Nodes (29): asRecord(), asString(), buildDegreeMap(), compactSearchText(), countBy(), displaySourcePath(), extractLinks(), extractNodes() (+21 more)

### Community 2 - "Packaging Config"
Cohesion: 0.05
Nodes (37): appId, asar, directories, buildResources, output, files, linux, target (+29 more)

### Community 3 - "Demo Mockup Logic"
Cohesion: 0.11
Nodes (17): AiSettingsProvider, asRecord(), asString(), chunkArray(), collapsibleTextExtensions, GraphifyGraph, GraphifyInvocation, GraphifyLinkRecord (+9 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (33): DropTargetProps, DropTone, toneColors, addBrowserSmartClip(), browserAiSettings, browserApiFallback, browserAppSettings, browserSmartClips (+25 more)

### Community 5 - "Markdown Storage"
Cohesion: 0.06
Nodes (35): CachedEmbedding, EmbeddingService, fingerprintNode(), searchableText(), TransformersModule, CandidateScore, deriveTopicTitle(), GraphRagService (+27 more)

### Community 6 - "Project Dependencies"
Cohesion: 0.07
Nodes (26): author, dependencies, gray-matter, @modelcontextprotocol/sdk, uuid, @xenova/transformers, zod, description (+18 more)

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (28): asRecord(), asString(), compactSearchText(), decodeIdPart(), encodeIdPart(), folderId(), generatedDirectoryNames, GraphFilesystemService (+20 more)

### Community 8 - "Community 8"
Cohesion: 0.25
Nodes (9): emptyDetailsNode(), FilesystemExplorer(), FilesystemExplorerProps, formatDate(), kindLabel(), LoadState, nodeIcon(), TreeRow() (+1 more)

### Community 9 - "Drop UI Components"
Cohesion: 0.50
Nodes (3): For SSH/headless:, Use:, Verification:

### Community 10 - "Community 10"
Cohesion: 0.10
Nodes (23): ExportState, LoadState, progressClass(), progressWidth(), statusOptions, TrackerTable(), TrackerTableProps, normalizeDate() (+15 more)

### Community 11 - "Embedding Pipeline"
Cohesion: 0.15
Nodes (14): createMainWindow(), createWidgetWindow(), isDev, loadRenderer(), preloadEntry, rendererEntry, restoreMainWindow(), showWidget() (+6 more)

### Community 12 - "Community 12"
Cohesion: 0.10
Nodes (23): AgentController, DraftFragment, inferContextHints(), inferTitle(), looksTrackable(), summarize(), compact(), extractBashCommands() (+15 more)

### Community 13 - "Base TS Config"
Cohesion: 0.18
Nodes (10): compilerOptions, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, lib, noUncheckedIndexedAccess, resolveJsonModule, skipLibCheck (+2 more)

### Community 14 - "Renderer TS Config"
Cohesion: 0.18
Nodes (10): compilerOptions, allowSyntheticDefaultImports, composite, jsx, module, moduleResolution, noEmit, types (+2 more)

### Community 15 - "Graphify Workflow"
Cohesion: 0.22
Nodes (9): Project Graphify Instructions, Codex Semantic Subagents, Default Build Pipeline, Graphify Skill, Semantic Extraction, Structural Extraction, MCP Server, Query Flow (+1 more)

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

### Community 20 - "Hook Config"
Cohesion: 0.17
Nodes (13): BoardChannel, BrainChannel, ClipboardChannel, FileChannel, FilesystemChannel, SettingsChannel, TrackerChannel, WidgetBounds (+5 more)

### Community 24 - "Community 24"
Cohesion: 0.18
Nodes (10): api, boardChannels, brainChannels, clipboardChannels, fileChannels, filesystemChannels, settingsChannels, trackerChannels (+2 more)

### Community 25 - "Community 25"
Cohesion: 0.20
Nodes (3): looksComplete(), numberFromEnv(), AiSettings

### Community 27 - "Community 27"
Cohesion: 0.33
Nodes (5): SourceTreeNodeDetails, SourceTreeNodeKind, SourceTreeRelationItem, SourceTreeSearchInput, SourceTreeSearchResult

### Community 28 - "Community 28"
Cohesion: 0.22
Nodes (4): errorMessage(), isSpreadsheetSource(), spreadsheetComponentFileName(), spreadsheetComponentScript()

### Community 32 - "Community 32"
Cohesion: 0.05
Nodes (43): AgentMethodConfig, agentPrompts, AiSettingsProvider, ChatCompletionResponse, ChatMessage, compactText(), ExtractedTrackerMetadata, GraphCardDefinition (+35 more)

### Community 33 - "Community 33"
Cohesion: 0.50
Nodes (3): BoardState, LoadState, BoardRule

### Community 34 - "Community 34"
Cohesion: 0.33
Nodes (5): Connect AI, Develop, Environment Variables, Install, Second Brain

### Community 35 - "Community 35"
Cohesion: 0.27
Nodes (12): AiSettingsService, asRecord(), booleanSetting(), defaultGraphifySettings, normalizeApiKey(), normalizeEndpoint(), normalizeGraphifySettings(), normalizeModel() (+4 more)

### Community 36 - "Community 36"
Cohesion: 0.05
Nodes (28): BoardRenderer(), BoardRendererProps, BoardTab, boardTabs, formatDate(), GraphHtmlViewer(), ClipboardList(), ClipboardListProps (+20 more)

## Knowledge Gaps
- **210 isolated node(s):** `appId`, `productName`, `output`, `buildResources`, `files` (+205 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `GraphifyController` connect `GraphRAG Services` to `Community 32`, `Demo Mockup Logic`, `Embedding Pipeline`, `Community 12`, `Community 25`, `Community 26`, `Community 28`, `Community 29`?**
  _High betweenness centrality (0.102) - this node is a cross-community bridge._
- **Why does `GraphFilesystemService` connect `Community 7` to `Embedding Pipeline`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Why does `LlmService` connect `Community 32` to `GraphRAG Services`, `Demo Mockup Logic`, `Community 10`, `Embedding Pipeline`, `Community 12`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **What connects `appId`, `productName`, `output` to the rest of the system?**
  _210 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `GraphRAG Services` be split into smaller, more focused modules?**
  _Cohesion score 0.12307692307692308 - nodes in this community are weakly interconnected._
- **Should `Electron Shell` be split into smaller, more focused modules?**
  _Cohesion score 0.10365853658536585 - nodes in this community are weakly interconnected._
- **Should `Packaging Config` be split into smaller, more focused modules?**
  _Cohesion score 0.05263157894736842 - nodes in this community are weakly interconnected._