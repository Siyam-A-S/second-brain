import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AppBuildInfo, BuildChannel } from "../../shared/brain";

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
    target: process.env.SECOND_BRAIN_BUILD_TARGET?.trim() || process.platform
  };

  try {
    const buildInfoPath = path.join(__dirname, "..", "build-info.json");
    const parsed = JSON.parse(await readFile(buildInfoPath, "utf8")) as Record<string, unknown>;
    return {
      channel: normalizeChannel(process.env.SECOND_BRAIN_BUILD_CHANNEL ?? parsed.channel),
      version: stringValue(parsed.version, fallback.version),
      buildId: stringValue(process.env.SECOND_BRAIN_BUILD_ID ?? parsed.buildId, fallback.buildId),
      gitCommit: stringValue(process.env.SECOND_BRAIN_GIT_COMMIT ?? parsed.gitCommit, fallback.gitCommit),
      target: stringValue(process.env.SECOND_BRAIN_BUILD_TARGET ?? parsed.target, fallback.target)
    };
  } catch {
    return fallback;
  }
}
