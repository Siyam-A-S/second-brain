const assert = require("node:assert/strict");
const { rm, mkdtemp } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { GraphRagService } = require("../../dist/main/services/GraphRagService.js");
const { StorageService } = require("../../dist/main/services/StorageService.js");

function createDeterministicEmbeddings() {
  const vocabulary = [
    "database",
    "management",
    "lecture",
    "professor",
    "normalization",
    "fullstack",
    "schema",
    "boot",
    "commands",
    "project",
    "index",
    "tree"
  ];

  return {
    async generateEmbedding(text) {
      const normalized = text.toLowerCase();
      const vector = vocabulary.map((term) => (normalized.includes(term) ? 1 : 0));
      const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;

      return vector.map((value) => value / magnitude);
    }
  };
}

async function createBlankHarness() {
  const root = await mkdtemp(path.join(os.tmpdir(), "second-brain-onboarding-"));
  const storage = new StorageService(path.join(root, "vault"));
  const graph = new GraphRagService(storage, createDeterministicEmbeddings());

  await storage.initialize();

  return {
    root,
    storage,
    graph,
    async drop(item) {
      return graph.ingestAndRouteFragment({
        raw_content: item.raw_content,
        inferred_title: item.inferred_title,
        generated_summary: item.generated_summary,
        context_hints: item.context_hints,
        importance: item.importance
      });
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    }
  };
}

test("blank app first drop creates a topic and a routed fragment", async () => {
  const harness = await createBlankHarness();

  try {
    const result = await harness.drop({
      raw_content: "Lecture note about entity relationship diagrams and normalization.",
      inferred_title: "ERD lecture note",
      generated_summary: "Lecture note about database management diagrams and normalization.",
      context_hints: ["Database Management", "lecture notes"],
      importance: 0.7
    });
    const board = await harness.graph.getOrganizedBoard();

    assert.equal(result.routing.strategy, "new-topic");
    assert.equal(board.length, 1);
    assert.equal(board[0].children.length, 1);
    assert.equal(board[0].children[0].title, "ERD lecture note");
    assert.match(result.routing.parent_title, /Database Management|ERD lecture note/);
  } finally {
    await harness.cleanup();
  }
});

test("similar database terms route to different contexts when hints differ", async () => {
  const harness = await createBlankHarness();

  try {
    const course = await harness.storage.writeNode({
      title: "Database Management Course",
      type: "topic",
      summary: "Nathan course notes for database management lectures and exams.",
      tags: ["course", "database"],
      context_hints: ["Database Management", "lecture", "professor notes"],
      importance: 0.8,
      user_validation: "approved",
      content: "Course hub"
    });
    const project = await harness.storage.writeNode({
      title: "Fullstack SQL Project",
      type: "topic",
      summary: "Old web app schemas migrations seed commands and database boot commands.",
      tags: ["project", "sql"],
      context_hints: ["fullstack web application", "sql schema", "boot commands"],
      importance: 0.6,
      user_validation: "approved",
      content: "Project hub"
    });

    const lecture = await harness.drop({
      raw_content: "Professor lecture text on normalization and relational algebra.",
      inferred_title: "Professor lecture normalization",
      generated_summary: "Professor lecture notes for database management normalization.",
      context_hints: ["Database Management", "lecture"]
    });
    const bootCommands = await harness.drop({
      raw_content: "CREATE TABLE users and seed the database before starting the API.",
      inferred_title: "SQL boot commands",
      generated_summary: "SQL schema and database boot commands for fullstack app.",
      context_hints: ["fullstack web application", "boot commands"]
    });

    assert.equal(lecture.routing.parent_uuid, course.uuid);
    assert.equal(bootCommands.routing.parent_uuid, project.uuid);
  } finally {
    await harness.cleanup();
  }
});

test("organized board keeps the most recent dropped item first under a topic", async () => {
  const harness = await createBlankHarness();

  try {
    const topic = await harness.storage.writeNode({
      title: "Database Management Course",
      type: "topic",
      summary: "Course hub.",
      tags: ["course"],
      context_hints: ["Database Management", "lecture"],
      user_validation: "approved",
      content: "Course hub"
    });

    await harness.storage.ingestFragment({
      raw_content: "Older note",
      inferred_title: "Older lecture",
      generated_summary: "Older lecture summary.",
      target_parent_uuid: topic.uuid,
      context_hints: ["Database Management", "lecture"]
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await harness.storage.ingestFragment({
      raw_content: "Newer note",
      inferred_title: "Newer lecture",
      generated_summary: "Newer lecture summary.",
      target_parent_uuid: topic.uuid,
      context_hints: ["Database Management", "lecture"]
    });

    const board = await harness.graph.getOrganizedBoard();

    assert.equal(board[0].children[0].title, "Newer lecture");
    assert.equal(board[0].children[1].title, "Older lecture");
  } finally {
    await harness.cleanup();
  }
});

test("plaintext export gives a copyable board context", async () => {
  const harness = await createBlankHarness();

  try {
    await harness.drop({
      raw_content: "## Notes\nIndex design and B-tree tradeoffs.",
      inferred_title: "Index design",
      generated_summary: "Notes on index design and B-tree tradeoffs.",
      context_hints: ["Database Management", "indexes"]
    });

    const exported = await harness.graph.exportBoardPlaintext({ include_body: true });

    assert.match(exported, /# Second Brain Board Export/);
    assert.match(exported, /Index design/);
    assert.match(exported, /B-tree tradeoffs/);
  } finally {
    await harness.cleanup();
  }
});
