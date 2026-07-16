const assert = require("node:assert/strict");
const test = require("node:test");

const { chatServiceTestUtils } = require("../../dist/main/services/ChatService.js");

test("normalizes search queries to at most four scoped keywords", () => {
  const query = chatServiceTestUtils.normalizeSearchQuery(
    "keywords: architecture graphify artifacts tracker memory unrelated outside synonym",
    "fallback topic"
  );

  const keywords = query.split(/\s+/).filter(Boolean);
  assert.ok(keywords.length <= 4);
  assert.deepEqual(keywords, ["architecture", "graphify", "artifacts", "tracker"]);
});

test("builds conversation search scope from current thread messages and artifacts", () => {
  const thread = {
    id: "thread-1",
    title: "New Chat",
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z",
    messages: [
      {
        id: "u1",
        role: "user",
        content: "Generate a PDF architecture report.",
        createdAt: "2026-07-06T00:00:00.000Z"
      },
      {
        id: "a1",
        role: "assistant",
        content: "I generated the file.",
        createdAt: "2026-07-06T00:00:01.000Z",
        artifacts: [
          {
            id: "artifact-1",
            messageId: "a1",
            filename: "Architecture Report.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1024,
            kind: "binary",
            storagePath: "/tmp/Architecture Report.pdf",
            createdAt: "2026-07-06T00:00:01.000Z",
            source: "local-tool"
          }
        ]
      },
      {
        id: "u2",
        role: "user",
        content: "Tell me more about the report.",
        createdAt: "2026-07-06T00:00:02.000Z"
      }
    ]
  };

  const scope = chatServiceTestUtils.buildConversationSearchScope(thread, "Tell me more about the report.");

  assert.match(scope, /Latest user question:/);
  assert.match(scope, /Architecture Report\.pdf application\/pdf/);
  assert.doesNotMatch(scope, /u2/);
});

test("normalizes generated chat titles to concise plain text", () => {
  assert.equal(
    chatServiceTestUtils.normalizeGeneratedChatTitle('"Chat Title: Graphify Retrieval Accuracy Improvements."', "fallback"),
    "Graphify Retrieval Accuracy Improvements"
  );
});

test("routes artifact follow-ups to conversation context", () => {
  const thread = {
    id: "thread-2",
    title: "Artifact Followup",
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z",
    messages: [
      {
        id: "u1",
        role: "user",
        content: "Create a PDF report about onboarding.",
        createdAt: "2026-07-06T00:00:00.000Z"
      },
      {
        id: "a1",
        role: "assistant",
        content: "I generated the file.",
        createdAt: "2026-07-06T00:00:01.000Z",
        artifacts: [
          {
            id: "artifact-report",
            messageId: "a1",
            filename: "Onboarding Report.pdf",
            mimeType: "application/pdf",
            sizeBytes: 2048,
            kind: "binary",
            storagePath: "/tmp/Onboarding Report.pdf",
            contextPreview: "Onboarding report draft content.",
            createdAt: "2026-07-06T00:00:01.000Z",
            source: "local-tool"
          }
        ]
      }
    ]
  };

  assert.equal(chatServiceTestUtils.shouldPreferConversationContext(thread, "Turn this into md"), true);
  assert.equal(chatServiceTestUtils.shouldPreferConversationContext(thread, "Find citations from ingested sources for this"), false);
});

test("keeps Graphify evidence out of user-role prompt content", () => {
  const thread = {
    id: "thread-3",
    title: "Grounding Privacy",
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z",
    messages: [
      {
        id: "u1",
        role: "user",
        content: "What did the source say?",
        createdAt: "2026-07-06T00:00:00.000Z"
      }
    ]
  };
  const graphify = {
    query: "source",
    stdout: "SECRET_GRAPH_CONTEXT",
    budget: 2600,
    command: "graphify query source",
    graphPath: "/tmp/graph.json",
    citations: [{ label: "source.md", sourceFile: "source.md" }]
  };

  const messages = chatServiceTestUtils.buildChatMessagesForTest(thread, "Turn this into md", graphify);
  const userContent = messages.filter((message) => message.role === "user").map((message) => message.content).join("\n");
  const systemContent = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");

  assert.doesNotMatch(userContent, /SECRET_GRAPH_CONTEXT|Graphify command|Context budget|Local Graphify context/);
  assert.match(systemContent, /SECRET_GRAPH_CONTEXT/);
  assert.equal(messages[messages.length - 1].role, "user");
  assert.equal(messages[messages.length - 1].content, "Turn this into md");
});

test("includes artifact working context as private system evidence", () => {
  const thread = {
    id: "thread-4",
    title: "Artifact Context",
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z",
    messages: []
  };

  const messages = chatServiceTestUtils.buildChatMessagesForTest(
    thread,
    "Improve this",
    null,
    "--- Artifact artifact-1: Report.pdf (application/pdf) ---\nDraft report body"
  );
  const systemContent = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
  const userContent = messages.filter((message) => message.role === "user").map((message) => message.content).join("\n");

  assert.match(systemContent, /Private artifact working context/);
  assert.match(systemContent, /Draft report body/);
  assert.doesNotMatch(userContent, /Draft report body/);
});

test("chat prompt advertises supported math notation", () => {
  const thread = {
    id: "thread-5",
    title: "Math Prompt",
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z",
    messages: []
  };

  const messages = chatServiceTestUtils.buildChatMessagesForTest(thread, "Explain the equation $E=mc^2$.", null);
  const systemContent = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");

  assert.match(systemContent, /renders LaTeX math notation/);
  assert.match(systemContent, /\$E = mc\^2\$/);
  assert.match(systemContent, /\$\$\.\.\.\$\$/);
});
