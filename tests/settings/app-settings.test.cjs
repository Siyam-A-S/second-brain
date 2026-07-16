const assert = require("node:assert/strict");
const { mkdtemp, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { AiSettingsService } = require("../../dist/main/services/AiSettingsService.js");

test("app appearance settings default to dolphin persona", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "second-brain-settings-"));
  try {
    const service = new AiSettingsService(root, "development");
    await service.initialize();
    const settings = await service.getAppSettings();
    assert.deepEqual(settings.appearance, {
      topBarMirrored: false,
      persona: "dolphin"
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("app appearance settings normalize selected and misspelled personas", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "second-brain-settings-"));
  try {
    const service = new AiSettingsService(root, "development");
    await service.initialize();

    const selected = await service.updateAppSettings({
      appearance: {
        persona: "hippo"
      }
    });
    assert.equal(selected.appearance.persona, "hippo");

    const repaired = await service.updateAppSettings({
      appearance: {
        persona: "moneky"
      }
    });
    assert.equal(repaired.appearance.persona, "monkey");

    const fallback = await service.updateAppSettings({
      appearance: {
        persona: "dragon"
      }
    });
    assert.equal(fallback.appearance.persona, "dolphin");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
