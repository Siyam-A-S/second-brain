import os from "node:os";
import path from "node:path";

export type RuntimeCommandCandidate = {
  command: string;
  args: string[];
  shell?: boolean | undefined;
};

const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const runtimePlatform = isWindows ? "win32" : isMac ? "darwin" : process.platform;

function resourcesPath(): string {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath || path.resolve(process.cwd(), "resources");
}

function bundledRuntimeDir(): string {
  return path.join(resourcesPath(), "runtime", `${runtimePlatform}-${process.arch}`);
}

function bundledRuntimeBinDir(): string {
  return isWindows ? path.join(bundledRuntimeDir(), "Scripts") : path.join(bundledRuntimeDir(), "bin");
}

export function bundledPythonCommand(): string {
  return isWindows ? path.join(bundledRuntimeDir(), "python.exe") : path.join(bundledRuntimeBinDir(), "python3");
}

export function isCmdShim(filePath: string): boolean {
  return isWindows && /\.(cmd|bat)$/i.test(filePath);
}

export function uniqueRuntimeCommands(commands: string[]): string[] {
  const seen = new Set<string>();
  return commands.filter((command) => {
    if (!command || seen.has(command)) {
      return false;
    }
    seen.add(command);
    return true;
  });
}

export function uniqueRuntimeCandidates<T extends RuntimeCommandCandidate>(candidates: T[]): T[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.command}\0${candidate.args.join("\0")}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function windowsUserBin(fileName: string): string {
  return path.join(process.env.USERPROFILE || os.homedir(), ".local", "bin", fileName);
}

function macBinaryCandidates(binaryName: string): string[] {
  return [
    `/opt/homebrew/bin/${binaryName}`,
    `/usr/local/bin/${binaryName}`,
    `/usr/bin/${binaryName}`,
    path.join(os.homedir(), ".local", "bin", binaryName),
    binaryName
  ];
}

export function runtimeUvCommands(): string[] {
  if (isWindows) {
    return uniqueRuntimeCommands([windowsUserBin("uv.exe"), "uv"]);
  }

  if (isMac) {
    return uniqueRuntimeCommands(macBinaryCandidates("uv"));
  }

  return uniqueRuntimeCommands([path.join(os.homedir(), ".local", "bin", "uv"), "uv"]);
}

export function runtimeGraphifyCommands(): string[] {
  if (isWindows) {
    return uniqueRuntimeCommands([
      path.join(bundledRuntimeBinDir(), "graphify.exe"),
      path.join(bundledRuntimeBinDir(), "graphify.cmd"),
      windowsUserBin("graphify.exe"),
      windowsUserBin("graphify.cmd"),
      "graphify"
    ]);
  }

  if (isMac) {
    return uniqueRuntimeCommands([path.join(bundledRuntimeBinDir(), "graphify"), ...macBinaryCandidates("graphify")]);
  }

  return uniqueRuntimeCommands([path.join(bundledRuntimeBinDir(), "graphify"), path.join(os.homedir(), ".local", "bin", "graphify"), "graphify"]);
}

export function runtimePythonCommands(): string[] {
  if (isWindows) {
    return uniqueRuntimeCommands([bundledPythonCommand(), "py", "python"]);
  }

  if (isMac) {
    return uniqueRuntimeCommands([bundledPythonCommand(), ...macBinaryCandidates("python3"), "python"]);
  }

  return uniqueRuntimeCommands([bundledPythonCommand(), path.join(os.homedir(), ".local", "bin", "python3"), "python3", "python"]);
}

export function runtimePathSegments(): string[] {
  if (isWindows) {
    return uniqueRuntimeCommands([bundledRuntimeBinDir(), bundledRuntimeDir()]);
  }

  return uniqueRuntimeCommands([
    bundledRuntimeBinDir(),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(os.homedir(), ".local", "bin"),
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin"
  ]);
}

export function withRuntimePath(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const currentPath = env[pathKey] ?? "";
  const delimiter = path.delimiter;
  const nextPath = uniqueRuntimeCommands([...runtimePathSegments(), ...currentPath.split(delimiter).filter(Boolean)]).join(delimiter);

  return {
    ...env,
    [pathKey]: nextPath || currentPath
  };
}

export function withRuntimePathRecord(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return Object.fromEntries(
    Object.entries(withRuntimePath(env)).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}
