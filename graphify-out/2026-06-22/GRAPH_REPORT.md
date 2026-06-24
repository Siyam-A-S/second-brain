# Graph Report - second-brain  (2026-06-22)

## Corpus Check
- 61 files · ~52,770 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1051 nodes · 2426 edges · 51 communities (47 shown, 4 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.78)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b3d63a9c`
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
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]

## God Nodes (most connected - your core abstractions)
1. `GraphifyController` - 90 edges
2. `ExplorerService` - 36 edges
3. `ChatService` - 26 edges
4. `StorageService` - 24 edges
5. `AiSettings` - 21 edges
6. `GraphifyContextService` - 20 edges
7. `BrainNode` - 19 edges
8. `LlmService` - 18 edges
9. `ProjectService` - 17 edges
10. `GraphifyContextResult` - 17 edges

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

## Communities (51 total, 4 thin omitted)

### Community 0 - "GraphRAG Services"
Cohesion: 0.22
Nodes (4): defaultIngestCommand(), looksComplete(), numberFromEnv(), AiSettings

### Community 1 - "Electron Shell"
Cohesion: 0.05
Nodes (43): BoardRenderer(), BoardRendererProps, BoardTab, boardTabs, formatDate(), GraphHtmlViewer(), asRecord(), asString() (+35 more)

### Community 2 - "Packaging Config"
Cohesion: 0.10
Nodes (20): devDependencies, autoprefixer, concurrently, cross-env, electron, electron-is-dev, framer-motion, lucide-react (+12 more)

### Community 3 - "Demo Mockup Logic"
Cohesion: 0.10
Nodes (18): AiSettingsProvider, bufferFromDroppedValue(), collapsibleTextExtensions, GraphifyGraph, GraphifyInvocation, GraphifyLinkRecord, GraphifyLocalModelSettings, GraphifyNodeRecord (+10 more)

### Community 4 - "Community 4"
Cohesion: 0.11
Nodes (24): AppSettingsProvider, ArtifactIngestor, artifactMimeFromName(), ChatService, ChatState, collectProxyAttachments(), compact(), errorMessage() (+16 more)

### Community 5 - "Markdown Storage"
Cohesion: 0.07
Nodes (26): CandidateScore, deriveTopicTitle(), GraphRagService, validationBoost(), clampImportance(), createUuid(), isUserValidationState(), slugifyFilePart() (+18 more)

### Community 6 - "Project Dependencies"
Cohesion: 0.15
Nodes (13): scripts, build, build:electron, dev, dev:headless, dev:renderer, package:win, package:win:installer (+5 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (50): emptyDetailsNode(), ExplorerWorkbench(), ExplorerWorkbenchProps, formatDate(), kindLabel(), LoadState, nodeIcon(), TreeRow() (+42 more)

### Community 8 - "Community 8"
Cohesion: 0.11
Nodes (16): asRecord(), asString(), compact(), errorMessage(), excerptTitle(), extractCitations(), extractContextPathCandidates(), formatInvocation() (+8 more)

### Community 9 - "Drop UI Components"
Cohesion: 0.50
Nodes (3): For SSH/headless:, Use:, Verification:

### Community 10 - "Community 10"
Cohesion: 0.05
Nodes (47): LoadState, priorityOptions, statusOptions, TrackerTable(), TrackerTableProps, browserAiSettings, browserApiFallback, browserAppSettings (+39 more)

### Community 11 - "Embedding Pipeline"
Cohesion: 0.10
Nodes (21): createMainWindow(), createProjectRuntime(), createWidgetWindow(), isDev, loadRenderer(), preloadEntry, ProjectRuntime, rendererEntry (+13 more)

### Community 12 - "Community 12"
Cohesion: 0.10
Nodes (31): displaySource(), ForceLink, ForceNode, GraphBoardRenderer(), GraphBoardRendererProps, LoadState, paperStatusLabel(), titleCase() (+23 more)

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
Nodes (20): ChatArtifactSource, GraphBoardNeighbor, ResearchPaperComponentType, BoardChannel, boardChannels, BrainChannel, ChatChannel, ClipboardChannel (+12 more)

### Community 24 - "Community 24"
Cohesion: 0.22
Nodes (18): Any, BaseModel, JSONResponse, build_vertex_body(), chat(), chat_completions(), configured_key_hashes(), enforce_rate_limit() (+10 more)

### Community 25 - "Community 25"
Cohesion: 0.11
Nodes (4): GraphifyController, isPaperSource(), isSpreadsheetSource(), GraphDefinitionStatus

### Community 26 - "Community 26"
Cohesion: 0.21
Nodes (4): canInlineSourceComment(), readInlineSourceComment(), sourceCommentFileName(), GraphifyIngestionResult

### Community 27 - "Community 27"
Cohesion: 0.20
Nodes (11): exists(), isEnoent(), nowIso(), ProjectService, ProjectState, safeProjectId(), CreateProjectInput, ProjectRecord (+3 more)

### Community 28 - "Community 28"
Cohesion: 0.15
Nodes (7): errorMessage(), isCmdShim(), paperComponentDirectoryNameForSource(), paperComponentScript(), researchDependencyStatusScript(), spreadsheetComponentFileName(), spreadsheetComponentScript()

### Community 31 - "Community 31"
Cohesion: 0.18
Nodes (7): ElectronFile, DroppedFile, FilesDroppedPayload, WidgetMovePayload, DragState, DropTone, toneColors

### Community 32 - "Community 32"
Cohesion: 0.19
Nodes (9): AgentMethodConfig, errorText(), LlmService, normalizeChatCompletionsEndpoint(), providerRejectsJsonMode(), providerRejectsMaxTokens(), providerRejectsTemperature(), sanitizeErrorText() (+1 more)

### Community 33 - "Community 33"
Cohesion: 0.09
Nodes (32): asRecord(), asString(), emptyLiterature, endpointId(), GraphJson, GraphLink, graphLinks(), GraphNode (+24 more)

### Community 34 - "Community 34"
Cohesion: 0.33
Nodes (5): Connect AI, Develop, Environment Variables, Install, Second Brain

### Community 35 - "Community 35"
Cohesion: 0.20
Nodes (17): AiSettingsService, asRecord(), booleanSetting(), defaultGraphifySettings, normalizeApiKey(), normalizeEndpoint(), normalizeGraphifySettings(), normalizeManagedProxyModel() (+9 more)

### Community 36 - "Community 36"
Cohesion: 0.07
Nodes (27): ChatWorkbench(), ChatWorkbenchProps, DropTarget(), DropTargetProps, DropTone, toneColors, ProjectList(), ProjectListProps (+19 more)

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
Cohesion: 0.16
Nodes (13): LocalMcpServerOptions, createGraphRagToolRegistry(), createLocalToolRegistry(), explainGraphNodeSchema, exportBoardPlaintextSchema, fetchFileSegmentsSchema, filterLocalToolSpecs(), ingestAndRouteFragmentSchema (+5 more)

### Community 42 - "Community 42"
Cohesion: 0.50
Nodes (4): nsis, allowToChangeInstallationDirectory, oneClick, perMachine

### Community 43 - "Community 43"
Cohesion: 0.17
Nodes (7): CachedEmbedding, EmbeddingService, fingerprintNode(), searchableText(), TransformersModule, BrainSearchResult, SearchBrainNodesInput

### Community 44 - "Community 44"
Cohesion: 0.33
Nodes (5): Deploy, Environment, Routes, Run Locally, Second Brain Managed Proxy

### Community 45 - "Community 45"
Cohesion: 0.17
Nodes (8): asRecord(), asString(), chunkArray(), endpointHostLabel(), linkEndpointId(), normalizeGraphLinks(), normalizeGraphNodes(), GraphCardDefinitionInput

### Community 46 - "Community 46"
Cohesion: 0.21
Nodes (11): AiSettingsProvider, ChatAttemptOptions, ChatCompletionResponse, extractChatContent(), extractContentPart(), GraphCardDefinition, normalizeDefinition(), normalizeOptionalLine() (+3 more)

### Community 47 - "Community 47"
Cohesion: 0.12
Nodes (15): api, boardChannels, brainChannels, chatChannels, clipboardChannels, explorerChannels, fileChannels, graphBoardChannels (+7 more)

### Community 48 - "Community 48"
Cohesion: 0.33
Nodes (5): GraphifyProvider, agentPrompts, LocalToolName, brainChannels, trackerChannels

### Community 56 - "Community 56"
Cohesion: 0.27
Nodes (3): LocalMcpServer, readJsonBody(), McpServerStatus

### Community 57 - "Community 57"
Cohesion: 0.36
Nodes (8): escapeControlCharsInStrings(), expectedJsonKeys, extractObjectText(), ParsedJsonObject, parseExpectedFields(), parseLocalModelJsonObject(), repairLooseJson(), stripCodeFence()

## Knowledge Gaps
- **262 isolated node(s):** `appId`, `productName`, `output`, `buildResources`, `files` (+257 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `GraphifyController` connect `Community 25` to `GraphRAG Services`, `Community 32`, `Demo Mockup Logic`, `Community 10`, `Embedding Pipeline`, `Community 45`, `Community 48`, `Community 26`, `Community 28`, `Community 29`?**
  _High betweenness centrality (0.105) - this node is a cross-community bridge._
- **Why does `LlmService` connect `Community 32` to `Demo Mockup Logic`, `Community 4`, `Community 10`, `Embedding Pipeline`, `Community 46`, `Community 48`, `Community 25`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `ExplorerService` connect `Community 7` to `Embedding Pipeline`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **What connects `appId`, `productName`, `output` to the rest of the system?**
  _262 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Electron Shell` be split into smaller, more focused modules?**
  _Cohesion score 0.05456095481670929 - nodes in this community are weakly interconnected._
- **Should `Packaging Config` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `Demo Mockup Logic` be split into smaller, more focused modules?**
  _Cohesion score 0.10144927536231885 - nodes in this community are weakly interconnected._