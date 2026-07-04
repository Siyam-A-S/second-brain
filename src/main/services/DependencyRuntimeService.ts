import { execFile } from "node:child_process";
import type { ExecFileOptions } from "node:child_process";
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DependencyRuntimeStatus, RuntimeDependencyCheck } from "../../shared/brain";

const graphifyToolPackage = "graphifyy[all]";
const timeoutMs = 180_000;
const maxBuffer = 2 * 1024 * 1024;
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";

type RuntimeCommandCandidate = {
  command: string;
  args: string[];
  shell?: boolean | undefined;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function repairCommandText(): string {
  if (isWindows) {
    return [
      "winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements",
      'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"',
      `uv tool install --upgrade "${graphifyToolPackage}"`,
      "py -3.10 -m pip install --user --upgrade fpdf2",
      "uv tool ensurepath"
    ].join("\n");
  }

  if (isMac) {
    return [
      "brew install python uv",
      `uv tool install --upgrade "${graphifyToolPackage}"`,
      "python3 -m pip install --user --upgrade fpdf2 --break-system-packages",
      "uv tool ensurepath"
    ].join("\n");
  }

  return [`uv tool install --upgrade "${graphifyToolPackage}"`, "python3 -m pip install --user --upgrade fpdf2 --break-system-packages", "uv tool ensurepath"].join("\n");
}

function uniqueCandidates<T extends RuntimeCommandCandidate>(candidates: T[]): T[] {
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

function windowsPythonCandidates(): Array<{ command: string; args: string[] }> {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

  return [
    { command: "py", args: ["-3.10", "--version"] },
    { command: "python", args: ["--version"] },
    { command: path.join(localAppData, "Programs", "Python", "Python312", "python.exe"), args: ["--version"] },
    { command: path.join(localAppData, "Programs", "Python", "Python311", "python.exe"), args: ["--version"] },
    { command: path.join(programFiles, "Python312", "python.exe"), args: ["--version"] },
    { command: path.join(programFiles, "Python311", "python.exe"), args: ["--version"] },
    { command: path.join(programFilesX86, "Python312", "python.exe"), args: ["--version"] }
  ];
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

function pythonCandidates(): Array<{ command: string; args: string[] }> {
  if (isWindows) {
    return windowsPythonCandidates();
  }

  if (isMac) {
    return macBinaryCandidates("python3")
      .map((command) => ({ command, args: ["--version"] }))
      .concat([{ command: "python", args: ["--version"] }]);
  }

  return [
    { command: "python3", args: ["--version"] },
    { command: "python", args: ["--version"] }
  ];
}

function uvCandidates(): Array<{ command: string; args: string[] }> {
  if (isWindows) {
    return [
      { command: windowsUserBin("uv.exe"), args: ["--version"] },
      { command: "uv", args: ["--version"] }
    ];
  }

  if (isMac) {
    return macBinaryCandidates("uv").map((command) => ({ command, args: ["--version"] }));
  }

  return [{ command: "uv", args: ["--version"] }];
}

function graphifyPathCandidates(): string[] {
  if (isWindows) {
    return [
      windowsUserBin("graphify.exe"),
      windowsUserBin("graphify.cmd"),
      "graphify"
    ];
  }

  if (isMac) {
    return macBinaryCandidates("graphify");
  }

  return [path.join(os.homedir(), ".local", "bin", "graphify"), "graphify"];
}

function parsePythonVersion(value: string): { version: string; ok: boolean } {
  const version = value.match(/Python\s+(\d+)\.(\d+)(?:\.(\d+))?/i);
  if (!version) {
    return { version: value.trim(), ok: false };
  }

  const major = Number(version[1]);
  const minor = Number(version[2]);
  return {
    version: version[0],
    ok: major > 3 || (major === 3 && minor >= 10)
  };
}

export class DependencyRuntimeService {
  private lastRepairOutput = "";

  async getStatus(): Promise<DependencyRuntimeStatus> {
    const [python, uv, graphify, fpdf2] = await Promise.all([
      this.checkPython(),
      this.checkUv(),
      this.checkGraphify(),
      this.checkFpdf2()
    ]);
    const dependencies = [python, uv, graphify, fpdf2];
    const guidance = dependencies.filter((dependency) => !dependency.available).map((dependency) => dependency.guidance);

    return {
      available: dependencies.every((dependency) => dependency.available),
      checkedAt: new Date().toISOString(),
      dependencies,
      guidance,
      repairCommand: repairCommandText(),
      lastRepairOutput: this.lastRepairOutput || undefined
    };
  }

  async installOrRepair(): Promise<DependencyRuntimeStatus> {
    const commands: Array<{ command: string; args: string[]; shell?: boolean | undefined }> = [];

    const current = await this.getStatus();
    const pythonAvailable = current.dependencies.find((dependency) => dependency.name === "python")?.available;
    const uvAvailable = current.dependencies.find((dependency) => dependency.name === "uv")?.available;

    if (!pythonAvailable && isWindows) {
      commands.push({
        command: "winget",
        args: [
          "install",
          "-e",
          "--id",
          "Python.Python.3.12",
          "--scope",
          "user",
          "--silent",
          "--accept-package-agreements",
          "--accept-source-agreements"
        ]
      });
    }

    if (!uvAvailable && isWindows) {
      commands.push({
        command: "powershell.exe",
        args: ["-ExecutionPolicy", "ByPass", "-Command", "irm https://astral.sh/uv/install.ps1 | iex"]
      });
    }

    commands.push(
      {
        command: "uv",
        args: ["tool", "install", "--upgrade", graphifyToolPackage]
      },
      {
        command: "uv",
        args: ["tool", "ensurepath"]
      }
    );

    const pythonCommand = await this.findPythonCommand();
    if (pythonCommand) {
      commands.push({
        command: pythonCommand.command,
        args: [
          ...this.pythonArgsWithoutVersion(pythonCommand),
          "-m",
          "pip",
          "install",
          "--user",
          "--upgrade",
          "fpdf2",
          ...(isWindows ? [] : ["--break-system-packages"])
        ]
      });
    }

    const output: string[] = [];
    for (const command of commands) {
      try {
        output.push(`> ${command.command} ${command.args.join(" ")}`);
        output.push(await this.run(command.command, command.args, { shell: command.shell }));
      } catch (error) {
        output.push(errorText(error));
        this.lastRepairOutput = output.join("\n").trim();
        return this.getStatus();
      }
    }

    this.lastRepairOutput = output.join("\n").trim();
    return this.getStatus();
  }

  private async checkPython(): Promise<RuntimeDependencyCheck> {
    const candidates = uniqueCandidates(pythonCandidates());

    for (const candidate of candidates) {
      try {
        const output = await this.run(candidate.command, candidate.args);
        const parsed = parsePythonVersion(output);
        if (parsed.ok) {
          return {
            name: "python",
            available: true,
            version: parsed.version,
            path: candidate.command,
            required: true,
            guidance: ""
          };
        }
      } catch {
        // Try the next candidate.
      }
    }

    return {
      name: "python",
      available: false,
      version: "",
      required: true,
      guidance: isMac
        ? "Install Python 3.10 or newer with Homebrew (`brew install python`) or make sure python3 is available in /opt/homebrew/bin or /usr/local/bin."
        : "Install Python 3.10 or newer and enable Add Python to PATH."
    };
  }

  private async checkUv(): Promise<RuntimeDependencyCheck> {
    const candidates = uniqueCandidates(uvCandidates());

    for (const candidate of candidates) {
      try {
        const output = await this.run(candidate.command, candidate.args);
        return {
          name: "uv",
          available: true,
          version: output.trim().split(/\r?\n/)[0] ?? "uv",
          path: candidate.command,
          required: true,
          guidance: ""
        };
      } catch {
        // Try the next candidate.
      }
    }

    return {
      name: "uv",
      available: false,
      version: "",
      required: true,
      guidance: isMac
        ? "Install uv with Homebrew (`brew install uv`) or the Astral installer, then restart Second Brain."
        : "Install uv with the Astral installer, then restart Second Brain."
    };
  }

  private async checkGraphify(): Promise<RuntimeDependencyCheck> {
    const direct = process.env.SECOND_BRAIN_GRAPHIFY_BIN?.trim();
    const uvTool = await this.findUvToolGraphifyCommand();
    const graphifyCandidates: Array<RuntimeCommandCandidate | null> = [
      direct ? { command: direct, args: ["--help"], shell: isCmdShim(direct) } : null,
      uvTool ? { command: uvTool, args: ["--help"], shell: isCmdShim(uvTool) } : null,
      ...graphifyPathCandidates().map((command) => ({ command, args: ["--help"], shell: isCmdShim(command) }))
    ];
    const candidates = uniqueCandidates(
      graphifyCandidates.filter((value): value is RuntimeCommandCandidate => Boolean(value))
    );

    for (const candidate of candidates) {
      try {
        await this.run(candidate.command, candidate.args, { shell: candidate.shell });
        return {
          name: "graphify",
          available: true,
          version: path.basename(candidate.command),
          path: candidate.command,
          required: true,
          guidance: ""
        };
      } catch {
        // Try the next candidate.
      }
    }

    return {
      name: "graphify",
      available: false,
      version: "",
      required: true,
      guidance: `Install the full Graphify tool with: uv tool install --upgrade "${graphifyToolPackage}"`
    };
  }

  private async checkFpdf2(): Promise<RuntimeDependencyCheck> {
    for (const candidate of uniqueCandidates(pythonCandidates())) {
      try {
        const output = await this.run(candidate.command, [
          ...this.pythonArgsWithoutVersion(candidate),
          "-c",
          "import fpdf; print(getattr(fpdf, '__version__', 'installed'))"
        ]);
        return {
          name: "fpdf2",
          available: true,
          version: output.trim().split(/\r?\n/)[0] ?? "installed",
          path: candidate.command,
          required: true,
          guidance: ""
        };
      } catch {
        // Try the next Python runtime.
      }
    }

    return {
      name: "fpdf2",
      available: false,
      version: "",
      required: true,
      guidance: isWindows
        ? "Install fpdf2 for artifact rendering with: py -3.10 -m pip install --user --upgrade fpdf2"
        : "Install fpdf2 for artifact rendering with: python3 -m pip install --user --upgrade fpdf2 --break-system-packages"
    };
  }

  private async findPythonCommand(): Promise<RuntimeCommandCandidate | null> {
    for (const candidate of uniqueCandidates(pythonCandidates())) {
      try {
        const output = await this.run(candidate.command, candidate.args);
        if (parsePythonVersion(output).ok) {
          return candidate;
        }
      } catch {
        // Try the next candidate.
      }
    }

    return null;
  }

  private pythonArgsWithoutVersion(candidate: RuntimeCommandCandidate): string[] {
    return candidate.args.filter((arg) => arg !== "--version" && arg !== "-V");
  }

  private async findUvToolGraphifyCommand(): Promise<string | null> {
    const uv = await this.findUvCommand();
    if (!uv) {
      return null;
    }

    try {
      const uvToolDir = (await this.run(uv, ["tool", "dir"], { shell: isCmdShim(uv) })).trim().split(/\r?\n/)[0] ?? "";
      const candidates = [
        path.join(uvToolDir, "graphifyy", "Scripts", "graphify.exe"),
        path.join(uvToolDir, "graphifyy", "Scripts", "graphify.cmd"),
        path.join(uvToolDir, "graphifyy", "bin", "graphify")
      ];

      for (const candidate of candidates) {
        if (await this.fileExists(candidate)) {
          return candidate;
        }
      }
    } catch {
      // uv is not available.
    }

    return null;
  }

  private async findUvCommand(): Promise<string | null> {
    for (const candidate of uniqueCandidates(uvCandidates())) {
      try {
        await this.run(candidate.command, candidate.args, { shell: isCmdShim(candidate.command) });
        return candidate.command;
      } catch {
        // Try the next candidate.
      }
    }

    return null;
  }

  private run(command: string, args: string[], options: Pick<ExecFileOptions, "shell"> = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        command,
        args,
        {
          ...options,
          windowsHide: true,
          timeout: timeoutMs,
          maxBuffer,
          env: process.env
        },
        (error, stdout, stderr) => {
          const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
          if (error) {
            reject(new Error([error.message, combined].filter(Boolean).join("\n\n")));
            return;
          }

          resolve(combined);
        }
      );
    });
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

function isCmdShim(filePath: string): boolean {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(filePath);
}
