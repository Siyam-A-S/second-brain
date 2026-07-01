const assert = require("node:assert/strict");
const { chmod, mkdir, mkdtemp, readFile, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  GraphifyContextService,
  buildInlineGraphTraversalStdout,
  graphifyContextTestUtils
} = require("../../dist/main/services/GraphifyContextService.js");

test("parses Graphify traversal node lines into ranked node hits", () => {
  const stdout = [
    "Traversal: BFS | Start: [AuthService] | 2 nodes found",
    "NODE AuthService [src=src/auth.ts loc=L42 community=7]",
    "NODE Database [src=src/db.ts loc=line:9 community=3 confidence=EXTRACTED]",
    "EDGE AuthService --calls [EXTRACTED]--> Database"
  ].join("\n");

  const hits = graphifyContextTestUtils.parseTraversalNodeHits(stdout);

  assert.equal(hits.length, 2);
  assert.deepEqual(hits[0], {
    id: "AuthService:src/auth.ts:L42",
    label: "AuthService",
    sourceFile: "src/auth.ts",
    sourceLocation: "L42",
    community: "7",
    confidence: undefined,
    rank: 1
  });
  assert.equal(hits[1].sourceLocation, "line:9");
  assert.equal(graphifyContextTestUtils.lineNumberFromLocation("L42"), 42);
  assert.equal(graphifyContextTestUtils.lineNumberFromLocation("line:9"), 9);
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

test("saveResult invokes graphify save-result with supported arguments", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "second-brain-graphify-save-"));
  const rawRoot = path.join(tempRoot, "raw");
  const fakeGraphify = path.join(tempRoot, "fake-graphify.cjs");
  const argsPath = path.join(tempRoot, "args.json");
  await mkdir(rawRoot, { recursive: true });
  await writeFile(
    fakeGraphify,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "fs.writeFileSync(process.env.SECOND_BRAIN_TEST_ARGS_PATH, JSON.stringify(process.argv.slice(2)));",
      "console.log('saved');"
    ].join("\n"),
    "utf8"
  );
  await chmod(fakeGraphify, 0o755);

  const previousBin = process.env.SECOND_BRAIN_GRAPHIFY_BIN;
  const previousArgsPath = process.env.SECOND_BRAIN_TEST_ARGS_PATH;
  process.env.SECOND_BRAIN_GRAPHIFY_BIN = fakeGraphify;
  process.env.SECOND_BRAIN_TEST_ARGS_PATH = argsPath;
  try {
    const service = new GraphifyContextService(rawRoot);
    const stdout = await service.saveResult({
      question: "How does auth use db?",
      answer: "Auth calls Database.",
      type: "query",
      nodes: ["auth_service", "database"]
    });

    assert.equal(stdout, "saved");
    const args = JSON.parse(await readFile(argsPath, "utf8"));
    assert.deepEqual(args, [
      "save-result",
      "--question",
      "How does auth use db?",
      "--answer",
      "Auth calls Database.",
      "--type",
      "query",
      "--nodes",
      "auth_service",
      "database"
    ]);
  } finally {
    if (previousBin === undefined) {
      delete process.env.SECOND_BRAIN_GRAPHIFY_BIN;
    } else {
      process.env.SECOND_BRAIN_GRAPHIFY_BIN = previousBin;
    }

    if (previousArgsPath === undefined) {
      delete process.env.SECOND_BRAIN_TEST_ARGS_PATH;
    } else {
      process.env.SECOND_BRAIN_TEST_ARGS_PATH = previousArgsPath;
    }
  }
});
