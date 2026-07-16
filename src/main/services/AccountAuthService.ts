import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeStorage } from "electron";
import type {
  AccountAuthState,
  AccountSignInInput,
  AppBuildInfo,
  AccountAccessStatus
} from "../../shared/brain";
import { normalizeAccountUsageSnapshot } from "../../shared/accountUsage";

type StoredSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email: string;
  userId: string;
};

type SupabaseAuthResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: {
    id?: string;
    email?: string;
  };
  error?: string;
  error_description?: string;
  msg?: string;
};

const defaultPlanName = "Second Brain";
const refreshSkewMs = 60_000;

function normalizeStatus(value: unknown): AccountAccessStatus {
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export class AccountAuthService {
  private readonly sessionPath: string;
  private cachedAccount: AccountAuthState | null = null;

  constructor(
    private readonly userDataPath: string,
    private readonly buildInfo: AppBuildInfo
  ) {
    this.sessionPath = path.join(userDataPath, "settings", "account-session.bin");
  }

  async getState(): Promise<AccountAuthState> {
    const session = await this.readSession();
    if (!session) {
      return this.signedOutState();
    }

    if (this.cachedAccount?.signedIn && this.cachedAccount.userId === session.userId) {
      return this.cachedAccount;
    }

    return {
      ...this.signedOutState(),
      signedIn: true,
      email: session.email,
      userId: session.userId
    };
  }

  async signIn(input: AccountSignInInput): Promise<AccountAuthState> {
    const email = input.email.trim();
    const password = input.password;
    if (!email || !password) {
      throw new Error("Email and password are required.");
    }

    const parsed = await this.supabaseRequest<SupabaseAuthResponse>("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    const session = this.sessionFromSupabase(parsed, email);
    await this.writeSession(session);
    return this.refresh();
  }

  async signOut(): Promise<AccountAuthState> {
    const session = await this.readSession();
    if (session?.accessToken) {
      await fetch(`${this.supabaseUrl()}/auth/v1/logout`, {
        method: "POST",
        headers: this.supabaseHeaders(session.accessToken)
      }).catch(() => undefined);
    }

    await rm(this.sessionPath, { force: true });
    this.cachedAccount = null;
    return this.signedOutState();
  }

  async refresh(): Promise<AccountAuthState> {
    const token = await this.getAccessToken();
    if (!token) {
      return this.signedOutState();
    }

    const response = await fetch(`${this.websiteUrl()}/api/desktop/account`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        await rm(this.sessionPath, { force: true });
        this.cachedAccount = null;
        return this.signedOutState();
      }
      throw new Error(`Account refresh failed with ${response.status}.`);
    }

    const session = await this.readSession();
    const parsed = asRecord(await response.json());
    const next: AccountAuthState = {
      signedIn: true,
      email: stringValue(parsed.email) || session?.email || "",
      userId: stringValue(parsed.userId) || stringValue(parsed.user_id) || session?.userId || "",
      status: normalizeStatus(parsed.status),
      planName: stringValue(parsed.planName) || stringValue(parsed.plan_name) || defaultPlanName,
      trialEndsAt: stringValue(parsed.trialEndsAt) || stringValue(parsed.trial_end),
      subscriptionRenewsAt: stringValue(parsed.subscriptionRenewsAt) || stringValue(parsed.subscription_renews_at),
      usage: normalizeAccountUsageSnapshot(parsed.usage),
      websiteUrl: this.websiteUrl(),
      accountUrl: `${this.websiteUrl()}/login`,
      checkoutUrl: `${this.websiteUrl()}/checkout`,
      lastVerifiedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.cachedAccount = next;
    return next;
  }

  async getAccessToken(): Promise<string | null> {
    const session = await this.readSession();
    if (!session) {
      return null;
    }

    if (session.expiresAt > Date.now() + refreshSkewMs) {
      return session.accessToken;
    }

    try {
      const parsed = await this.supabaseRequest<SupabaseAuthResponse>("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        body: JSON.stringify({ refresh_token: session.refreshToken })
      });
      const next = this.sessionFromSupabase(parsed, session.email, session.userId);
      await this.writeSession(next);
      return next.accessToken;
    } catch {
      await rm(this.sessionPath, { force: true });
      this.cachedAccount = null;
      return null;
    }
  }

  private signedOutState(): AccountAuthState {
    const configurationError =
      !this.supabaseUrl() || !this.supabaseAnonKey()
        ? "Production authentication is not configured for this build."
        : undefined;
    return {
      signedIn: false,
      email: "",
      userId: "",
      status: "unknown",
      planName: defaultPlanName,
      trialEndsAt: "",
      subscriptionRenewsAt: "",
      usage: null,
      websiteUrl: this.websiteUrl(),
      accountUrl: `${this.websiteUrl()}/login`,
      checkoutUrl: `${this.websiteUrl()}/checkout`,
      lastVerifiedAt: "",
      updatedAt: new Date().toISOString(),
      configurationError
    };
  }

  private sessionFromSupabase(parsed: SupabaseAuthResponse, fallbackEmail: string, fallbackUserId = ""): StoredSession {
    if (!parsed.access_token || !parsed.refresh_token) {
      throw new Error(parsed.error_description || parsed.error || parsed.msg || "Supabase sign-in did not return a session.");
    }

    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token,
      expiresAt: Date.now() + Math.max(1, parsed.expires_in ?? 3600) * 1000,
      email: parsed.user?.email || fallbackEmail,
      userId: parsed.user?.id || fallbackUserId
    };
  }

  private async supabaseRequest<T>(pathName: string, init: RequestInit): Promise<T> {
    if (!this.supabaseUrl() || !this.supabaseAnonKey()) {
      throw new Error("Production authentication is not configured for this build.");
    }

    const response = await fetch(`${this.supabaseUrl()}${pathName}`, {
      ...init,
      headers: {
        ...this.supabaseHeaders(),
        "Content-Type": "application/json",
        ...(init.headers ?? {})
      }
    });
    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as T) : ({} as T);
    if (!response.ok) {
      const error = asRecord(parsed);
      throw new Error(stringValue(error.error_description) || stringValue(error.error) || `Supabase auth failed with ${response.status}.`);
    }

    return parsed;
  }

  private supabaseHeaders(accessToken = this.supabaseAnonKey()): Record<string, string> {
    return {
      apikey: this.supabaseAnonKey(),
      Authorization: `Bearer ${accessToken}`
    };
  }

  private async readSession(): Promise<StoredSession | null> {
    try {
      const raw = await readFile(this.sessionPath);
      const decrypted = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(raw)
        : raw.toString("utf8");
      return JSON.parse(decrypted) as StoredSession;
    } catch {
      return null;
    }
  }

  private async writeSession(session: StoredSession): Promise<void> {
    if (this.buildInfo.channel === "production" && !safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure account storage is not available on this device.");
    }

    await mkdir(path.dirname(this.sessionPath), { recursive: true });
    const payload = JSON.stringify(session);
    const encoded = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(payload)
      : Buffer.from(payload, "utf8");
    await writeFile(this.sessionPath, encoded);
  }

  private websiteUrl(): string {
    return this.buildInfo.websiteUrl.replace(/\/+$/, "");
  }

  private supabaseUrl(): string {
    return this.buildInfo.supabaseUrl.replace(/\/+$/, "");
  }

  private supabaseAnonKey(): string {
    return this.buildInfo.supabaseAnonKey.trim();
  }
}
