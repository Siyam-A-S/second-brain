import os from "node:os";
import path from "node:path";

export type RuntimeCommandCandidate = {
  command: string;
  args: string[];
  shell?: boolean | undefined;
};

const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";

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
    return uniqueRuntimeCommands([windowsUserBin("graphify.exe"), windowsUserBin("graphify.cmd"), "graphify"]);
  }

  if (isMac) {
    return uniqueRuntimeCommands(macBinaryCandidates("graphify"));
  }

  return uniqueRuntimeCommands([path.join(os.homedir(), ".local", "bin", "graphify"), "graphify"]);
}

export function runtimePythonCommands(): string[] {
  if (isWindows) {
    return uniqueRuntimeCommands(["py", "python"]);
  }

  if (isMac) {
    return uniqueRuntimeCommands([...macBinaryCandidates("python3"), "python"]);
  }

  return uniqueRuntimeCommands([path.join(os.homedir(), ".local", "bin", "python3"), "python3", "python"]);
}

export function runtimePathSegments(): string[] {
  if (isWindows) {
    return [];
  }

  return uniqueRuntimeCommands([
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
