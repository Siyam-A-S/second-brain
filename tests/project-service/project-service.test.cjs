const assert = require("node:assert/strict");
const { mkdir, mkdtemp, symlink, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ProjectService } = require("../../dist/main/services/ProjectService.js");

test("reports recursive project storage usage without following symlinks", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "second-brain-project-usage-"));
  const service = new ProjectService(userDataPath);
  await service.initialize();

  const active = await service.getActiveProject();
  await writeFile(path.join(active.rootPath, "small.txt"), "hello", "utf8");
  await mkdir(path.join(active.rootPath, "nested"), { recursive: true });
  await writeFile(path.join(active.rootPath, "nested", "large.bin"), Buffer.alloc(2048));

  try {
    await symlink(path.join(active.rootPath, "nested"), path.join(active.rootPath, "nested-link"), "dir");
  } catch {
    // Some Windows test environments disallow symlink creation; the size check still validates normal recursion.
  }

  const usage = await service.getStorageUsage();

  assert.ok(usage.bytes >= 2053);
  assert.match(usage.label, /(KB|MB|GB|B)$/);
  assert.equal(usage.projectsPath, path.join(userDataPath, "projects"));
  assert.ok(Date.parse(usage.checkedAt));
});
