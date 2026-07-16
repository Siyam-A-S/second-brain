const assert = require("node:assert/strict");
const test = require("node:test");

const { createLocalToolRegistry } = require("../../dist/main/services/LocalToolRegistry.js");

const graphRag = {
  searchBoardTopology: async () => ({}),
  fetchFileSegments: async () => ({}),
  ingestAndRouteFragment: async () => ({}),
  exportBoardPlaintext: async () => ""
};

test("local tool registry does not expose Graphify save-result memory creation", () => {
  const tools = createLocalToolRegistry({
    graphRag,
    graphifyContext: {
      query: async () => ({}),
      explain: async () => ({}),
      tracePath: async () => ({})
    }
  });

  assert.ok(!tools.some((tool) => tool.name === "save_graphify_result"));
});
