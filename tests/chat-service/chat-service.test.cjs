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
