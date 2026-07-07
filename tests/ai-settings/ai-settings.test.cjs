const assert = require("node:assert/strict");
const { mkdir, mkdtemp, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { AiSettingsService } = require("../../dist/main/services/AiSettingsService.js");

function clearGraphifyBudgetEnv() {
  delete process.env.SECOND_BRAIN_GRAPHIFY_MAX_TOKENS;
  delete process.env.GRAPHIFY_MAX_OUTPUT_TOKENS;
  delete process.env.SECOND_BRAIN_GRAPHIFY_RETRY_MAX_TOKENS;
}

test("AiSettingsService defaults Graphify extraction budgets to larger entity extraction caps", async () => {
  clearGraphifyBudgetEnv();
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "second-brain-ai-settings-defaults-"));
  const service = new AiSettingsService(userDataPath);

  await service.initialize();
  const settings = await service.getAppSettings();

  assert.equal(settings.graphify.maxTokens, 32768);
  assert.equal(settings.graphify.retryMaxTokens, 16384);
});

test("AiSettingsService migrates persisted old Graphify default budgets", async () => {
  clearGraphifyBudgetEnv();
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "second-brain-ai-settings-migrate-"));
  const settingsPath = path.join(userDataPath, "settings", "ai.json");
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(
    settingsPath,
    JSON.stringify({
      aiMode: "local",
      ai: {
        endpoint: "http://localhost:8080/v1/chat/completions",
        apiKey: "local-dev-placeholder",
        model: "local-model"
      },
      graphify: {
        graphifyBin: "",
        maxTokens: 8192,
        retryMaxTokens: 4096,
        timeoutMs: 600000,
        cardDefinitions: true,
        cardDefinitionMaxPerPass: 24,
        paperComponents: true
      }
    }),
    "utf8"
  );

  const service = new AiSettingsService(userDataPath);
  const settings = await service.getAppSettings();

  assert.equal(settings.graphify.maxTokens, 32768);
  assert.equal(settings.graphify.retryMaxTokens, 16384);
});

test("AiSettingsService preserves custom Graphify extraction budgets", async () => {
  clearGraphifyBudgetEnv();
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "second-brain-ai-settings-custom-"));
  const settingsPath = path.join(userDataPath, "settings", "ai.json");
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(
    settingsPath,
    JSON.stringify({
      aiMode: "local",
      graphify: {
        maxTokens: 24576,
        retryMaxTokens: 12288
      }
    }),
    "utf8"
  );

  const service = new AiSettingsService(userDataPath);
  const settings = await service.getAppSettings();

  assert.equal(settings.graphify.maxTokens, 24576);
  assert.equal(settings.graphify.retryMaxTokens, 12288);
});
