const assert = require("node:assert/strict");
const test = require("node:test");

const { artifactToolServiceTestUtils } = require("../../dist/main/services/ArtifactToolService.js");

test("converts markdown equations into artifact math AST nodes", () => {
  const ast = artifactToolServiceTestUtils.textToArtifactAst({
    title: "Math Notes",
    filename: "Math Notes.pdf",
    documentType: "report",
    text: [
      "# Energy",
      "",
      "Inline equation $E = mc^2$ stays available.",
      "",
      "$$",
      "\\int_0^1 x^2 dx",
      "$$"
    ].join("\n")
  });

  const nodeTypes = ast.nodes.map((node) => node.type);
  assert.ok(nodeTypes.includes("MATH_INLINE"));
  assert.ok(nodeTypes.includes("MATH_BLOCK"));
  assert.deepEqual(
    ast.nodes.filter((node) => node.type === "MATH_INLINE").map((node) => node.text),
    ["E = mc^2"]
  );
  assert.deepEqual(
    ast.nodes.filter((node) => node.type === "MATH_BLOCK").map((node) => node.text),
    ["\\int_0^1 x^2 dx"]
  );
});

test("renders docx math blocks as readable equation text", () => {
  const buffer = artifactToolServiceTestUtils.renderDocx(
    ["# Math", "", "\\[", "x^2 + y^2 = z^2", "\\]"].join("\n"),
    "Math"
  );
  const content = buffer.toString("utf8");

  assert.match(content, /Cambria Math/);
  assert.match(content, /x\^2 \+ y\^2 = z\^2/);
});
