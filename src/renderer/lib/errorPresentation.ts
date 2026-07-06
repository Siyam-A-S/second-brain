import type { AppBuildInfo } from "../../shared/ipc";

export const productionErrorMessage = "Something went wrong. Try again.";

export function isProductionBuild(buildInfo: AppBuildInfo | null | undefined): boolean {
  return buildInfo?.channel === "production";
}

export function presentError(error: unknown, fallback: string, buildInfo: AppBuildInfo | null | undefined): string {
  if (isProductionBuild(buildInfo)) {
    return productionErrorMessage;
  }

  return error instanceof Error ? error.message : fallback;
}

export function presentPossiblyDetailedError(
  value: string | undefined,
  fallback: string,
  buildInfo: AppBuildInfo | null | undefined
): string {
  if (isProductionBuild(buildInfo)) {
    return productionErrorMessage;
  }

  return value || fallback;
}
