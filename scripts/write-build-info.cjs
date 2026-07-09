const { execSync } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const packageJson = require(path.join(rootDir, "package.json"));
const channel = process.env.SECOND_BRAIN_BUILD_CHANNEL === "production" ? "production" : "development";
const buildId =
  process.env.SECOND_BRAIN_BUILD_ID ||
  new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");

function envValue(name) {
  return (process.env[name] || "").trim();
}

function requiredProductionEnv(name) {
  const value = envValue(name);
  if (channel === "production" && !value) {
    throw new Error(`${name} is required for production builds.`);
  }
  return value;
}

function git(command, fallback) {
  try {
    return execSync(command, { cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || fallback;
  } catch {
    return fallback;
  }
}

const buildInfo = {
  channel,
  version: packageJson.version,
  buildId,
  gitCommit: process.env.SECOND_BRAIN_GIT_COMMIT || git("git rev-parse --short HEAD", "unknown"),
  target: process.env.SECOND_BRAIN_BUILD_TARGET || process.platform,
  websiteUrl: envValue("SECOND_BRAIN_WEBSITE_URL") || "https://www.downloadsecondbrain.com",
  proxyUrl: envValue("SECOND_BRAIN_PROXY_URL") || "https://graphify-proxy-724616525781.us-central1.run.app",
  supabaseUrl: requiredProductionEnv("SECOND_BRAIN_SUPABASE_URL"),
  supabaseAnonKey: requiredProductionEnv("SECOND_BRAIN_SUPABASE_ANON_KEY")
};

mkdirSync(path.join(rootDir, "dist"), { recursive: true });
writeFileSync(path.join(rootDir, "dist", "build-info.json"), `${JSON.stringify(buildInfo, null, 2)}\n`, "utf8");
console.log(`Wrote dist/build-info.json (${channel})`);
