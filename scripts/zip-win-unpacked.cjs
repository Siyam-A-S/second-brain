const { copyFileSync, existsSync, readdirSync, rmSync, statSync, writeFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const releaseDir = path.join(rootDir, "release");
const unpackedDirName = "win-unpacked";
const unpackedDir = path.join(releaseDir, unpackedDirName);
const appAsarPath = path.join(unpackedDir, "resources", "app.asar");
const distDir = path.join(rootDir, "dist");
const packageJson = require(path.join(rootDir, "package.json"));
const rawBuildId = process.env.SECOND_BRAIN_BUILD_ID || new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
const buildId = rawBuildId.replace(/[^A-Za-z0-9._-]/g, "-");
const archiveName = `Second-Brain-${packageJson.version}-${buildId}-win-unpacked.zip`;
const latestArchiveName = `Second-Brain-${packageJson.version}-latest-win-unpacked.zip`;
const legacyArchiveName = `Second-Brain-${packageJson.version}-win-unpacked.zip`;
const archivePath = path.join(releaseDir, archiveName);
const latestArchivePath = path.join(releaseDir, latestArchiveName);
const legacyArchivePath = path.join(releaseDir, legacyArchiveName);

if (!existsSync(unpackedDir)) {
  console.error(`Cannot zip Windows app: ${unpackedDir} does not exist.`);
  process.exit(1);
}

if (!existsSync(appAsarPath)) {
  console.error(`Cannot zip Windows app: ${appAsarPath} does not exist.`);
  process.exit(1);
}

function newestMtimeMs(directory) {
  if (!existsSync(directory)) {
    return 0;
  }

  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.reduce((newest, entry) => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return Math.max(newest, newestMtimeMs(entryPath));
    }

    if (!entry.isFile()) {
      return newest;
    }

    return Math.max(newest, statSync(entryPath).mtimeMs);
  }, 0);
}

const latestDistMtimeMs = newestMtimeMs(distDir);
const appAsarMtimeMs = statSync(appAsarPath).mtimeMs;

if (latestDistMtimeMs > appAsarMtimeMs + 1000 && process.env.SECOND_BRAIN_ALLOW_STALE_ZIP !== "1") {
  console.error("Refusing to zip stale release/win-unpacked.");
  console.error("dist/ is newer than release/win-unpacked/resources/app.asar.");
  console.error("Run `npm run package:win` to rebuild the Windows app, or `SECOND_BRAIN_ALLOW_STALE_ZIP=1 npm run package:win:zip-existing` if you really want the existing folder.");
  process.exit(1);
}

if (existsSync(archivePath)) {
  rmSync(archivePath, { force: true });
}

if (existsSync(latestArchivePath)) {
  rmSync(latestArchivePath, { force: true });
}

if (existsSync(legacyArchivePath)) {
  rmSync(legacyArchivePath, { force: true });
}

const result =
  process.platform === "win32"
    ? spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `Compress-Archive -Path ${JSON.stringify(unpackedDirName)} -DestinationPath ${JSON.stringify(archiveName)} -Force`
        ],
        { cwd: releaseDir, stdio: "inherit" }
      )
    : spawnSync("zip", ["-qr", archiveName, unpackedDirName], {
        cwd: releaseDir,
        stdio: "inherit"
      });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

copyFileSync(archivePath, latestArchivePath);
writeFileSync(path.join(releaseDir, "latest-win-unpacked.txt"), `${archiveName}\n`, "utf8");

console.info(`Created ${path.relative(rootDir, archivePath)}`);
console.info(`Updated ${path.relative(rootDir, latestArchivePath)}`);
