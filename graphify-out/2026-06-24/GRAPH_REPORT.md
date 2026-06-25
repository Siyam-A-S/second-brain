# Graph Report - second-brain  (2026-06-24)

## Corpus Check
- 62 files · ~56,468 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1108 nodes · 2585 edges · 46 communities (42 shown, 4 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.78)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1699503e`
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
- [[_COMMUNITY_Embedding Pipeline|Embedding Pipeline]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Base TS Config|Base TS Config]]
- [[_COMMUNITY_Renderer TS Config|Renderer TS Config]]
- [[_COMMUNITY_Graphify Workflow|Graphify Workflow]]
- [[_COMMUNITY_Main TS Config|Main TS Config]]
- [[_COMMUNITY_Preload TS Config|Preload TS Config]]
- [[_COMMUNITY_Onboarding Demo Tests|Onboarding Demo Tests]]
- [[_COMMUNITY_Constellation Visual|Constellation Visual]]
- [[_COMMUNITY_TS Project Refs|TS Project Refs]]
- [[_COMMUNITY_Vite Dev Server|Vite Dev Server]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
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
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 52|Community 52]]

## God Nodes (most connected - your core abstractions)
1. `GraphifyController` - 85 edges
2. `ExplorerService` - 37 edges
3. `ChatService` - 30 edges
4. `StorageService` - 24 edges
5. `AiSettings` - 23 edges
6. `LlmService` - 21 edges
7. `GraphifyContextService` - 20 edges
8. `BrainNode` - 19 edges
9. `GraphifyIngestionResult` - 18 edges
10. `ProjectService` - 17 edges

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

## Communities (46 total, 4 thin omitted)

### Community 0 - "GraphRAG Services"
Cohesion: 0.10
Nodes (11): BoardRenderer(), BoardRendererProps, BoardTab, boardTabs, formatDate(), GraphHtmlViewer(), GraphHtmlDocument, BoardState (+3 more)

### Community 1 - "Electron Shell"
Cohesion: 0.10
Nodes (30): asRecord(), asString(), buildDegreeMap(), compactSearchText(), countBy(), displaySourcePath(), extractLinks(), extractNodes() (+22 more)

### Community 2 - "Packaging Config"
Cohesion: 0.10
Nodes (20): devDependencies, autoprefixer, concurrently, cross-env, electron, electron-is-dev, framer-motion, lucide-react (+12 more)

### Community 3 - "Demo Mockup Logic"
Cohesion: 0.09
Nodes (22): AiSettingsProvider, bufferFromDroppedValue(), chunkArray(), collapsibleTextExtensions, endpointHostLabel(), GraphifyGraph, GraphifyInvocation, GraphifyLinkRecord (+14 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (40): ChatWorkbench(), ChatWorkbenchProps, MarkdownBlock, MessageContent(), ResponseSection, slug(), splitResponseSections(), AppSettingsProvider (+32 more)

### Community 5 - "Markdown Storage"
Cohesion: 0.05
Nodes (38): CachedEmbedding, EmbeddingService, fingerprintNode(), searchableText(), TransformersModule, CandidateScore, deriveTopicTitle(), GraphRagService (+30 more)

### Community 6 - "Project Dependencies"
Cohesion: 0.15
Nodes (13): scripts, build, build:electron, dev, dev:headless, dev:renderer, package:win, package:win:installer (+5 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (52): displaySource(), emptyDetailsNode(), ExplorerWorkbench(), ExplorerWorkbenchProps, formatDate(), kindLabel(), LoadState, nodeIcon() (+44 more)

### Community 8 - "Community 8"
Cohesion: 0.11
Nodes (16): asRecord(), asString(), compact(), errorMessage(), excerptTitle(), extractCitations(), extractContextPathCandidates(), formatInvocation() (+8 more)

### Community 9 - "Drop UI Components"
Cohesion: 0.50
Nodes (3): For SSH/headless:, Use:, Verification:

### Community 11 - "Embedding Pipeline"
Cohesion: 0.06
Nodes (45): clipboardFilePathsFromText(), createMainWindow(), createProjectRuntime(), createWidgetWindow(), isDev, loadRenderer(), preloadEntry, ProjectRuntime (+37 more)

### Community 12 - "Community 12"
Cohesion: 0.09
Nodes (33): displaySource(), ForceLink, ForceNode, GraphBoardRenderer(), GraphBoardRendererProps, LoadState, paperStatusLabel(), titleCase() (+25 more)

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

### Community 24 - "Community 24"
Cohesion: 0.22
Nodes (18): Any, BaseModel, JSONResponse, build_vertex_body(), chat(), chat_completions(), configured_key_hashes(), enforce_rate_limit() (+10 more)

### Community 25 - "Community 25"
Cohesion: 0.10
Nodes (5): GraphifyController, isCmdShim(), researchDependencyStatusScript(), GraphDefinitionStatus, ResearchDependencyReport

### Community 26 - "Community 26"
Cohesion: 0.18
Nodes (4): canInlineSourceComment(), readInlineSourceComment(), sourceCommentFileName(), GraphifyIngestionResult

### Community 27 - "Community 27"
Cohesion: 0.20
Nodes (11): exists(), isEnoent(), nowIso(), ProjectService, ProjectState, safeProjectId(), CreateProjectInput, ProjectRecord (+3 more)

### Community 29 - "Community 29"
Cohesion: 0.05
Nodes (43): LoadState, priorityOptions, statusOptions, TrackerTable(), TrackerTableProps, browserAiSettings, browserApiFallback, browserAppSettings (+35 more)

### Community 31 - "Community 31"
Cohesion: 0.12
Nodes (13): installBrowserApiFallback(), createDropPayload(), ElectronFile, params, windowName, DroppedFile, FilesDroppedPayload, WidgetMovePayload (+5 more)

### Community 32 - "Community 32"
Cohesion: 0.08
Nodes (34): AgentMethodConfig, AiSettingsProvider, ChatAttemptOptions, ChatCompletionChunk, ChatCompletionResponse, ChatMessage, errorText(), extractChatContent() (+26 more)

### Community 33 - "Community 33"
Cohesion: 0.09
Nodes (28): asRecord(), asString(), emptyLiterature, endpointId(), GraphJson, GraphLink, graphLinks(), GraphNode (+20 more)

### Community 34 - "Community 34"
Cohesion: 0.33
Nodes (5): Connect AI, Develop, Environment Variables, Install, Second Brain

### Community 35 - "Community 35"
Cohesion: 0.19
Nodes (19): AiSettingsService, asRecord(), booleanSetting(), defaultGraphifySettings, normalizeAiMode(), normalizeApiKey(), normalizeEndpoint(), normalizeGraphifySettings() (+11 more)

### Community 36 - "Community 36"
Cohesion: 0.12
Nodes (15): DropTarget(), DropTargetProps, DropTone, toneColors, ProjectList(), ProjectListProps, SettingsPanel(), SettingsPanelProps (+7 more)

### Community 37 - "Community 37"
Cohesion: 0.29
Nodes (7): DependencyRuntimeService, errorText(), isCmdShim(), parsePythonVersion(), repairCommandText(), DependencyRuntimeStatus, RuntimeDependencyCheck

### Community 38 - "Community 38"
Cohesion: 0.14
Nodes (13): appId, asar, directories, buildResources, output, files, linux, target (+5 more)

### Community 39 - "Community 39"
Cohesion: 0.25
Nodes (7): author, description, license, main, name, private, version

### Community 40 - "Community 40"
Cohesion: 0.29
Nodes (7): dependencies, gray-matter, @modelcontextprotocol/sdk, react-force-graph-2d, uuid, @xenova/transformers, zod

### Community 41 - "Community 41"
Cohesion: 0.07
Nodes (34): agentPrompts, ArtifactToolService, bufferFromInput(), crc32(), CreateToolArtifactInput, dosDateTime(), ensureExtension(), escapeXml() (+26 more)

### Community 42 - "Community 42"
Cohesion: 0.50
Nodes (4): nsis, allowToChangeInstallationDirectory, oneClick, perMachine

### Community 43 - "Community 43"
Cohesion: 0.31
Nodes (8): ExportState, formatRelativeTime(), LoadState, TopicCanvas(), TopicCanvasProps, validationClass(), validationLabel(), UserValidationState

### Community 44 - "Community 44"
Cohesion: 0.33
Nodes (5): Deploy, Environment, Routes, Run Locally, Second Brain Managed Proxy

### Community 47 - "Community 47"
Cohesion: 0.10
Nodes (19): api, boardChannels, brainChannels, chatChannels, clipboardChannels, explorerChannels, fileChannels, graphBoardChannels (+11 more)

### Community 48 - "Community 48"
Cohesion: 0.24
Nodes (6): asRecord(), asString(), linkEndpointId(), normalizeGraphLinks(), normalizeGraphNodes(), normalizeSourceReference()

### Community 52 - "Community 52"
Cohesion: 0.23
Nodes (5): defaultUpdateCommand(), errorMessage(), isProxyAiSettings(), numberFromEnv(), AiSettings

## Knowledge Gaps
- **271 isolated node(s):** `appId`, `productName`, `output`, `buildResources`, `files` (+266 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `GraphifyController` connect `Community 25` to `Community 32`, `Demo Mockup Logic`, `Embedding Pipeline`, `Community 48`, `Community 50`, `Community 52`, `Community 26`, `Community 29`?**
  _High betweenness centrality (0.106) - this node is a cross-community bridge._
- **Why does `ExplorerService` connect `Community 7` to `Embedding Pipeline`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Why does `ChatService` connect `Community 4` to `Community 41`, `Embedding Pipeline`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **What connects `appId`, `productName`, `output` to the rest of the system?**
  _271 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `GraphRAG Services` be split into smaller, more focused modules?**
  _Cohesion score 0.09782608695652174 - nodes in this community are weakly interconnected._
- **Should `Electron Shell` be split into smaller, more focused modules?**
  _Cohesion score 0.10104529616724739 - nodes in this community are weakly interconnected._
- **Should `Packaging Config` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._