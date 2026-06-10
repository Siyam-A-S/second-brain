import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AiSettings, UpdateAiSettingsInput } from "../../shared/brain";

const defaultEndpoint = "http://localhost:8080/v1/chat/completions";
const defaultModel = "local-model";
const placeholderApiKey = "local-dev-placeholder";

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

export class AiSettingsService {
  private readonly settingsPath: string;

  constructor(private readonly userDataPath: string) {
    this.settingsPath = path.join(userDataPath, "settings", "ai.json");
  }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.settingsPath), { recursive: true });

    try {
      await readFile(this.settingsPath, "utf8");
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        await this.save(this.defaultSettings());
        return;
      }

      throw error;
    }
  }

  async getSettings(): Promise<AiSettings> {
    await this.initialize();

    try {
      const parsed = JSON.parse(await readFile(this.settingsPath, "utf8")) as Partial<AiSettings>;
      return {
        endpoint: normalizeEndpoint(process.env.SECOND_BRAIN_LLM_ENDPOINT ?? parsed.endpoint),
        apiKey: normalizeApiKey(process.env.SECOND_BRAIN_LLM_API_KEY ?? parsed.apiKey),
        model: normalizeModel(process.env.SECOND_BRAIN_LLM_MODEL ?? process.env.OPENAI_MODEL ?? parsed.model),
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString()
      };
    } catch {
      const settings = this.defaultSettings();
      await this.save(settings);
      return settings;
    }
  }

  async updateSettings(input: UpdateAiSettingsInput): Promise<AiSettings> {
    const current = await this.getSettings();
    const next: AiSettings = {
      endpoint: normalizeEndpoint(input.endpoint ?? current.endpoint),
      apiKey: normalizeApiKey(input.apiKey ?? current.apiKey),
      model: normalizeModel(input.model ?? current.model),
      updatedAt: new Date().toISOString()
    };

    await this.save(next);
    return next;
  }

  private defaultSettings(): AiSettings {
    return {
      endpoint: normalizeEndpoint(process.env.SECOND_BRAIN_LLM_ENDPOINT),
      apiKey: normalizeApiKey(process.env.SECOND_BRAIN_LLM_API_KEY),
      model: normalizeModel(process.env.SECOND_BRAIN_LLM_MODEL ?? process.env.OPENAI_MODEL),
      updatedAt: new Date().toISOString()
    };
  }

  private async save(settings: AiSettings): Promise<void> {
    await mkdir(path.dirname(this.settingsPath), { recursive: true });
    await writeFile(this.settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  }
}
