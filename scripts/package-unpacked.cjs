const { existsSync, readdirSync, rmSync, writeFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const releaseDir = path.join(rootDir, "release");
const args = new Set(process.argv.slice(2));
const target = args.has("--mac")
  ? "mac"
  : args.has("--win")
    ? "win"
    : args.has("--linux")
      ? "linux"
      : process.platform === "darwin"
        ? "mac"
        : process.platform === "win32"
          ? "win"
          : "linux";
const targetFlag = `--${target}`;
const buildId = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
const electronBuilderBin = path.join(
  rootDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron-builder.cmd" : "electron-builder"
);

const appLayout = {
  mac: {
    unpackedDir: path.join(releaseDir, "mac"),
    appAsarPath: path.join(releaseDir, "mac", "Second Brain.app", "Contents", "Resources", "app.asar"),
    buildInfoDir: path.join(releaseDir, "mac", "Second Brain.app", "Contents", "Resources"),
    label: "macOS unpacked build"
  },
  win: {
    unpackedDir: path.join(releaseDir, "win-unpacked"),
    appAsarPath: path.join(releaseDir, "win-unpacked", "resources", "app.asar"),
    buildInfoDir: path.join(releaseDir, "win-unpacked"),
    label: "Windows portable build"
  },
  linux: {
    unpackedDir: path.join(releaseDir, "linux-unpacked"),
    appAsarPath: path.join(releaseDir, "linux-unpacked", "resources", "app.asar"),
    buildInfoDir: path.join(releaseDir, "linux-unpacked"),
    label: "Linux unpacked build"
  }
}[target];

if (!appLayout) {
  console.error(`Unsupported target: ${target}`);
  process.exit(1);
}

rmSync(appLayout.unpackedDir, { recursive: true, force: true });

const buildResult = spawnSync(electronBuilderBin, [targetFlag, "--dir"], {
  cwd: rootDir,
  shell: process.platform === "win32",
  stdio: "inherit"
});

const hasFreshBundle = existsSync(appLayout.appAsarPath);

if (buildResult.error) {
  console.error(buildResult.error.message);
  process.exit(1);
}

if (buildResult.status !== 0 && !(target === "win" && hasFreshBundle)) {
  process.exit(buildResult.status ?? 1);
}

if (buildResult.status !== 0) {
  console.warn("electron-builder exited non-zero after creating win-unpacked; continuing to zip the portable bundle.");
}

if (!hasFreshBundle) {
  console.error(`electron-builder finished but did not create ${appLayout.appAsarPath}.`);
  process.exit(1);
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
  path.join(appLayout.buildInfoDir, "BUILD_INFO.txt"),
  [
    `Second Brain ${appLayout.label}`,
    `build_id=${buildId}`,
    `version=${require(path.join(rootDir, "package.json")).version}`,
    `git_commit=${gitCommit || "unknown"}`,
    `git_dirty=${gitStatus ? "true" : "false"}`,
    `target=${target}`,
    "graphify_runtime=installer-managed",
    `renderer_assets=${rendererFiles.join(",") || "unknown"}`,
    ""
  ].join("\n"),
  "utf8"
);

if (target === "win" && args.has("--zip")) {
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
}

console.log(`${appLayout.label} ready: ${appLayout.unpackedDir}`);
