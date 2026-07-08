const { readFileSync } = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const buildInfoPath = path.join(rootDir, "dist", "build-info.json");
const buildInfo = JSON.parse(readFileSync(buildInfoPath, "utf8"));

const missing = [];
if (buildInfo.channel !== "production") {
  missing.push(`channel=${buildInfo.channel}`);
}
if (!buildInfo.supabaseUrl) {
  missing.push("SECOND_BRAIN_SUPABASE_URL");
}
if (!buildInfo.supabaseAnonKey) {
  missing.push("SECOND_BRAIN_SUPABASE_ANON_KEY");
}

if (missing.length > 0) {
  console.error(`Production build assertion failed: ${missing.join(", ")}`);
  process.exit(1);
}

console.log(`Production build assertion passed for ${buildInfo.version} (${buildInfo.target})`);
