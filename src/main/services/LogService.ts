import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppBuildInfo, AppSettings } from "../../shared/brain";

type LogProvider = () => Promise<AppSettings>;

type LogRecord = {
  timestamp: string;
  level: "info" | "warn" | "error";
  scope: string;
  message: string;
  detail?: unknown;
  app: AppBuildInfo;
  platform: NodeJS.Platform;
};

const uploadUrl = "https://www.downloadsecondbrain.com/api/desktop/logs";
const maxDetailLength = 4000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function redactString(value: string): string {
  let text = value;
  text = text.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
  text = text.replace(/(api[_-]?key|secret[_-]?key|access[_-]?key|token|authorization)(["':=\s]+)([^"',\s]+)/gi, "$1$2[redacted]");
  text = text.replace(/[A-Za-z]:\\Users\\[^"'\n\r]+/g, "[path]");
  text = text.replace(/\/(?:Users|home)\/[^"'\n\r]+/g, "[path]");
  text = text.replace(/[A-Za-z0-9+/]{256,}={0,2}/g, "[binary]");
  return text.length > maxDetailLength ? `${text.slice(0, maxDetailLength)}... [truncated]` : text;
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return "[truncated]";
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redact(item, depth + 1));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined
    };
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      if (/content|prompt|document|buffer|base64|secret|token|apiKey|authorization/i.test(key)) {
        output[key] = "[redacted]";
      } else {
        output[key] = redact(item, depth + 1);
      }
    }
    return output;
  }

  return String(value);
}

export class LogService {
  private readonly logDir: string;
  private readonly pendingPath: string;

  constructor(
    private readonly userDataPath: string,
    private readonly buildInfo: AppBuildInfo,
    private readonly settingsProvider: LogProvider
  ) {
    this.logDir = path.join(userDataPath, "logs");
    this.pendingPath = path.join(this.logDir, "pending-uploads.jsonl");
  }

  async info(scope: string, message: string, detail?: unknown): Promise<void> {
    await this.write("info", scope, message, detail);
  }

  async warn(scope: string, message: string, detail?: unknown): Promise<void> {
    await this.write("warn", scope, message, detail);
  }

  async error(scope: string, error: unknown, detail?: unknown): Promise<void> {
    await this.write("error", scope, errorMessage(error), { error, detail });
  }

  async flushPending(): Promise<void> {
    if (this.buildInfo.channel !== "production") {
      return;
    }

    try {
      const raw = await readFile(this.pendingPath, "utf8");
      const lines = raw.split(/\r?\n/).filter(Boolean);
      if (lines.length === 0) {
        return;
      }
      const records = lines.map((line) => JSON.parse(line) as LogRecord);
      await this.upload(records);
      await rm(this.pendingPath, { force: true });
    } catch {
      // Pending uploads are intentionally best-effort.
    }
  }

  private async write(level: LogRecord["level"], scope: string, message: string, detail?: unknown): Promise<void> {
    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      scope,
      message: redactString(message),
      detail: redact(detail),
      app: this.buildInfo,
      platform: process.platform
    };

    await mkdir(this.logDir, { recursive: true });
    const logPath = path.join(this.logDir, `second-brain-${new Date().toISOString().slice(0, 10)}.jsonl`);
    await appendFile(logPath, `${JSON.stringify(record)}\n`, "utf8");

    if (this.buildInfo.channel === "production" && level !== "info") {
      try {
        await this.upload([record]);
      } catch {
        await appendFile(this.pendingPath, `${JSON.stringify(record)}\n`, "utf8");
      }
    }
  }

  private async upload(records: LogRecord[]): Promise<void> {
    const settings = await this.settingsProvider();
    const accessKey = settings.account.secretKey || settings.managedProxy.secretKey;
    if (!accessKey) {
      throw new Error("No account access key available for log upload.");
    }

    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        host: os.hostname(),
        records
      })
    });

    if (!response.ok) {
      throw new Error(`Log upload failed with ${response.status}`);
    }
  }
}
