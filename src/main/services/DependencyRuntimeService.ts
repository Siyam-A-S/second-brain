import { execFile } from "node:child_process";
import type { ExecFileOptions } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { DependencyRuntimeStatus, RuntimeDependencyCheck } from "../../shared/brain";

const graphifyToolPackage = "graphifyy[all]";
const timeoutMs = 180_000;
const maxBuffer = 2 * 1024 * 1024;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function repairCommandText(): string {
  return process.platform === "win32"
    ? [
        "winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements",
        'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"',
        `uv tool install --upgrade "${graphifyToolPackage}"`,
        "uv tool ensurepath"
      ].join("\n")
    : [`uv tool install --upgrade "${graphifyToolPackage}"`, "uv tool ensurepath"].join("\n");
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
    const [python, uv, graphify] = await Promise.all([this.checkPython(), this.checkUv(), this.checkGraphify()]);
    const dependencies = [python, uv, graphify];
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

    if (!pythonAvailable && process.platform === "win32") {
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

    if (!uvAvailable && process.platform === "win32") {
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
    const candidates =
      process.platform === "win32"
        ? [
            { command: "py", args: ["-3.10", "--version"] },
            { command: "python", args: ["--version"] }
          ]
        : [
            { command: "python3", args: ["--version"] },
            { command: "python", args: ["--version"] }
          ];

    for (const candidate of candidates) {
      try {
        const output = await this.run(candidate.command, candidate.args);
        const parsed = parsePythonVersion(output);
        if (parsed.ok) {
          return {
            name: "python",
            available: true,
            version: parsed.version,
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
      guidance: "Install Python 3.10 or newer and enable Add Python to PATH."
    };
  }

  private async checkUv(): Promise<RuntimeDependencyCheck> {
    try {
      const output = await this.run("uv", ["--version"]);
      return {
        name: "uv",
        available: true,
        version: output.trim().split(/\r?\n/)[0] ?? "uv",
        required: true,
        guidance: ""
      };
    } catch {
      return {
        name: "uv",
        available: false,
        version: "",
        required: true,
        guidance: "Install uv with the Astral installer, then restart Second Brain."
      };
    }
  }

  private async checkGraphify(): Promise<RuntimeDependencyCheck> {
    const direct = process.env.SECOND_BRAIN_GRAPHIFY_BIN?.trim();
    const uvTool = await this.findUvToolGraphifyCommand();
    const candidates = [
      direct ? { command: direct, args: ["--help"], shell: isCmdShim(direct) } : null,
      uvTool ? { command: uvTool, args: ["--help"], shell: isCmdShim(uvTool) } : null,
      { command: "graphify", args: ["--help"] }
    ].filter((value): value is { command: string; args: string[]; shell?: boolean } => Boolean(value));

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

  private async findUvToolGraphifyCommand(): Promise<string | null> {
    try {
      const uvToolDir = (await this.run("uv", ["tool", "dir"])).trim().split(/\r?\n/)[0] ?? "";
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
