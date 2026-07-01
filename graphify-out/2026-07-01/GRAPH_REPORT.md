# Graph Report - second-brain  (2026-07-01)

## Corpus Check
- 65 files · ~65,879 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1216 nodes · 2906 edges · 55 communities (50 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.78)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `6a54d544`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
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
- [[_COMMUNITY_Community 20|Community 20]]
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
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 60|Community 60]]

## God Nodes (most connected - your core abstractions)
1. `GraphifyController` - 90 edges
2. `ExplorerService` - 37 edges
3. `ChatService` - 35 edges
4. `GraphifyContextService` - 34 edges
5. `AiSettings` - 26 edges
6. `StorageService` - 24 edges
7. `GraphifyContextResult` - 24 edges
8. `LlmService` - 21 edges
9. `AppSettings` - 21 edges
10. `scripts` - 20 edges

## Surprising Connections (you probably didn't know these)
- `Drop Lane` --semantically_similar_to--> `Onboarding Drop Tests`  [INFERRED] [semantically similar]
  mockups/second-brain-live-demo/index.html → tests/onboarding/README.md
- `Development Commands` --conceptually_related_to--> `Second Brain Live Demo App`  [INFERRED]
  dev/chatnotes.md → mockups/second-brain-live-demo/index.html
- `Project Graphify Instructions` --references--> `Query Flow`  [EXTRACTED]
  AGENTS.md → .codex/skills/graphify/references/query.md
- `GraphifyController` --references--> `LlmService`  [EXTRACTED]
  src/main/services/GraphifyController.ts → src/main/services/LlmService.ts
- `GraphifyController` --references--> `GraphDefinitionStatus`  [EXTRACTED]
  src/main/services/GraphifyController.ts → src/shared/brain.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Graphify Extraction Pipeline** — graphify_skill_default_build_pipeline, graphify_skill_structural_extraction, graphify_skill_semantic_extraction [EXTRACTED 1.00]
- **Second Brain Ingest And Onboarding Surface** — second_brain_live_demo_index_drop_lane, second_brain_live_demo_index_board_canvas, onboarding_readme_onboarding_drop_tests [INFERRED 0.75]
- **Vault Constellation Graph Motif** — assets_vault_constellation_constellation_network, assets_vault_constellation_knowledge_nodes, assets_vault_constellation_graph_connections [EXTRACTED 1.00]

## Communities (55 total, 5 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.22
Nodes (5): AgentController, GraphifyProvider, agentPrompts, brainChannels, trackerChannels

### Community 1 - "Electron Shell"
Cohesion: 0.06
Nodes (42): BoardRenderer(), BoardRendererProps, BoardTab, boardTabs, formatDate(), GraphHtmlViewer(), asRecord(), asString() (+34 more)

### Community 2 - "Packaging Config"
Cohesion: 0.10
Nodes (21): devDependencies, autoprefixer, concurrently, cross-env, electron, electron-builder, electron-is-dev, framer-motion (+13 more)

### Community 3 - "Demo Mockup Logic"
Cohesion: 0.09
Nodes (21): AiSettingsProvider, bufferFromDroppedValue(), collapsibleTextExtensions, GraphifyGraph, GraphifyInvocation, GraphifyLinkRecord, GraphifyLocalModelSettings, GraphifyNodeRecord (+13 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (41): CreateToolArtifactInput, AppSettingsProvider, artifactFileName(), ArtifactIngestor, artifactMimeFromName(), artifactPlannerSystemPrompt(), artifactPlanTimeoutMs, artifactTitleFromQuestion() (+33 more)

### Community 5 - "Markdown Storage"
Cohesion: 0.12
Nodes (11): CandidateScore, deriveTopicTitle(), GraphRagService, validationBoost(), BoardChildNode, ExportBoardPlaintextInput, FetchFileSegmentsInput, IngestAndRouteFragmentInput (+3 more)

### Community 6 - "Project Dependencies"
Cohesion: 0.10
Nodes (20): scripts, build, build:electron, dev, dev:headless, dev:renderer, icons:generate, package:dir (+12 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (52): displaySource(), emptyDetailsNode(), ExplorerWorkbench(), ExplorerWorkbenchProps, formatDate(), kindLabel(), LoadState, nodeIcon() (+44 more)

### Community 8 - "Community 8"
Cohesion: 0.07
Nodes (37): asRecord(), asString(), buildInlineGraphTraversalStdout(), citationFromNodeHit(), compact(), dedupeCitations(), errorMessage(), excerptTitle() (+29 more)

### Community 9 - "Drop UI Components"
Cohesion: 0.25
Nodes (7): 1. The Math Behind Short/Frequent Calls, 2. The Trap of Large/Infrequent Payloads, 3. The Exception: Vertex AI Context Caching, For SSH/headless:, The Ideal Architecture, Use:, Verification:

### Community 10 - "Community 10"
Cohesion: 0.17
Nodes (7): CachedEmbedding, EmbeddingService, fingerprintNode(), searchableText(), TransformersModule, BrainSearchResult, SearchBrainNodesInput

### Community 11 - "Embedding Pipeline"
Cohesion: 0.06
Nodes (40): clipboardFilePathsFromText(), createMainWindow(), createProjectRuntime(), createWidgetWindow(), isDev, loadRenderer(), preloadEntry, ProjectRuntime (+32 more)

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

### Community 20 - "Community 20"
Cohesion: 0.15
Nodes (9): SettingsPanel(), SettingsPanelProps, ThemeMode, TitleBar(), TitleBarProps, ActiveView, keypiphyPaletteFromHue(), themeVariableNames (+1 more)

### Community 24 - "Community 24"
Cohesion: 0.22
Nodes (18): Any, BaseModel, JSONResponse, build_vertex_body(), chat(), chat_completions(), configured_key_hashes(), enforce_rate_limit() (+10 more)

### Community 25 - "Community 25"
Cohesion: 0.12
Nodes (7): defaultUpdateCommand(), errorMessage(), GraphifyController, isProxyAiSettings(), looksComplete(), numberFromEnv(), AiSettings

### Community 26 - "Community 26"
Cohesion: 0.19
Nodes (4): canInlineSourceComment(), readInlineSourceComment(), sourceCommentFileName(), GraphifyIngestionResult

### Community 27 - "Community 27"
Cohesion: 0.20
Nodes (11): exists(), isEnoent(), nowIso(), ProjectService, ProjectState, safeProjectId(), CreateProjectInput, ProjectRecord (+3 more)

### Community 29 - "Community 29"
Cohesion: 0.21
Nodes (13): legacyTrackerToTicket(), normalizeOptionalDate(), normalizePriority(), normalizeStatus(), normalizeStringArray(), normalizeText(), nowIso(), trackerPriorities (+5 more)

### Community 31 - "Community 31"
Cohesion: 0.10
Nodes (19): browserAiSettings, browserApiFallback, browserAppSettings, browserDefinitionStatus, browserExplorerTree, browserPaper, browserPaperDetails, browserProjects (+11 more)

### Community 32 - "Community 32"
Cohesion: 0.08
Nodes (34): AgentMethodConfig, AiSettingsProvider, ChatAttemptOptions, ChatCompletionChunk, ChatCompletionResponse, ChatMessage, errorText(), extractChatContent() (+26 more)

### Community 33 - "Community 33"
Cohesion: 0.10
Nodes (28): asRecord(), asString(), emptyLiterature, endpointId(), GraphJson, GraphLink, graphLinks(), GraphNode (+20 more)

### Community 34 - "Community 34"
Cohesion: 0.25
Nodes (7): Connect AI, Develop, Download, macOS Apple Silicon Beta Get Started, Runtime Dependencies, Second Brain, Windows Get Started

### Community 35 - "Community 35"
Cohesion: 0.18
Nodes (20): AiSettingsService, asRecord(), booleanSetting(), defaultAppearanceSettings, defaultGraphifySettings, normalizeAiMode(), normalizeApiKey(), normalizeAppearanceSettings() (+12 more)

### Community 37 - "Community 37"
Cohesion: 0.21
Nodes (15): DependencyRuntimeService, errorText(), graphifyPathCandidates(), isCmdShim(), macBinaryCandidates(), parsePythonVersion(), pythonCandidates(), repairCommandText() (+7 more)

### Community 38 - "Community 38"
Cohesion: 0.25
Nodes (7): author, description, license, main, name, private, version

### Community 39 - "Community 39"
Cohesion: 0.29
Nodes (7): dependencies, gray-matter, @modelcontextprotocol/sdk, react-force-graph-2d, uuid, @xenova/transformers, zod

### Community 40 - "Community 40"
Cohesion: 0.17
Nodes (10): DropTarget(), DropTargetProps, DropTone, toneColors, ProjectList(), ProjectListProps, Sidebar(), SidebarProps (+2 more)

### Community 41 - "Community 41"
Cohesion: 0.06
Nodes (41): applyDocumentLayout(), ArtifactToolService, bufferFromInput(), crc32(), DocumentLine, docxParagraph(), dosDateTime(), ensureExtension() (+33 more)

### Community 42 - "Community 42"
Cohesion: 0.20
Nodes (9): **CLI-Level Controls**, **Environmental Controls**, Fine-Grained Controls for Graph Extraction, **Graph-Time Configuration**, Invocation Summary, **MCP Resources** (read-only):, MCP Tools Available (7 Total), **Programmatic/Library Controls** (+1 more)

### Community 43 - "Community 43"
Cohesion: 0.18
Nodes (8): createDropPayload(), ElectronFile, DroppedFile, FilesDroppedPayload, WidgetMovePayload, DragState, DropTone, toneColors

### Community 44 - "Community 44"
Cohesion: 0.33
Nodes (5): Deploy, Environment, Routes, Run Locally, Second Brain Managed Proxy

### Community 45 - "Community 45"
Cohesion: 0.15
Nodes (8): ChatWorkbench(), ChatWorkbenchProps, MarkdownBlock, MessageContent(), ResponseSection, slug(), splitResponseSections(), ChatStreamEvent

### Community 46 - "Community 46"
Cohesion: 0.20
Nodes (12): parseArgs(), macBinaryCandidates(), RuntimeCommandCandidate, runtimeGraphifyCommands(), runtimePathSegments(), runtimePythonCommands(), runtimeUvCommands(), uniqueRuntimeCandidates() (+4 more)

### Community 47 - "Community 47"
Cohesion: 0.11
Nodes (17): api, boardChannels, brainChannels, chatChannels, clipboardChannels, explorerChannels, fileChannels, graphBoardChannels (+9 more)

### Community 48 - "Community 48"
Cohesion: 0.15
Nodes (9): asRecord(), asString(), chunkArray(), endpointHostLabel(), linkEndpointId(), normalizeGraphLinks(), normalizeGraphNodes(), normalizeSourceReference() (+1 more)

### Community 49 - "Community 49"
Cohesion: 0.31
Nodes (8): ExportState, formatRelativeTime(), LoadState, TopicCanvas(), TopicCanvasProps, validationClass(), validationLabel(), UserValidationState

### Community 50 - "Community 50"
Cohesion: 0.16
Nodes (10): LoadState, priorityOptions, statusOptions, TrackerTable(), TrackerTableProps, TrackerIngestionStatus, TrackerPriority, TrackerStatus (+2 more)

### Community 51 - "Community 51"
Cohesion: 0.33
Nodes (5): installBrowserApiFallback(), params, windowName, FloatingWidget(), MainApp()

### Community 53 - "Community 53"
Cohesion: 0.12
Nodes (14): AiMode, AppearanceSettings, BoardTopologyNode, ChatArtifactSource, ChatRole, ClipboardIngestibleItemsResult, GraphifyRuntimeSettings, ListBrainNodesInput (+6 more)

### Community 55 - "Community 55"
Cohesion: 0.26
Nodes (9): clampImportance(), createUuid(), isUserValidationState(), slugifyFilePart(), stringArray(), UuidModule, wordsIn(), BrainNodeFrontmatter (+1 more)

### Community 60 - "Community 60"
Cohesion: 0.33
Nodes (5): Allow In System Settings, First Launch, If It Still Does Not Open, Install, Second Brain macOS Beta Testing Guide

## Knowledge Gaps
- **298 isolated node(s):** `name`, `version`, `description`, `main`, `author` (+293 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `GraphifyController` connect `Community 25` to `Community 0`, `Community 32`, `Demo Mockup Logic`, `Embedding Pipeline`, `Community 46`, `Community 48`, `Community 26`?**
  _High betweenness centrality (0.089) - this node is a cross-community bridge._
- **Why does `GraphifyContextService` connect `Community 8` to `Community 41`, `Embedding Pipeline`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `ExplorerService` connect `Community 7` to `Embedding Pipeline`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _298 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Electron Shell` be split into smaller, more focused modules?**
  _Cohesion score 0.05575065847234416 - nodes in this community are weakly interconnected._
- **Should `Packaging Config` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._
- **Should `Demo Mockup Logic` be split into smaller, more focused modules?**
  _Cohesion score 0.08505747126436781 - nodes in this community are weakly interconnected._