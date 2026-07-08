import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AccountAccessStatus,
  AccountSettings,
  AccountUsageSnapshot,
  AiMode,
  AiSettings,
  AppearanceSettings,
  AppSettings,
  BuildChannel,
  GraphifyRuntimeSettings,
  ManagedProxySettings,
  UpdateAiSettingsInput,
  UpdateAppSettingsInput,
  UpdateManagedProxySettingsInput
} from "../../shared/brain";

const defaultEndpoint = "http://localhost:8080/v1/chat/completions";
const defaultModel = "local-model";
const placeholderApiKey = "local-dev-placeholder";
const productionProxyOrigin = "https://graphify-proxy-724616525781.us-central1.run.app";
const productionProxyChatEndpoint = `${productionProxyOrigin}/chat`;
const productionWebsiteUrl = "https://www.downloadsecondbrain.com";
const productionAccountUrl = `${productionWebsiteUrl}/login`;
const productionCheckoutUrl = `${productionWebsiteUrl}/checkout`;
const productionAccountApiUrl = `${productionWebsiteUrl}/api/desktop/account`;
const defaultManagedProxyModel = "google/gemini-3.5-flash";
const legacyDefaultGraphifyMaxTokens = 8192;
const legacyDefaultGraphifyRetryMaxTokens = 4096;
const defaultGraphifySettings: GraphifyRuntimeSettings = {
  graphifyBin: "",
  maxTokens: 32768,
  retryMaxTokens: 16384,
  timeoutMs: 600_000,
  cardDefinitions: true,
  cardDefinitionMaxPerPass: 24,
  paperComponents: true
};
const defaultAppearanceSettings: AppearanceSettings = {
  topBarMirrored: false
};
const defaultAccountSettings: AccountSettings = {
  email: "",
  secretKey: "",
  status: "unknown",
  planName: "Second Brain",
  trialEndsAt: "",
  subscriptionRenewsAt: "",
  usage: null,
  websiteUrl: productionWebsiteUrl,
  accountUrl: productionAccountUrl,
  checkoutUrl: productionCheckoutUrl,
  lastVerifiedAt: "",
  updatedAt: new Date().toISOString()
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

function normalizeManagedProxyModel(value: string | undefined): string {
  const trimmed = value?.trim();
  return !trimmed || trimmed === "gemini-3.1-flash" ? defaultManagedProxyModel : trimmed;
}

function normalizeProxyApiKey(value: string | undefined): string {
  return process.env.OPENAI_API_KEY?.trim() || value?.trim() || placeholderApiKey;
}

function normalizeProxyModel(value: string | undefined): string {
  return process.env.OPENAI_MODEL?.trim() || normalizeManagedProxyModel(value);
}

function normalizeAiMode(value: unknown, fallback: AiMode = "proxy"): AiMode {
  return value === "local" || value === "proxy" ? value : fallback;
}

function normalizeAccountAccessStatus(value: unknown): AccountAccessStatus {
  switch (value) {
    case "trialing":
    case "active":
    case "past_due":
    case "canceled":
    case "expired":
      return value;
    default:
      return "unknown";
  }
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

function normalizeAccountUsage(value: unknown): AccountUsageSnapshot | null {
  const parsed = asRecord(value);
  const used = numberSetting(parsed.used, NaN, 0);
  const limit = numberSetting(parsed.limit, NaN, 0);

  if (!Number.isFinite(used) || !Number.isFinite(limit)) {
    return null;
  }

  return {
    label: typeof parsed.label === "string" && parsed.label.trim() ? parsed.label.trim() : "AI usage",
    used,
    limit,
    resetAt: typeof parsed.resetAt === "string" ? parsed.resetAt : undefined,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined
  };
}

function normalizeAccountSettings(value: unknown, fallbackSecretKey = ""): AccountSettings {
  const parsed = asRecord(value);

  return {
    email: typeof parsed.email === "string" ? parsed.email.trim() : defaultAccountSettings.email,
    secretKey: typeof parsed.secretKey === "string" ? parsed.secretKey.trim() : fallbackSecretKey.trim(),
    status: normalizeAccountAccessStatus(parsed.status),
    planName: typeof parsed.planName === "string" && parsed.planName.trim() ? parsed.planName.trim() : defaultAccountSettings.planName,
    trialEndsAt: typeof parsed.trialEndsAt === "string" ? parsed.trialEndsAt : "",
    subscriptionRenewsAt: typeof parsed.subscriptionRenewsAt === "string" ? parsed.subscriptionRenewsAt : "",
    usage: normalizeAccountUsage(parsed.usage),
    websiteUrl: productionWebsiteUrl,
    accountUrl: productionAccountUrl,
    checkoutUrl: productionCheckoutUrl,
    lastVerifiedAt: typeof parsed.lastVerifiedAt === "string" ? parsed.lastVerifiedAt : "",
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString()
  };
}

function normalizeManagedProxySettings(value: unknown): ManagedProxySettings {
  const parsed = asRecord(value);

  return {
    enabled: true,
    endpoint: productionProxyChatEndpoint,
    secretKey: typeof parsed.secretKey === "string" ? parsed.secretKey.trim() : "",
    model: normalizeManagedProxyModel(typeof parsed.model === "string" ? parsed.model : undefined),
    groundingEnabled: booleanSetting(parsed.groundingEnabled, true),
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString()
  };
}

function migrateLegacyGraphifyDefault(value: number, legacyDefault: number, nextDefault: number, shouldMigrate: boolean): number {
  return shouldMigrate && value === legacyDefault ? nextDefault : value;
}

function normalizeGraphifySettings(value: unknown, useEnvironment = true, migrateLegacyDefaults = useEnvironment): GraphifyRuntimeSettings {
  const parsed = asRecord(value);
  const environmentMaxTokens = useEnvironment
    ? process.env.SECOND_BRAIN_GRAPHIFY_MAX_TOKENS ?? process.env.GRAPHIFY_MAX_OUTPUT_TOKENS
    : undefined;
  const environmentRetryMaxTokens = useEnvironment ? process.env.SECOND_BRAIN_GRAPHIFY_RETRY_MAX_TOKENS : undefined;
  const shouldMigrateStoredMaxTokens = migrateLegacyDefaults && !environmentMaxTokens;
  const shouldMigrateStoredRetryMaxTokens = migrateLegacyDefaults && !environmentRetryMaxTokens;
  const maxTokens = numberSetting(environmentMaxTokens ?? parsed.maxTokens, defaultGraphifySettings.maxTokens);
  const retryMaxTokens = numberSetting(environmentRetryMaxTokens ?? parsed.retryMaxTokens, defaultGraphifySettings.retryMaxTokens);

  return {
    graphifyBin:
      typeof parsed.graphifyBin === "string"
        ? parsed.graphifyBin.trim()
        : useEnvironment
          ? process.env.SECOND_BRAIN_GRAPHIFY_BIN?.trim() ?? defaultGraphifySettings.graphifyBin
          : defaultGraphifySettings.graphifyBin,
    maxTokens: migrateLegacyGraphifyDefault(
      maxTokens,
      legacyDefaultGraphifyMaxTokens,
      defaultGraphifySettings.maxTokens,
      shouldMigrateStoredMaxTokens
    ),
    retryMaxTokens: migrateLegacyGraphifyDefault(
      retryMaxTokens,
      legacyDefaultGraphifyRetryMaxTokens,
      defaultGraphifySettings.retryMaxTokens,
      shouldMigrateStoredRetryMaxTokens
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
    ),
    paperComponents: booleanSetting(
      (useEnvironment ? process.env.SECOND_BRAIN_PAPER_COMPONENTS : undefined) ?? parsed.paperComponents,
      defaultGraphifySettings.paperComponents
    )
  };
}

function normalizeAppearanceSettings(value: unknown): AppearanceSettings {
  const parsed = asRecord(value);

  return {
    topBarMirrored: booleanSetting(parsed.topBarMirrored, defaultAppearanceSettings.topBarMirrored)
  };
}

export class AiSettingsService {
  private readonly settingsPath: string;

  constructor(private readonly userDataPath: string, private readonly buildChannel: BuildChannel = "development") {
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
    return this.getEffectiveSettings();
  }

  async getEffectiveSettings(): Promise<AiSettings> {
    const settings = await this.getAppSettings();
    const proxy = settings.managedProxy;

    if (settings.aiMode === "proxy") {
      return {
        mode: "proxy",
        endpoint: productionProxyChatEndpoint,
        apiKey: normalizeProxyApiKey(proxy.secretKey),
        model: normalizeProxyModel(proxy.model),
        updatedAt: proxy.updatedAt
      };
    }

    return { ...settings.ai, mode: "local" };
  }

  async getAppSettings(): Promise<AppSettings> {
    try {
      const parsed = JSON.parse(await readFile(this.settingsPath, "utf8")) as Record<string, unknown>;
      const aiRecord = asRecord(parsed.ai ?? parsed);
      const legacyProxy = normalizeManagedProxySettings(parsed.managedProxy);
      const account = normalizeAccountSettings(parsed.account, legacyProxy.secretKey);
      const proxySecretKey = account.secretKey || legacyProxy.secretKey;
      const aiMode = normalizeAiMode(parsed.aiMode, "proxy");
      const settings = {
        aiMode: this.productionMode() ? "proxy" : aiMode,
        ai: {
          mode: "local" as const,
          endpoint: normalizeEndpoint(process.env.SECOND_BRAIN_LLM_ENDPOINT ?? (aiRecord.endpoint as string | undefined)),
          apiKey: normalizeApiKey(process.env.SECOND_BRAIN_LLM_API_KEY ?? (aiRecord.apiKey as string | undefined)),
          model: normalizeModel(
            process.env.SECOND_BRAIN_LLM_MODEL ?? process.env.OPENAI_MODEL ?? (aiRecord.model as string | undefined)
          ),
          updatedAt: typeof aiRecord.updatedAt === "string" ? aiRecord.updatedAt : new Date().toISOString()
        },
        account,
        managedProxy: {
          ...legacyProxy,
          secretKey: proxySecretKey
        },
        graphify: normalizeGraphifySettings(parsed.graphify),
        appearance: normalizeAppearanceSettings(parsed.appearance),
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

  async updateManagedProxy(input: UpdateManagedProxySettingsInput): Promise<ManagedProxySettings> {
    return (await this.updateAppSettings({ managedProxy: input })).managedProxy;
  }

  async refreshAccount(): Promise<AppSettings> {
    const current = await this.getAppSettings();
    const accessKey = current.account.secretKey || current.managedProxy.secretKey;
    if (!accessKey) {
      throw new Error("Account access key is required.");
    }

    const response = await fetch(productionAccountApiUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessKey}`,
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Account refresh failed with ${response.status}.`);
    }

    const account = normalizeAccountSettings(await response.json(), accessKey);
    const next: AppSettings = {
      ...current,
      account: {
        ...current.account,
        ...account,
        email: account.email || current.account.email,
        secretKey: accessKey,
        lastVerifiedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      managedProxy: {
        ...current.managedProxy,
        secretKey: accessKey,
        enabled: true,
        updatedAt: new Date().toISOString()
      },
      aiMode: "proxy",
      updatedAt: new Date().toISOString()
    };

    await this.saveAppSettings(next);
    this.applyRuntimeSettings(next);
    return next;
  }

  async updateAppSettings(input: UpdateAppSettingsInput): Promise<AppSettings> {
    const current = await this.getAppSettings();
    const aiMode = this.productionMode() ? "proxy" : normalizeAiMode(input.aiMode, current.aiMode);
    const accountInput = input.account ?? {};
    const managedProxyInput = input.managedProxy ?? {};
    const accountSecretKey =
      typeof accountInput.secretKey === "string"
        ? accountInput.secretKey.trim()
        : typeof managedProxyInput.secretKey === "string"
          ? managedProxyInput.secretKey.trim()
          : current.account.secretKey || current.managedProxy.secretKey;
    const nextAccount = normalizeAccountSettings(
      {
        ...current.account,
        ...accountInput,
        secretKey: accountSecretKey
      },
      accountSecretKey
    );
    const next: AppSettings = {
      aiMode,
      ai: {
        mode: "local",
        endpoint: normalizeEndpoint(input.ai?.endpoint ?? current.ai.endpoint),
        apiKey: normalizeApiKey(input.ai?.apiKey ?? current.ai.apiKey),
        model: normalizeModel(input.ai?.model ?? current.ai.model),
        updatedAt: new Date().toISOString()
      },
      account: {
        ...nextAccount,
        updatedAt: new Date().toISOString()
      },
      managedProxy: {
        enabled: true,
        endpoint: productionProxyChatEndpoint,
        secretKey: accountSecretKey,
        model: normalizeManagedProxyModel(managedProxyInput.model ?? current.managedProxy.model),
        groundingEnabled: managedProxyInput.groundingEnabled ?? current.managedProxy.groundingEnabled,
        updatedAt: new Date().toISOString()
      },
      graphify: normalizeGraphifySettings({
        ...current.graphify,
        ...input.graphify
      }, false),
      appearance: normalizeAppearanceSettings({
        ...current.appearance,
        ...input.appearance
      }),
      updatedAt: new Date().toISOString()
    };

    await this.saveAppSettings(next);
    this.applyRuntimeSettings(next);
    return next;
  }

  private defaultAppSettings(): AppSettings {
    return {
      aiMode: "proxy",
      ai: {
        mode: "local",
        endpoint: normalizeEndpoint(process.env.SECOND_BRAIN_LLM_ENDPOINT),
        apiKey: normalizeApiKey(process.env.SECOND_BRAIN_LLM_API_KEY),
        model: normalizeModel(process.env.SECOND_BRAIN_LLM_MODEL ?? process.env.OPENAI_MODEL),
        updatedAt: new Date().toISOString()
      },
      managedProxy: normalizeManagedProxySettings(undefined),
      account: normalizeAccountSettings(undefined),
      graphify: normalizeGraphifySettings(undefined),
      appearance: normalizeAppearanceSettings(undefined),
      updatedAt: new Date().toISOString()
    };
  }

  private productionMode(): boolean {
    return this.buildChannel === "production";
  }

  private applyRuntimeSettings(settings: AppSettings): void {
    if (settings.graphify.graphifyBin) {
      process.env.SECOND_BRAIN_GRAPHIFY_BIN = settings.graphify.graphifyBin;
    } else {
      delete process.env.SECOND_BRAIN_GRAPHIFY_BIN;
    }

    if (settings.aiMode === "local") {
      process.env.SECOND_BRAIN_GRAPHIFY_MAX_TOKENS = String(settings.graphify.maxTokens);
      process.env.GRAPHIFY_MAX_OUTPUT_TOKENS = String(settings.graphify.maxTokens);
      process.env.SECOND_BRAIN_GRAPHIFY_RETRY_MAX_TOKENS = String(settings.graphify.retryMaxTokens);
    } else {
      delete process.env.SECOND_BRAIN_GRAPHIFY_MAX_TOKENS;
      delete process.env.GRAPHIFY_MAX_OUTPUT_TOKENS;
      delete process.env.SECOND_BRAIN_GRAPHIFY_RETRY_MAX_TOKENS;
      delete process.env.SECOND_BRAIN_GRAPHIFY_TOKEN_BUDGET;
      delete process.env.SECOND_BRAIN_GRAPHIFY_MAX_CONCURRENCY;
    }
    process.env.SECOND_BRAIN_GRAPHIFY_TIMEOUT_MS = String(settings.graphify.timeoutMs);
    process.env.SECOND_BRAIN_CARD_DEFINITIONS = settings.graphify.cardDefinitions ? "1" : "0";
    if (settings.aiMode === "local") {
      process.env.SECOND_BRAIN_CARD_DEFINITION_MAX_PER_PASS = String(settings.graphify.cardDefinitionMaxPerPass);
    } else {
      delete process.env.SECOND_BRAIN_CARD_DEFINITION_MAX_PER_PASS;
    }
    process.env.SECOND_BRAIN_PAPER_COMPONENTS = settings.graphify.paperComponents ? "1" : "0";
  }

  private async saveAppSettings(settings: AppSettings): Promise<void> {
    await mkdir(path.dirname(this.settingsPath), { recursive: true });
    await writeFile(this.settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  }
}
