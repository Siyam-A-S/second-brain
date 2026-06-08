# Graph Report - .  (2026-06-08)

## Corpus Check
- Corpus is ~23,749 words - fits in a single context window. You may not need a graph.

## Summary
- 442 nodes · 788 edges · 24 communities (21 shown, 3 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.78)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_GraphRAG Services|GraphRAG Services]]
- [[_COMMUNITY_Electron Shell|Electron Shell]]
- [[_COMMUNITY_Packaging Config|Packaging Config]]
- [[_COMMUNITY_Demo Mockup Logic|Demo Mockup Logic]]
- [[_COMMUNITY_Job Table UI|Job Table UI]]
- [[_COMMUNITY_Markdown Storage|Markdown Storage]]
- [[_COMMUNITY_Project Dependencies|Project Dependencies]]
- [[_COMMUNITY_Browser Fallback|Browser Fallback]]
- [[_COMMUNITY_Agent Drop Routing|Agent Drop Routing]]
- [[_COMMUNITY_Drop UI Components|Drop UI Components]]
- [[_COMMUNITY_LLM Tool Runtime|LLM Tool Runtime]]
- [[_COMMUNITY_Embedding Pipeline|Embedding Pipeline]]
- [[_COMMUNITY_Job Persistence|Job Persistence]]
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

## God Nodes (most connected - your core abstractions)
1. `StorageService` - 22 edges
2. `BrainNode` - 21 edges
3. `GraphRagService` - 15 edges
4. `scripts` - 13 edges
5. `LocalMcpServer` - 13 edges
6. `AgentController` - 11 edges
7. `EmbeddingService` - 11 edges
8. `JobTrackerService` - 11 edges
9. `LlmService` - 11 edges
10. `JobTrackerRecord` - 11 edges

## Surprising Connections (you probably didn't know these)
- `Drop Lane` --semantically_similar_to--> `Onboarding Drop Tests`  [INFERRED] [semantically similar]
  mockups/second-brain-live-demo/index.html → tests/onboarding/README.md
- `Development Commands` --conceptually_related_to--> `Second Brain Live Demo App`  [INFERRED]
  dev/chatnotes.md → mockups/second-brain-live-demo/index.html
- `Project Graphify Instructions` --references--> `Query Flow`  [EXTRACTED]
  AGENTS.md → .codex/skills/graphify/references/query.md
- `Window` --references--> `SecondBrainApi`  [EXTRACTED]
  src/vite-env.d.ts → src/shared/ipc.ts
- `MCP Server` --conceptually_related_to--> `Query Flow`  [INFERRED]
  .codex/skills/graphify/references/exports.md → .codex/skills/graphify/references/query.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Graphify Extraction Pipeline** — graphify_skill_default_build_pipeline, graphify_skill_structural_extraction, graphify_skill_semantic_extraction [EXTRACTED 1.00]
- **Second Brain Ingest And Onboarding Surface** — second_brain_live_demo_index_drop_lane, second_brain_live_demo_index_board_canvas, onboarding_readme_onboarding_drop_tests [INFERRED 0.75]
- **Vault Constellation Graph Motif** — assets_vault_constellation_constellation_network, assets_vault_constellation_knowledge_nodes, assets_vault_constellation_graph_connections [EXTRACTED 1.00]

## Communities (24 total, 3 thin omitted)

### Community 0 - "GraphRAG Services"
Cohesion: 0.07
Nodes (25): CandidateScore, deriveTopicTitle(), GraphRagService, validationBoost(), LocalMcpServer, LocalMcpServerOptions, readJsonBody(), createGraphRagToolRegistry() (+17 more)

### Community 1 - "Electron Shell"
Cohesion: 0.08
Nodes (32): createDropPayload(), ElectronFile, createMainWindow(), createWidgetWindow(), isDev, loadRenderer(), preloadEntry, rendererEntry (+24 more)

### Community 2 - "Packaging Config"
Cohesion: 0.05
Nodes (37): appId, asar, directories, buildResources, output, files, linux, target (+29 more)

### Community 3 - "Demo Mockup Logic"
Cohesion: 0.10
Nodes (26): blankTopics, chooseTopic(), deriveTopicTitle(), detail(), elements, extractHints(), getActiveTopic(), getSelectedCard() (+18 more)

### Community 4 - "Job Table UI"
Cohesion: 0.08
Nodes (23): ExportState, JobTrackerTable(), JobTrackerTableProps, LoadState, progressClass(), progressWidth(), statusOptions, TitleBar() (+15 more)

### Community 5 - "Markdown Storage"
Cohesion: 0.17
Nodes (11): clampImportance(), createUuid(), isUserValidationState(), slugifyFilePart(), StorageService, stringArray(), UuidModule, wordsIn() (+3 more)

### Community 6 - "Project Dependencies"
Cohesion: 0.07
Nodes (26): author, dependencies, gray-matter, @modelcontextprotocol/sdk, uuid, @xenova/transformers, zod, description (+18 more)

### Community 7 - "Browser Fallback"
Cohesion: 0.14
Nodes (24): browserApiFallback, browserJobs, ChatCompletionResponse, compact(), emitJobStatus(), ExtractedJobMetadata, extractJobMetadata(), jobStatusHandlers (+16 more)

### Community 8 - "Agent Drop Routing"
Cohesion: 0.18
Nodes (10): AgentController, DraftFragment, inferContextHints(), inferTitle(), looksLikeJobDescription(), summarize(), IngestAndRouteFragmentResult, JobIngestionStatus (+2 more)

### Community 9 - "Drop UI Components"
Cohesion: 0.13
Nodes (13): ClipboardList(), icons, DropTarget(), DropTargetProps, DropTone, toneColors, Sidebar(), SidebarProps (+5 more)

### Community 10 - "LLM Tool Runtime"
Cohesion: 0.18
Nodes (11): AgentMethodConfig, agentPrompts, ChatCompletionResponse, ChatMessage, ExtractedJobMetadata, LlmService, normalizeDate(), normalizeLine() (+3 more)

### Community 11 - "Embedding Pipeline"
Cohesion: 0.17
Nodes (7): CachedEmbedding, EmbeddingService, fingerprintNode(), searchableText(), TransformersModule, BrainSearchResult, SearchBrainNodesInput

### Community 12 - "Job Persistence"
Cohesion: 0.25
Nodes (10): JobTrackerService, normalizeDate(), normalizeStatus(), safeFileTitle(), statusOptions, StoredJobContent, summarizeRawContent(), todayString() (+2 more)

### Community 13 - "Base TS Config"
Cohesion: 0.18
Nodes (10): compilerOptions, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, lib, noUncheckedIndexedAccess, resolveJsonModule, skipLibCheck (+2 more)

### Community 14 - "Renderer TS Config"
Cohesion: 0.18
Nodes (10): compilerOptions, allowSyntheticDefaultImports, composite, jsx, module, moduleResolution, noEmit, types (+2 more)

### Community 15 - "Graphify Workflow"
Cohesion: 0.20
Nodes (10): Project Graphify Instructions, Codex Semantic Subagents, Default Build Pipeline, Graphify Skill, Honesty Rules, Semantic Extraction, Structural Extraction, MCP Server (+2 more)

### Community 16 - "Main TS Config"
Cohesion: 0.20
Nodes (9): compilerOptions, composite, module, moduleResolution, outDir, rootDir, types, extends (+1 more)

### Community 17 - "Preload TS Config"
Cohesion: 0.20
Nodes (9): compilerOptions, composite, module, moduleResolution, outDir, rootDir, types, extends (+1 more)

### Community 18 - "Onboarding Demo Tests"
Cohesion: 0.33
Nodes (6): Development Commands, Deterministic Fake Vectorizer, Onboarding Drop Tests, Board Canvas, Drop Lane, Second Brain Live Demo App

### Community 19 - "Constellation Visual"
Cohesion: 0.67
Nodes (4): Constellation Network, Graph Connections, Knowledge Nodes, Vault Constellation SVG

## Knowledge Gaps
- **162 isolated node(s):** `PreToolUse`, `appId`, `productName`, `output`, `buildResources` (+157 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `BrainNode` connect `Markdown Storage` to `GraphRAG Services`, `Electron Shell`, `Embedding Pipeline`, `Job Persistence`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Why does `StorageService` connect `Markdown Storage` to `GraphRAG Services`, `Electron Shell`, `LLM Tool Runtime`, `Embedding Pipeline`, `Job Persistence`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `ProcessDroppedItemsResult` connect `Agent Drop Routing` to `GraphRAG Services`, `Electron Shell`, `Job Table UI`, `Browser Fallback`, `Drop UI Components`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **What connects `PreToolUse`, `appId`, `productName` to the rest of the system?**
  _163 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `GraphRAG Services` be split into smaller, more focused modules?**
  _Cohesion score 0.07256894049346879 - nodes in this community are weakly interconnected._
- **Should `Electron Shell` be split into smaller, more focused modules?**
  _Cohesion score 0.07804878048780488 - nodes in this community are weakly interconnected._
- **Should `Packaging Config` be split into smaller, more focused modules?**
  _Cohesion score 0.05263157894736842 - nodes in this community are weakly interconnected._