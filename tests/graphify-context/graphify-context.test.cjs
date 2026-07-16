const assert = require("node:assert/strict");
const { mkdir, mkdtemp, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  GraphifyContextService,
  buildInlineGraphTraversalStdout,
  graphifyContextTestUtils
} = require("../../dist/main/services/GraphifyContextService.js");
const { SourceContentService } = require("../../dist/main/services/SourceContentService.js");

test("parses Graphify traversal node lines into ranked node hits", () => {
  const stdout = [
    "Traversal: BFS | Start: [AuthService] | 2 nodes found",
    "  NODE AuthService [id=auth_service src=src/auth.ts loc=L42 community=7]",
    "  NODE Database [src=src/db.ts loc=line:9 community=3 confidence=EXTRACTED]",
    "EDGE AuthService --calls [EXTRACTED]--> Database"
  ].join("\n");

  const hits = graphifyContextTestUtils.parseTraversalNodeHits(stdout);

  assert.equal(hits.length, 2);
  assert.deepEqual(hits[0], {
    id: "auth_service",
    label: "AuthService",
    sourceFile: "src/auth.ts",
    sourceLocation: "L42",
    community: "7",
    confidence: undefined,
    rank: 1
  });
  assert.equal(hits[1].sourceLocation, "line:9");
  assert.equal(hits[1].id, "");
  assert.equal(graphifyContextTestUtils.lineNumberFromLocation("L42"), 42);
  assert.equal(graphifyContextTestUtils.lineNumberFromLocation("line:9"), 9);
});

test("resolves traversal node hits only through exact graph evidence", () => {
  const graph = {
    nodes: [
      { id: "auth_service", label: "AuthService", source_file: "src/auth.ts", source_location: "L42", community: "7" },
      { id: "cache_a", label: "Cache", source_file: "src/cache-a.ts", source_location: "L10" },
      { id: "cache_b", label: "Cache", source_file: "src/cache-b.ts", source_location: "L20" },
      { id: "unique_worker", label: "UniqueWorker", source_file: "src/worker.ts", source_location: "L4" }
    ],
    links: []
  };
  const hits = graphifyContextTestUtils.parseTraversalNodeHits(
    [
      "  NODE AuthService [src=src/auth.ts loc=L42 community=7]",
      "  NODE Cache",
      "  NODE Cache [src=src/cache-b.ts]",
      "  NODE UniqueWorker",
      "  NODE MentionOnly [src=src/nope.ts loc=L1]"
    ].join("\n")
  );

  const resolved = graphifyContextTestUtils.resolveTraversalNodeHits(hits, graph);

  assert.deepEqual(
    resolved.map((hit) => hit.id),
    ["auth_service", "cache_b", "unique_worker"]
  );
  assert.equal(resolved[0].sourceFile, "src/auth.ts");
  assert.equal(resolved[1].sourceLocation, "L20");
});

test("does not create node hits from arbitrary stdout mentions", () => {
  const graph = {
    nodes: [{ id: "database", label: "Database", source_file: "src/db.ts", source_location: "L7" }],
    links: []
  };
  const parsed = graphifyContextTestUtils.parseTraversalNodeHits(
    "Relevant card definitions:\nDatabase is mentioned here, but no traversal node line selected it."
  );

  assert.deepEqual(graphifyContextTestUtils.resolveTraversalNodeHits(parsed, graph), []);
});

test("builds inline BFS traversal text from graph.json data", () => {
  const graph = {
    nodes: [
      { id: "auth_service", label: "AuthService", source_file: "src/auth.ts", source_location: "L12", community: "1" },
      { id: "database", label: "Database", source_file: "src/db.ts", source_location: "L7", community: "2" },
      { id: "cache", label: "Cache", source_file: "src/cache.ts", source_location: "L5", community: "2" }
    ],
    links: [
      { source: "auth_service", target: "database", relation: "calls", confidence: "EXTRACTED" },
      { source: "database", target: "cache", relation: "hydrates", confidence: "INFERRED:0.82" }
    ]
  };

  const stdout = buildInlineGraphTraversalStdout(graph, "auth service database", 1000);

  assert.match(stdout, /Traversal: BFS depth=2/);
  assert.match(stdout, /NODE AuthService \[src=src\/auth\.ts loc=L12 community=1\]/);
  assert.match(stdout, /NODE Database \[src=src\/db\.ts loc=L7 community=2\]/);
  assert.match(stdout, /EDGE AuthService --calls \[EXTRACTED\]--> Database/);
});

test("SourceContentService chunks exact node source locations", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "second-brain-source-chunks-"));
  const rawRoot = path.join(tempRoot, "raw");
  const sourcePath = path.join(rawRoot, "docs", "architecture.md");
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(
    sourcePath,
    Array.from({ length: 80 }, (_, index) => `line ${index + 1} ${index + 1 === 42 ? "target pipeline detail" : "background"}`).join("\n"),
    "utf8"
  );

  const service = new SourceContentService(rawRoot);
  const chunks = await service.hydrate({
    nodeHits: [
      {
        id: "pipeline",
        label: "RequestPipeline",
        sourceFile: "docs/architecture.md",
        sourceLocation: "L42",
        rank: 1
      }
    ],
    expandedTokens: ["pipeline"],
    query: "pipeline"
  });

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].sourceFile, "docs/architecture.md");
  assert.equal(chunks[0].reason, "node-location");
  assert.ok(chunks[0].startLine <= 42);
  assert.ok(chunks[0].endLine >= 42);
  assert.match(chunks[0].text, /target pipeline detail/);
  assert.doesNotMatch(chunks[0].text, /line 1 background/);
});

test("SourceContentService uses converted markdown sidecars for binary source files", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "second-brain-converted-chunks-"));
  const rawRoot = path.join(tempRoot, "raw");
  const convertedPath = path.join(rawRoot, "graphify-out", "converted", "Quarterly Plan.md");
  await mkdir(path.dirname(convertedPath), { recursive: true });
  await writeFile(convertedPath, ["# Quarterly Plan", "Revenue risk details", "Hiring dependency"].join("\n"), "utf8");

  const service = new SourceContentService(rawRoot);
  const chunks = await service.hydrate({
    nodeHits: [
      {
        id: "quarterly_plan",
        label: "Quarterly Plan",
        sourceFile: "Quarterly Plan.docx",
        rank: 1
      }
    ],
    expandedTokens: ["revenue", "risk"],
    query: "revenue risk"
  });

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].sourceFile, "graphify-out/converted/Quarterly Plan.md");
  assert.equal(chunks[0].displayName, "Quarterly Plan.docx");
  assert.equal(chunks[0].reason, "converted-sidecar");
  assert.match(chunks[0].text, /Revenue risk details/);
});

test("SourceContentService uses paper component artifacts for PDF-derived text", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "second-brain-paper-chunks-"));
  const rawRoot = path.join(tempRoot, "raw");
  const componentRoot = path.join(rawRoot, "paper-components", "paper-a");
  await mkdir(componentRoot, { recursive: true });
  await writeFile(path.join(componentRoot, "section-1.md"), "Methods section with transformer accuracy table.", "utf8");
  await writeFile(
    path.join(componentRoot, "artifact-index.json"),
    JSON.stringify([
      {
        sourceFile: "Papers/Transformer Study.pdf",
        artifactPath: "paper-components/paper-a/section-1.md",
        title: "Methods"
      }
    ]),
    "utf8"
  );

  const service = new SourceContentService(rawRoot);
  const chunks = await service.hydrate({
    nodeHits: [
      {
        id: "methods",
        label: "Methods",
        sourceFile: "Papers/Transformer Study.pdf",
        rank: 1
      }
    ],
    expandedTokens: ["transformer", "accuracy"],
    query: "transformer accuracy"
  });

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].reason, "paper-component");
  assert.match(chunks[0].text, /transformer accuracy table/);
});

test("SourceContentService rejects path traversal and returns metadata only for unreadable binaries", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "second-brain-source-safe-"));
  const rawRoot = path.join(tempRoot, "raw");
  await mkdir(rawRoot, { recursive: true });

  const service = new SourceContentService(rawRoot);
  const chunks = await service.hydrate({
    nodeHits: [
      {
        id: "outside",
        label: "Outside",
        sourceFile: "../outside.md",
        rank: 1
      },
      {
        id: "image",
        label: "Image",
        sourceFile: "diagram.png",
        rank: 2
      }
    ],
    expandedTokens: ["outside"],
    query: "outside"
  });

  assert.equal(chunks.length, 2);
  assert.deepEqual(
    chunks.map((chunk) => chunk.reason),
    ["metadata-only", "metadata-only"]
  );
  assert.equal(chunks[0].text, "");
});
