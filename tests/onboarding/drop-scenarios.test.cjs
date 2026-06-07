const assert = require("node:assert/strict");
const { rm, mkdtemp } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { AgentController } = require("../../dist/main/services/AgentController.js");
const { GraphRagService } = require("../../dist/main/services/GraphRagService.js");
const { JobTrackerService } = require("../../dist/main/services/JobTrackerService.js");
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

test("job tracker persists extracted job metadata as a local vault node", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "second-brain-jobs-"));
  const storage = new StorageService(path.join(root, "vault"));
  const graph = new GraphRagService(storage, createDeterministicEmbeddings());
  const llm = {
    async extractJobMetadata() {
      return {
        company: "Acme Systems",
        role: "Fullstack Intern",
        job_posted: "2026-06-01",
        description_summary: "Build React interfaces and Node services. Work with SQL schemas and deployment scripts."
      };
    }
  };
  const jobs = new JobTrackerService(storage, llm);

  try {
    await storage.initialize();
    const created = await jobs.ingestJobDescription(
      "Job Description: Acme Systems seeks a Fullstack Intern. Responsibilities include React, Node, and SQL.",
      "source-node"
    );
    const listed = await jobs.listJobs();

    assert.equal(created.company, "Acme Systems");
    assert.equal(created.role, "Fullstack Intern");
    assert.equal(created.job_posted, "2026-06-01");
    assert.match(created.application_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(created.status, "Applied");
    assert.equal(created.resume, "");
    const createdNode = await storage.readNode(created.uuid);
    const createdContent = JSON.parse(createdNode.content);

    assert.equal(createdContent.date, created.application_date);
    assert.equal((await graph.getOrganizedBoard()).length, 0);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].uuid, created.uuid);
    assert.equal(listed[0].source_node_uuid, "source-node");
    const updated = await jobs.updateJob({
      uuid: created.uuid,
      status: "Interview",
      resume: "/resumes/acme-fullstack.pdf"
    });

    assert.equal(updated.status, "Interview");
    assert.equal(updated.resume, "/resumes/acme-fullstack.pdf");
    const updatedNode = await storage.readNode(updated.uuid);
    const updatedContent = JSON.parse(updatedNode.content);

    assert.equal(updatedContent.date, updated.application_date);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("job description drops go to jobs without creating graph topics", async () => {
  let graphIngestCalls = 0;
  const statuses = [];
  const controller = new AgentController(
    {
      async callLocalTool() {
        graphIngestCalls += 1;
        throw new Error("Graph ingest should not be called for job descriptions.");
      }
    },
    {
      async ingestJobDescription(rawContent, sourceNodeUuid) {
        assert.equal(sourceNodeUuid, undefined);
        assert.match(rawContent, /Job Description/);

        return {
          uuid: "job-only",
          company: "Acme Systems",
          role: "Fullstack Intern",
          job_posted: "2026-06-01",
          application_date: "2026-06-07",
          status: "Applied",
          resume: "",
          description_summary: "React, Node, SQL, deployment scripts.",
          raw_content: rawContent,
          createdAt: "2026-06-07T00:00:00.000Z",
          updatedAt: "2026-06-07T00:00:00.000Z"
        };
      }
    },
    {
      async planLocalToolCall() {
        throw new Error("Tool router should not be called for job descriptions.");
      }
    }
  );
  const event = {
    sender: {
      send(_channel, status) {
        statuses.push(status.stage);
      }
    }
  };

  const result = await controller.processDroppedItems(event, [
    {
      text: [
        "Job Description",
        "Responsibilities include React interfaces and Node services.",
        "Requirements include SQL, TypeScript, and deployment scripts.",
        "Apply by sending your resume."
      ].join("\n")
    }
  ]);

  assert.equal(graphIngestCalls, 0);
  assert.equal(result.createdNode, undefined);
  assert.equal(result.routing, undefined);
  assert.equal(result.job.uuid, "job-only");
  assert.deepEqual(statuses, ["extracting", "saved"]);
});

test("non-job drops use local LLM tool planning before MCP execution", async () => {
  const plannedInput = {
    raw_content: "Lecture note about B-tree index tradeoffs.",
    inferred_title: "B-tree index tradeoffs",
    generated_summary: "Lecture note about B-tree index tradeoffs.",
    context_hints: ["database indexes"],
    importance: 0.72
  };
  const calls = [];
  const controller = new AgentController(
    {
      listToolSpecs(names) {
        assert.deepEqual(names, ["ingest_and_route_fragment"]);
        return [
          {
            name: "ingest_and_route_fragment",
            title: "Ingest and route fragment",
            description: "Create a new fragment markdown file.",
            inputSchema: {},
            inputSchemaJson: {}
          }
        ];
      },
      async callLocalTool(name, input) {
        calls.push({ name, input });
        return {
          node: {
            uuid: "fragment-1",
            title: input.inferred_title,
            type: "fragment",
            summary: input.generated_summary,
            parent_uuid: "topic-1",
            connections: [],
            tags: [],
            content: input.raw_content,
            path: "/tmp/fragment.md",
            updatedAt: "2026-06-07T00:00:00.000Z",
            created_at: "2026-06-07T00:00:00.000Z",
            importance: input.importance,
            user_validation: "unreviewed",
            context_hints: input.context_hints
          },
          routing: {
            strategy: "existing-context",
            parent_uuid: "topic-1",
            parent_title: "Database Management",
            confidence: 0.8,
            reasons: ["Planned by local LLM."]
          }
        };
      }
    },
    {
      async ingestJobDescription() {
        throw new Error("Job tracker should not be called for non-job drops.");
      }
    },
    {
      async planLocalToolCall({ tools }) {
        assert.equal(tools.length, 1);
        return {
          tool: "ingest_and_route_fragment",
          input: plannedInput,
          reason: "Database lecture note."
        };
      }
    }
  );
  const event = {
    sender: {
      send() {}
    }
  };

  const result = await controller.processDroppedItems(event, [
    {
      text: "Lecture note about B-tree index tradeoffs."
    }
  ]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "ingest_and_route_fragment");
  assert.deepEqual(calls[0].input, plannedInput);
  assert.equal(result.routing.parent_title, "Database Management");
});
