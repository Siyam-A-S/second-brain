const { existsSync, readdirSync, rmSync, writeFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const releaseDir = path.join(rootDir, "release");
const unpackedDir = path.join(releaseDir, "win-unpacked");
const executablePath = path.join(unpackedDir, "Second Brain.exe");
const appAsarPath = path.join(unpackedDir, "resources", "app.asar");
const buildId = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
const electronBuilderBin = path.join(
  rootDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron-builder.cmd" : "electron-builder"
);

rmSync(unpackedDir, { recursive: true, force: true });

const buildResult = spawnSync(electronBuilderBin, ["--win", "--dir"], {
  cwd: rootDir,
  stdio: "inherit"
});

const hasFreshWindowsBundle = existsSync(executablePath) && existsSync(appAsarPath);

if (buildResult.error) {
  console.error(buildResult.error.message);
  process.exit(1);
}

if (buildResult.status !== 0 && !hasFreshWindowsBundle) {
  process.exit(buildResult.status ?? 1);
}

if (buildResult.status !== 0) {
  console.warn("electron-builder exited non-zero after creating win-unpacked; continuing to zip the portable bundle.");
}

const rendererAssets = path.join(rootDir, "dist", "renderer", "assets");
const rendererFiles = existsSync(rendererAssets)
  ? readdirSync(rendererAssets).filter((fileName) => fileName.endsWith(".js") || fileName.endsWith(".css")).sort()
  : [];
const gitCommit = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
  cwd: rootDir,
  encoding: "utf8"
}).stdout.trim();
const gitStatus = spawnSync("git", ["status", "--short"], {
  cwd: rootDir,
  encoding: "utf8"
}).stdout.trim();

writeFileSync(
  path.join(unpackedDir, "BUILD_INFO.txt"),
  [
    `Second Brain Windows portable build`,
    `build_id=${buildId}`,
    `version=${require(path.join(rootDir, "package.json")).version}`,
    `git_commit=${gitCommit || "unknown"}`,
    `git_dirty=${gitStatus ? "true" : "false"}`,
    `renderer_assets=${rendererFiles.join(",") || "unknown"}`,
    ""
  ].join("\n"),
  "utf8"
);

const zipResult = spawnSync(process.execPath, [path.join(rootDir, "scripts", "zip-win-unpacked.cjs")], {
  cwd: rootDir,
  env: {
    ...process.env,
    SECOND_BRAIN_BUILD_ID: buildId
  },
  stdio: "inherit"
});

if (zipResult.error) {
  console.error(zipResult.error.message);
  process.exit(1);
}

process.exit(zipResult.status ?? 0);
