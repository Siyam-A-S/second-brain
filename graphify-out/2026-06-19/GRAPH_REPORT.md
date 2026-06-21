# Graph Report - second-brain  (2026-06-19)

## Corpus Check
- 61 files · ~48,506 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 994 nodes · 2239 edges · 46 communities (42 shown, 4 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.78)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d7857a8b`
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
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]

## God Nodes (most connected - your core abstractions)
1. `GraphifyController` - 87 edges
2. `ExplorerService` - 33 edges
3. `StorageService` - 24 edges
4. `BrainNode` - 19 edges
5. `AiSettings` - 19 edges
6. `LlmService` - 17 edges
7. `ProjectService` - 17 edges
8. `ResearchService` - 16 edges
9. `ChatService` - 15 edges
10. `GraphRagService` - 15 edges

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

## Communities (46 total, 4 thin omitted)

### Community 0 - "GraphRAG Services"
Cohesion: 0.20
Nodes (3): defaultIngestCommand(), isPaperSource(), looksComplete()

### Community 1 - "Electron Shell"
Cohesion: 0.06
Nodes (40): BoardRenderer(), BoardRendererProps, BoardTab, boardTabs, formatDate(), GraphHtmlViewer(), asRecord(), asString() (+32 more)

### Community 2 - "Packaging Config"
Cohesion: 0.10
Nodes (20): devDependencies, autoprefixer, concurrently, cross-env, electron, electron-is-dev, framer-motion, lucide-react (+12 more)

### Community 3 - "Demo Mockup Logic"
Cohesion: 0.10
Nodes (19): AiSettingsProvider, asRecord(), asString(), chunkArray(), collapsibleTextExtensions, endpointHostLabel(), GraphifyGraph, GraphifyInvocation (+11 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (23): AppSettingsProvider, ChatService, ChatState, compact(), errorMessage(), extractContentPart(), extractProxyText(), ProxyResponse (+15 more)

### Community 5 - "Markdown Storage"
Cohesion: 0.06
Nodes (34): api, boardChannels, brainChannels, chatChannels, clipboardChannels, explorerChannels, fileChannels, graphBoardChannels (+26 more)

### Community 6 - "Project Dependencies"
Cohesion: 0.15
Nodes (13): scripts, build, build:electron, dev, dev:headless, dev:renderer, package:win, package:win:installer (+5 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (46): emptyDetailsNode(), ExplorerWorkbench(), ExplorerWorkbenchProps, formatDate(), kindLabel(), LoadState, nodeIcon(), TreeRow() (+38 more)

### Community 8 - "Community 8"
Cohesion: 0.06
Nodes (29): CandidateScore, deriveTopicTitle(), GraphRagService, validationBoost(), LocalMcpServer, LocalMcpServerOptions, readJsonBody(), createGraphRagToolRegistry() (+21 more)

### Community 9 - "Drop UI Components"
Cohesion: 0.50
Nodes (3): For SSH/headless:, Use:, Verification:

### Community 10 - "Community 10"
Cohesion: 0.06
Nodes (42): LoadState, priorityOptions, statusOptions, TrackerTable(), TrackerTableProps, browserAiSettings, browserApiFallback, browserAppSettings (+34 more)

### Community 11 - "Embedding Pipeline"
Cohesion: 0.08
Nodes (26): createMainWindow(), createProjectRuntime(), createWidgetWindow(), isDev, loadRenderer(), preloadEntry, ProjectRuntime, rendererEntry (+18 more)

### Community 12 - "Community 12"
Cohesion: 0.09
Nodes (32): displaySource(), ForceLink, ForceNode, GraphBoardRenderer(), GraphBoardRendererProps, LoadState, paperStatusLabel(), titleCase() (+24 more)

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
Cohesion: 0.10
Nodes (22): ResearchPaperComponentType, BoardChannel, BrainChannel, ChatChannel, ClipboardChannel, ExplorerChannel, FileChannel, GraphBoardChannel (+14 more)

### Community 24 - "Community 24"
Cohesion: 0.21
Nodes (15): Any, BaseModel, JSONResponse, build_vertex_body(), chat(), configured_key_hashes(), enforce_rate_limit(), env_int() (+7 more)

### Community 25 - "Community 25"
Cohesion: 0.15
Nodes (3): GraphifyController, numberFromEnv(), AiSettings

### Community 27 - "Community 27"
Cohesion: 0.20
Nodes (11): exists(), isEnoent(), nowIso(), ProjectService, ProjectState, safeProjectId(), CreateProjectInput, ProjectRecord (+3 more)

### Community 28 - "Community 28"
Cohesion: 0.16
Nodes (7): errorMessage(), isSpreadsheetSource(), paperComponentDirectoryNameForSource(), paperComponentScript(), researchDependencyStatusScript(), spreadsheetComponentFileName(), spreadsheetComponentScript()

### Community 29 - "Community 29"
Cohesion: 0.19
Nodes (3): isCmdShim(), parseArgs(), GraphifyMcpToolSpec

### Community 31 - "Community 31"
Cohesion: 0.17
Nodes (9): installBrowserApiFallback(), params, windowName, WidgetMovePayload, DragState, DropTone, FloatingWidget(), toneColors (+1 more)

### Community 32 - "Community 32"
Cohesion: 0.09
Nodes (30): AgentMethodConfig, agentPrompts, AiSettingsProvider, ChatAttemptOptions, ChatCompletionResponse, ChatMessage, errorText(), extractChatContent() (+22 more)

### Community 33 - "Community 33"
Cohesion: 0.09
Nodes (32): asRecord(), asString(), emptyLiterature, endpointId(), GraphJson, GraphLink, graphLinks(), GraphNode (+24 more)

### Community 34 - "Community 34"
Cohesion: 0.33
Nodes (5): Connect AI, Develop, Environment Variables, Install, Second Brain

### Community 35 - "Community 35"
Cohesion: 0.21
Nodes (17): AiSettingsService, asRecord(), booleanSetting(), defaultGraphifySettings, normalizeApiKey(), normalizeEndpoint(), normalizeGraphifySettings(), normalizeManagedProxyModel() (+9 more)

### Community 36 - "Community 36"
Cohesion: 0.12
Nodes (15): ChatWorkbench(), ChatWorkbenchProps, DropTarget(), ProjectList(), ProjectListProps, SettingsPanel(), SettingsPanelProps, Sidebar() (+7 more)

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
Cohesion: 0.20
Nodes (7): DropTargetProps, DropTone, toneColors, createDropPayload(), ElectronFile, DroppedFile, FilesDroppedPayload

### Community 42 - "Community 42"
Cohesion: 0.50
Nodes (4): nsis, allowToChangeInstallationDirectory, oneClick, perMachine

### Community 43 - "Community 43"
Cohesion: 0.31
Nodes (8): ExportState, formatRelativeTime(), LoadState, TopicCanvas(), TopicCanvasProps, validationClass(), validationLabel(), UserValidationState

### Community 44 - "Community 44"
Cohesion: 0.40
Nodes (4): Deploy, Environment, Run Locally, Second Brain Managed Proxy

### Community 45 - "Community 45"
Cohesion: 0.50
Nodes (3): bufferFromDroppedValue(), safeFilePart(), ProcessDroppedItem

## Knowledge Gaps
- **259 isolated node(s):** `appId`, `productName`, `output`, `buildResources`, `files` (+254 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `GraphifyController` connect `Community 25` to `GraphRAG Services`, `Community 32`, `Demo Mockup Logic`, `Community 10`, `Embedding Pipeline`, `Community 45`, `Community 26`, `Community 28`, `Community 29`?**
  _High betweenness centrality (0.100) - this node is a cross-community bridge._
- **Why does `ExplorerService` connect `Community 7` to `Embedding Pipeline`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `StorageService` connect `Markdown Storage` to `Community 8`, `Community 10`, `Embedding Pipeline`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **What connects `appId`, `productName`, `output` to the rest of the system?**
  _259 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Electron Shell` be split into smaller, more focused modules?**
  _Cohesion score 0.05625 - nodes in this community are weakly interconnected._
- **Should `Packaging Config` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `Demo Mockup Logic` be split into smaller, more focused modules?**
  _Cohesion score 0.09788359788359788 - nodes in this community are weakly interconnected._