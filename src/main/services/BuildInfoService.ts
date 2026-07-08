import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AppBuildInfo, BuildChannel } from "../../shared/brain";

const defaultWebsiteUrl = "https://www.downloadsecondbrain.com";
const defaultProxyUrl = "https://graphify-proxy-724616525781.us-central1.run.app";

function normalizeChannel(value: unknown): BuildChannel {
  return value === "production" ? "production" : "development";
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export async function loadBuildInfo(defaultVersion: string): Promise<AppBuildInfo> {
  const fallback: AppBuildInfo = {
    channel: normalizeChannel(process.env.SECOND_BRAIN_BUILD_CHANNEL),
    version: defaultVersion || "0.0.0",
    buildId: process.env.SECOND_BRAIN_BUILD_ID?.trim() || new Date().toISOString(),
    gitCommit: process.env.SECOND_BRAIN_GIT_COMMIT?.trim() || "unknown",
    target: process.env.SECOND_BRAIN_BUILD_TARGET?.trim() || process.platform,
    websiteUrl: process.env.SECOND_BRAIN_WEBSITE_URL?.trim() || defaultWebsiteUrl,
    proxyUrl: process.env.SECOND_BRAIN_PROXY_URL?.trim() || defaultProxyUrl,
    supabaseUrl: process.env.SECOND_BRAIN_SUPABASE_URL?.trim() || "",
    supabaseAnonKey: process.env.SECOND_BRAIN_SUPABASE_ANON_KEY?.trim() || ""
  };

  try {
    const buildInfoPath = await firstReadableBuildInfoPath();
    const parsed = JSON.parse(await readFile(buildInfoPath, "utf8")) as Record<string, unknown>;
    return {
      channel: normalizeChannel(process.env.SECOND_BRAIN_BUILD_CHANNEL ?? parsed.channel),
      version: stringValue(parsed.version, fallback.version),
      buildId: stringValue(process.env.SECOND_BRAIN_BUILD_ID ?? parsed.buildId, fallback.buildId),
      gitCommit: stringValue(process.env.SECOND_BRAIN_GIT_COMMIT ?? parsed.gitCommit, fallback.gitCommit),
      target: stringValue(process.env.SECOND_BRAIN_BUILD_TARGET ?? parsed.target, fallback.target),
      websiteUrl: stringValue(process.env.SECOND_BRAIN_WEBSITE_URL ?? parsed.websiteUrl, fallback.websiteUrl),
      proxyUrl: stringValue(process.env.SECOND_BRAIN_PROXY_URL ?? parsed.proxyUrl, fallback.proxyUrl),
      supabaseUrl: stringValue(process.env.SECOND_BRAIN_SUPABASE_URL ?? parsed.supabaseUrl, fallback.supabaseUrl),
      supabaseAnonKey: stringValue(
        process.env.SECOND_BRAIN_SUPABASE_ANON_KEY ?? parsed.supabaseAnonKey,
        fallback.supabaseAnonKey
      )
    };
  } catch {
    return fallback;
  }
}

async function firstReadableBuildInfoPath(): Promise<string> {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath || "";
  const primaryPath = path.join(__dirname, "..", "..", "build-info.json");
  const candidates = [
    primaryPath,
    path.join(__dirname, "..", "build-info.json"),
    path.join(resourcesPath, "app.asar", "dist", "build-info.json"),
    path.join(resourcesPath, "app", "dist", "build-info.json")
  ];

  for (const candidate of candidates) {
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch {
      // Try the next packaged/development layout.
    }
  }

  return primaryPath;
}
