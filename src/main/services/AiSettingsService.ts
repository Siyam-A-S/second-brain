import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AiSettings,
  AppSettings,
  GraphifyRuntimeSettings,
  UpdateAiSettingsInput,
  UpdateAppSettingsInput
} from "../../shared/brain";

const defaultEndpoint = "http://localhost:8080/v1/chat/completions";
const defaultModel = "local-model";
const placeholderApiKey = "local-dev-placeholder";
const defaultGraphifySettings: GraphifyRuntimeSettings = {
  graphifyBin: "",
  maxTokens: 8192,
  retryMaxTokens: 4096,
  timeoutMs: 600_000,
  cardDefinitions: true,
  cardDefinitionMaxPerPass: 24
};

function normalizeEndpoint(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed || defaultEndpoint;
}

function normalizeApiKey(value: string | undefined): string {
  return value?.trim() || placeholderApiKey;
}

function normalizeModel(value: string | undefined): string {
  return value?.trim() || defaultModel;
}

function numberSetting(value: unknown, fallback: number, minimum = 1): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.max(minimum, Math.trunc(parsed)) : fallback;
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (/^(1|true|yes|on)$/i.test(value)) {
      return true;
    }

    if (/^(0|false|no|off)$/i.test(value)) {
      return false;
    }
  }

  return fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeGraphifySettings(value: unknown, useEnvironment = true): GraphifyRuntimeSettings {
  const parsed = asRecord(value);

  return {
    graphifyBin:
      typeof parsed.graphifyBin === "string"
        ? parsed.graphifyBin.trim()
        : useEnvironment
          ? process.env.SECOND_BRAIN_GRAPHIFY_BIN?.trim() ?? defaultGraphifySettings.graphifyBin
          : defaultGraphifySettings.graphifyBin,
    maxTokens: numberSetting(
      (useEnvironment ? process.env.SECOND_BRAIN_GRAPHIFY_MAX_TOKENS ?? process.env.GRAPHIFY_MAX_OUTPUT_TOKENS : undefined) ??
        parsed.maxTokens,
      defaultGraphifySettings.maxTokens
    ),
    retryMaxTokens: numberSetting(
      (useEnvironment ? process.env.SECOND_BRAIN_GRAPHIFY_RETRY_MAX_TOKENS : undefined) ?? parsed.retryMaxTokens,
      defaultGraphifySettings.retryMaxTokens
    ),
    timeoutMs: numberSetting(
      (useEnvironment ? process.env.SECOND_BRAIN_GRAPHIFY_TIMEOUT_MS : undefined) ?? parsed.timeoutMs,
      defaultGraphifySettings.timeoutMs,
      10_000
    ),
    cardDefinitions: booleanSetting(
      (useEnvironment ? process.env.SECOND_BRAIN_CARD_DEFINITIONS : undefined) ?? parsed.cardDefinitions,
      defaultGraphifySettings.cardDefinitions
    ),
    cardDefinitionMaxPerPass: numberSetting(
      (useEnvironment ? process.env.SECOND_BRAIN_CARD_DEFINITION_MAX_PER_PASS : undefined) ??
        parsed.cardDefinitionMaxPerPass,
      defaultGraphifySettings.cardDefinitionMaxPerPass
    )
  };
}

export class AiSettingsService {
  private readonly settingsPath: string;

  constructor(private readonly userDataPath: string) {
    this.settingsPath = path.join(userDataPath, "settings", "ai.json");
  }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.settingsPath), { recursive: true });

    try {
      const settings = await this.getAppSettings();
      this.applyRuntimeSettings(settings);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        const settings = this.defaultAppSettings();
        await this.saveAppSettings(settings);
        this.applyRuntimeSettings(settings);
        return;
      }

      throw error;
    }
  }

  async getSettings(): Promise<AiSettings> {
    return (await this.getAppSettings()).ai;
  }

  async getAppSettings(): Promise<AppSettings> {
    try {
      const parsed = JSON.parse(await readFile(this.settingsPath, "utf8")) as Record<string, unknown>;
      const aiRecord = asRecord(parsed.ai ?? parsed);
      const settings = {
        ai: {
          endpoint: normalizeEndpoint(process.env.SECOND_BRAIN_LLM_ENDPOINT ?? (aiRecord.endpoint as string | undefined)),
          apiKey: normalizeApiKey(process.env.SECOND_BRAIN_LLM_API_KEY ?? (aiRecord.apiKey as string | undefined)),
          model: normalizeModel(
            process.env.SECOND_BRAIN_LLM_MODEL ?? process.env.OPENAI_MODEL ?? (aiRecord.model as string | undefined)
          ),
          updatedAt: typeof aiRecord.updatedAt === "string" ? aiRecord.updatedAt : new Date().toISOString()
        },
        graphify: normalizeGraphifySettings(parsed.graphify),
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString()
      };

      this.applyRuntimeSettings(settings);
      return settings;
    } catch {
      const settings = this.defaultAppSettings();
      await this.saveAppSettings(settings);
      this.applyRuntimeSettings(settings);
      return settings;
    }
  }

  async updateSettings(input: UpdateAiSettingsInput): Promise<AiSettings> {
    return (await this.updateAppSettings({ ai: input })).ai;
  }

  async updateAppSettings(input: UpdateAppSettingsInput): Promise<AppSettings> {
    const current = await this.getAppSettings();
    const next: AppSettings = {
      ai: {
        endpoint: normalizeEndpoint(input.ai?.endpoint ?? current.ai.endpoint),
        apiKey: normalizeApiKey(input.ai?.apiKey ?? current.ai.apiKey),
        model: normalizeModel(input.ai?.model ?? current.ai.model),
        updatedAt: new Date().toISOString()
      },
      graphify: normalizeGraphifySettings({
        ...current.graphify,
        ...input.graphify
      }, false),
      updatedAt: new Date().toISOString()
    };

    await this.saveAppSettings(next);
    this.applyRuntimeSettings(next);
    return next;
  }

  private defaultAppSettings(): AppSettings {
    return {
      ai: {
        endpoint: normalizeEndpoint(process.env.SECOND_BRAIN_LLM_ENDPOINT),
        apiKey: normalizeApiKey(process.env.SECOND_BRAIN_LLM_API_KEY),
        model: normalizeModel(process.env.SECOND_BRAIN_LLM_MODEL ?? process.env.OPENAI_MODEL),
        updatedAt: new Date().toISOString()
      },
      graphify: normalizeGraphifySettings(undefined),
      updatedAt: new Date().toISOString()
    };
  }

  private applyRuntimeSettings(settings: AppSettings): void {
    if (settings.graphify.graphifyBin) {
      process.env.SECOND_BRAIN_GRAPHIFY_BIN = settings.graphify.graphifyBin;
    } else {
      delete process.env.SECOND_BRAIN_GRAPHIFY_BIN;
    }

    process.env.SECOND_BRAIN_GRAPHIFY_MAX_TOKENS = String(settings.graphify.maxTokens);
    process.env.GRAPHIFY_MAX_OUTPUT_TOKENS = String(settings.graphify.maxTokens);
    process.env.SECOND_BRAIN_GRAPHIFY_RETRY_MAX_TOKENS = String(settings.graphify.retryMaxTokens);
    process.env.SECOND_BRAIN_GRAPHIFY_TIMEOUT_MS = String(settings.graphify.timeoutMs);
    process.env.SECOND_BRAIN_CARD_DEFINITIONS = settings.graphify.cardDefinitions ? "1" : "0";
    process.env.SECOND_BRAIN_CARD_DEFINITION_MAX_PER_PASS = String(settings.graphify.cardDefinitionMaxPerPass);
  }

  private async saveAppSettings(settings: AppSettings): Promise<void> {
    await mkdir(path.dirname(this.settingsPath), { recursive: true });
    await writeFile(this.settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  }
}
