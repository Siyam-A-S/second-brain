# Graph Report - second-brain  (2026-07-09)

## Corpus Check
- 76 files · ~84,073 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1472 nodes · 3514 edges · 64 communities (58 shown, 6 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.78)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `43db7ff6`
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
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]

## God Nodes (most connected - your core abstractions)
1. `GraphifyController` - 91 edges
2. `ChatService` - 41 edges
3. `ExplorerService` - 38 edges
4. `GraphifyContextService` - 34 edges
5. `AppSettings` - 27 edges
6. `AiSettings` - 26 edges
7. `GraphifyContextResult` - 26 edges
8. `StorageService` - 24 edges
9. `scripts` - 22 edges
10. `LlmService` - 21 edges

## Surprising Connections (you probably didn't know these)
- `Drop Lane` --semantically_similar_to--> `Onboarding Drop Tests`  [INFERRED] [semantically similar]
  mockups/second-brain-live-demo/index.html → tests/onboarding/README.md
- `Development Commands` --conceptually_related_to--> `Second Brain Live Demo App`  [INFERRED]
  dev/chatnotes.md → mockups/second-brain-live-demo/index.html
- `Project Graphify Instructions` --references--> `Query Flow`  [EXTRACTED]
  AGENTS.md → .codex/skills/graphify/references/query.md
- `pythonCandidates()` --calls--> `runtimePythonCommands()`  [EXTRACTED]
  src/main/services/DependencyRuntimeService.ts → src/main/services/RuntimeCommandPaths.ts
- `graphifyPathCandidates()` --calls--> `runtimeGraphifyCommands()`  [EXTRACTED]
  src/main/services/DependencyRuntimeService.ts → src/main/services/RuntimeCommandPaths.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Graphify Extraction Pipeline** — graphify_skill_default_build_pipeline, graphify_skill_structural_extraction, graphify_skill_semantic_extraction [EXTRACTED 1.00]
- **Second Brain Ingest And Onboarding Surface** — second_brain_live_demo_index_drop_lane, second_brain_live_demo_index_board_canvas, onboarding_readme_onboarding_drop_tests [INFERRED 0.75]
- **Vault Constellation Graph Motif** — assets_vault_constellation_constellation_network, assets_vault_constellation_knowledge_nodes, assets_vault_constellation_graph_connections [EXTRACTED 1.00]

## Communities (64 total, 6 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.20
Nodes (8): asRecord(), asString(), chunkArray(), endpointHostLabel(), linkEndpointId(), normalizeGraphLinks(), normalizeGraphNodes(), normalizeSourceReference()

### Community 1 - "Electron Shell"
Cohesion: 0.05
Nodes (43): BoardRenderer(), BoardRendererProps, BoardTab, boardTabs, formatDate(), GraphHtmlViewer(), asRecord(), asString() (+35 more)

### Community 2 - "Packaging Config"
Cohesion: 0.10
Nodes (21): devDependencies, autoprefixer, concurrently, cross-env, electron, electron-builder, electron-is-dev, framer-motion (+13 more)

### Community 3 - "Demo Mockup Logic"
Cohesion: 0.08
Nodes (22): AccessTokenProvider, AiSettingsProvider, bufferFromDroppedValue(), collapsibleTextExtensions, GraphifyGraph, GraphifyInvocation, GraphifyLinkRecord, GraphifyLocalModelSettings (+14 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (57): CreateToolArtifactInput, AccessTokenProvider, AppSettingsProvider, artifactChatConfirmation(), artifactFileName(), ArtifactIngestor, artifactMimeFromName(), artifactPlannerSystemPrompt() (+49 more)

### Community 5 - "Markdown Storage"
Cohesion: 0.13
Nodes (12): ThemeMode, TitleBar(), TitleBarProps, installBrowserApiFallback(), params, windowName, FloatingWidget(), ActiveView (+4 more)

### Community 6 - "Project Dependencies"
Cohesion: 0.09
Nodes (22): scripts, build, build:electron, dev, dev:headless, dev:renderer, icons:generate, package:dir (+14 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (51): displaySource(), emptyDetailsNode(), ExplorerWorkbench(), ExplorerWorkbenchProps, formatDate(), kindLabel(), LoadState, nodeIcon() (+43 more)

### Community 8 - "Community 8"
Cohesion: 0.18
Nodes (16): parseArgs(), bundledPythonCommand(), bundledRuntimeBinDir(), bundledRuntimeDir(), macBinaryCandidates(), resourcesPath(), RuntimeCommandCandidate, runtimeGraphifyCommands() (+8 more)

### Community 9 - "Drop UI Components"
Cohesion: 0.20
Nodes (9): 1. The Math Behind Short/Frequent Calls, 2. The Trap of Large/Infrequent Payloads, 3. The Exception: Vertex AI Context Caching, For SSH/headless:, Naming the artifact and memory creation, preflight message, The Ideal Architecture, Use: (+1 more)

### Community 10 - "Community 10"
Cohesion: 0.08
Nodes (18): DropTargetProps, DropTone, toneColors, createDropPayload(), ElectronFile, AgentController, GraphifyProvider, IngestAndRouteFragmentResult (+10 more)

### Community 11 - "Embedding Pipeline"
Cohesion: 0.07
Nodes (29): clipboardFilePathsFromText(), createMainWindow(), createProjectRuntime(), createWidgetWindow(), installZoomShortcuts(), isDev, loadRenderer(), preloadEntry (+21 more)

### Community 12 - "Community 12"
Cohesion: 0.10
Nodes (30): displaySource(), ForceLink, ForceNode, GraphBoardRenderer(), GraphBoardRendererProps, LoadState, paperStatusLabel(), titleCase() (+22 more)

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
Cohesion: 0.06
Nodes (31): browserAiSettings, browserApiFallback, browserAppSettings, browserBuildInfo, browserDefinitionStatus, browserEnv, browserExplorerChild(), browserExplorerChildren() (+23 more)

### Community 24 - "Community 24"
Cohesion: 0.17
Nodes (27): Any, BaseModel, JSONResponse, authenticate_and_meter(), build_vertex_body(), chat(), chat_completions(), configured_key_hashes() (+19 more)

### Community 25 - "Community 25"
Cohesion: 0.11
Nodes (11): ChatWorkbench(), ChatWorkbenchProps, FileCard(), formatBytes(), MarkdownBlock, MessageContent(), ResponseSection, slug() (+3 more)

### Community 26 - "Community 26"
Cohesion: 0.13
Nodes (6): canInlineSourceComment(), GraphifyController, readInlineSourceComment(), sourceCommentFileName(), GraphDefinitionStatus, GraphifyIngestionResult

### Community 27 - "Community 27"
Cohesion: 0.23
Nodes (9): exists(), formatStorageBytes(), isEnoent(), nowIso(), ProjectService, ProjectState, safeProjectId(), ProjectRecord (+1 more)

### Community 29 - "Community 29"
Cohesion: 0.13
Nodes (6): defaultUpdateCommand(), errorMessage(), isProxyAiSettings(), looksComplete(), numberFromEnv(), AiSettings

### Community 31 - "Community 31"
Cohesion: 0.12
Nodes (21): contextSnippet(), notificationKey(), NotificationService, appPriority(), appStatus(), dbPriority(), dbStatus(), DbTrackerRow (+13 more)

### Community 32 - "Community 32"
Cohesion: 0.07
Nodes (36): AgentMethodConfig, agentPrompts, AccessTokenProvider, AiSettingsProvider, ChatAttemptOptions, ChatCompletionChunk, ChatCompletionResponse, ChatMessage (+28 more)

### Community 33 - "Community 33"
Cohesion: 0.11
Nodes (22): asRecord(), asString(), emptyLiterature, endpointId(), GraphJson, GraphLink, graphLinks(), GraphNode (+14 more)

### Community 34 - "Community 34"
Cohesion: 0.22
Nodes (8): Connect AI, Develop, Development macOS Apple Silicon Beta Get Started, Development Windows Get Started, Download, Production Distribution, Runtime Dependencies, Second Brain

### Community 35 - "Community 35"
Cohesion: 0.13
Nodes (29): AiSettingsService, asRecord(), booleanSetting(), defaultAccountSettings, defaultAppearanceSettings, defaultGraphifySettings, migrateLegacyGraphifyDefault(), normalizeAccountAccessStatus() (+21 more)

### Community 36 - "Community 36"
Cohesion: 0.10
Nodes (20): citationFromNodeHit(), compact(), extractContextPathCandidates(), formatInvocation(), formatMcpTool(), graphifyContextTestUtils, GraphifyGraphData, GraphifyGraphLink (+12 more)

### Community 37 - "Community 37"
Cohesion: 0.20
Nodes (15): DependencyRuntimeService, errorText(), graphifyPathCandidates(), isCmdShim(), macBinaryCandidates(), parsePythonVersion(), pythonCandidates(), repairCommandText() (+7 more)

### Community 38 - "Community 38"
Cohesion: 0.25
Nodes (7): author, description, license, main, name, private, version

### Community 39 - "Community 39"
Cohesion: 0.29
Nodes (7): dependencies, gray-matter, @modelcontextprotocol/sdk, react-force-graph-2d, uuid, @xenova/transformers, zod

### Community 40 - "Community 40"
Cohesion: 0.11
Nodes (16): asRecord(), asString(), basenameWithoutExtension(), lineNumberFromLocation(), normalizeRelativePath(), PaperArtifactCandidate, PendingWindow, readableSourceExtensions (+8 more)

### Community 41 - "Community 41"
Cohesion: 0.05
Nodes (50): applyDocumentLayout(), ArtifactAstNode, ArtifactAstPayload, ArtifactAstSpan, artifactGeneratorScript, ArtifactToolService, bufferFromInput(), crc32() (+42 more)

### Community 42 - "Community 42"
Cohesion: 0.20
Nodes (9): **CLI-Level Controls**, **Environmental Controls**, Fine-Grained Controls for Graph Extraction, **Graph-Time Configuration**, Invocation Summary, **MCP Resources** (read-only):, MCP Tools Available (7 Total), **Programmatic/Library Controls** (+1 more)

### Community 43 - "Community 43"
Cohesion: 0.07
Nodes (43): AccountAccessStatus, AccountSettings, AccountUsageSnapshot, AiMode, BoardChildNode, BrainSearchResult, CallflowHtmlDocument, ChatArtifactSource (+35 more)

### Community 44 - "Community 44"
Cohesion: 0.33
Nodes (5): Deploy, Environment, Routes, Run Locally, Second Brain Managed Proxy

### Community 45 - "Community 45"
Cohesion: 0.12
Nodes (10): LoadState, priorityOptions, statusOptions, TrackerTableProps, TrackerIngestionStatus, TrackerListScope, TrackerPriority, TrackerStatus (+2 more)

### Community 47 - "Community 47"
Cohesion: 0.07
Nodes (27): accountChannels, api, appChannels, boardChannels, brainChannels, chatChannels, clipboardChannels, explorerChannels (+19 more)

### Community 48 - "Community 48"
Cohesion: 0.23
Nodes (8): AccountAuthService, asRecord(), normalizeStatus(), normalizeUsage(), StoredSession, stringValue(), SupabaseAuthResponse, AccountAuthState

### Community 49 - "Community 49"
Cohesion: 0.19
Nodes (8): AccessTokenProvider, errorMessage(), LogProvider, LogRecord, LogService, redact(), redactString(), AppBuildInfo

### Community 50 - "Community 50"
Cohesion: 0.19
Nodes (7): dedupeCitations(), excerptTitle(), extractCitations(), resolveTraversalNodeHits(), sliceByLocation(), GraphifyContextNodeHit, GraphifyContextSourceExcerpt

### Community 51 - "Community 51"
Cohesion: 0.36
Nodes (8): asRecord(), asString(), buildInlineGraphTraversalStdout(), linkEndpointId(), nodeLabel(), sourceFileFromNode(), sourceLocationFromNode(), tokenize()

### Community 52 - "Community 52"
Cohesion: 0.20
Nodes (9): AI Proxy Contract, Desktop Authentication Flow, `GET /api/desktop/account`, `POST /api/desktop/logs`, Release Asset Integration, Required Public Build Config, Required Website API, Support Notes (+1 more)

### Community 53 - "Community 53"
Cohesion: 0.36
Nodes (7): ExportState, formatRelativeTime(), LoadState, TopicCanvas(), TopicCanvasProps, validationClass(), validationLabel()

### Community 54 - "Community 54"
Cohesion: 0.32
Nodes (6): DropTarget(), ProjectList(), ProjectListProps, Sidebar(), SidebarProps, useProjectStore

### Community 55 - "Community 55"
Cohesion: 0.40
Nodes (3): CreateProjectInput, RenameProjectInput, ProjectState

### Community 56 - "Community 56"
Cohesion: 0.06
Nodes (24): CachedEmbedding, EmbeddingService, fingerprintNode(), searchableText(), TransformersModule, CandidateScore, deriveTopicTitle(), GraphRagService (+16 more)

### Community 57 - "Community 57"
Cohesion: 0.18
Nodes (10): Build Metadata, Channels, Development Packaging, Distribution, Error And Log Policy, Managed Account Access, Production Packaging, Production Release Commands (+2 more)

### Community 60 - "Community 60"
Cohesion: 0.33
Nodes (5): Allow In System Settings, First Launch, If It Still Does Not Open, Install, Second Brain macOS Beta Testing Guide

### Community 62 - "Community 62"
Cohesion: 0.33
Nodes (8): formatAccountDate(), SettingsPanel(), SettingsPanelProps, statusLabel(), statusTone(), isProductionBuild(), presentError(), presentPossiblyDetailedError()

### Community 63 - "Community 63"
Cohesion: 0.18
Nodes (10): Build Metadata, Channels, Development Packaging, Distribution, Error And Log Policy, Managed Account Access, Production Packaging, Production Release Guide (+2 more)

### Community 64 - "Community 64"
Cohesion: 0.25
Nodes (7): Acceptance Criteria, App Development Agent Instructions, Architecture Rules, Prompt, Required Behavior, Suggested Implementation Steps, Validation Commands

## Knowledge Gaps
- **366 isolated node(s):** `name`, `version`, `description`, `main`, `author` (+361 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `GraphifyController` connect `Community 26` to `Community 0`, `Community 32`, `Demo Mockup Logic`, `Community 8`, `Community 10`, `Embedding Pipeline`, `Community 29`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Why does `GraphifyContextService` connect `Community 46` to `Community 36`, `Community 41`, `Embedding Pipeline`, `Community 50`, `Community 51`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `ExplorerService` connect `Community 7` to `Embedding Pipeline`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _366 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Electron Shell` be split into smaller, more focused modules?**
  _Cohesion score 0.05285592497868713 - nodes in this community are weakly interconnected._
- **Should `Packaging Config` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._
- **Should `Demo Mockup Logic` be split into smaller, more focused modules?**
  _Cohesion score 0.07661290322580645 - nodes in this community are weakly interconnected._