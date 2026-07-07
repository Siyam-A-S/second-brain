import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Cpu,
  CreditCard,
  ExternalLink,
  HardDrive,
  KeyRound,
  RefreshCcw,
  Save,
  Settings,
  UserRound,
  X
} from "lucide-react";
import type {
  AppBuildInfo,
  AppSettings,
  DependencyRuntimeStatus,
  ProjectStorageUsage,
  ResearchDependencyReport
} from "../../shared/ipc";
import { isProductionBuild, presentError } from "../lib/errorPresentation";

type SettingsPanelProps = {
  open: boolean;
  onClose: () => void;
  onSettingsSaved?: (settings: AppSettings) => void;
};

function numberValue(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatAccountDate(value: string): string {
  if (!value) {
    return "Not synced";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not synced"
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function statusLabel(status: AppSettings["account"]["status"]): string {
  switch (status) {
    case "trialing":
      return "Trial";
    case "active":
      return "Active";
    case "past_due":
      return "Past due";
    case "canceled":
      return "Canceled";
    case "expired":
      return "Expired";
    default:
      return "Not connected";
  }
}

function statusTone(status: AppSettings["account"]["status"]): string {
  switch (status) {
    case "trialing":
    case "active":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "past_due":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "canceled":
    case "expired":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

export function SettingsPanel({ open, onClose, onSettingsSaved }: SettingsPanelProps): JSX.Element | null {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [buildInfo, setBuildInfo] = useState<AppBuildInfo | null>(null);
  const [dependencyReport, setDependencyReport] = useState<ResearchDependencyReport | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<DependencyRuntimeStatus | null>(null);
  const [projectStorageUsage, setProjectStorageUsage] = useState<ProjectStorageUsage | null>(null);
  const [status, setStatus] = useState("Loading settings...");
  const [isSaving, setIsSaving] = useState(false);
  const [isCheckingDependencies, setIsCheckingDependencies] = useState(false);
  const [isRepairingRuntime, setIsRepairingRuntime] = useState(false);
  const [isRefreshingAccount, setIsRefreshingAccount] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    let mounted = true;
    setStatus("Loading settings...");
    void window.api.app.getBuildInfo().then((info) => {
      if (mounted) {
        setBuildInfo(info);
      }
    }).catch(() => undefined);

    void window.api.settings
      .getApp()
      .then((loaded) => {
        if (!mounted) {
          return;
        }

        setSettings(loaded);
        setStatus("Settings ready.");
      })
      .catch((error) => {
        setStatus(presentError(error, "Unable to load settings.", buildInfo));
      });
    void refreshDependencyStatus();
    void refreshRuntimeStatus();
    void refreshProjectStorageUsage();

    return () => {
      mounted = false;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  async function saveSettings(): Promise<void> {
    if (!settings) {
      return;
    }

    setIsSaving(true);
    setStatus("Saving settings...");

    try {
      const saved = await window.api.settings.updateApp({
        aiMode: isProductionBuild(buildInfo) ? "proxy" : settings.aiMode,
        ai: {
          endpoint: settings.ai.endpoint,
          apiKey: settings.ai.apiKey,
          model: settings.ai.model
        },
        managedProxy: settings.managedProxy,
        account: settings.account,
        graphify: settings.graphify,
        appearance: settings.appearance
      });
      setSettings(saved);
      onSettingsSaved?.(saved);
      setStatus("Settings saved.");
    } catch (error) {
      setStatus(presentError(error, "Unable to save settings.", buildInfo));
    } finally {
      setIsSaving(false);
    }
  }

  const aiMode = settings?.aiMode ?? "proxy";
  const productionBuild = isProductionBuild(buildInfo);
  const isProxyMode = productionBuild || aiMode === "proxy";
  const account = settings?.account;
  const usagePercent =
    account?.usage && account.usage.limit > 0
      ? Math.min(100, Math.round((account.usage.used / account.usage.limit) * 100))
      : null;

  async function openAccountUrl(url: string | undefined): Promise<void> {
    const target = url || "https://www.downloadsecondbrain.com";
    try {
      await window.api.window.openExternal(target);
    } catch (error) {
      window.open(target, "_blank", "noopener,noreferrer");
      setStatus(presentError(error, "Opening account portal in browser.", buildInfo));
    }
  }

  async function refreshDependencyStatus(): Promise<void> {
    setIsCheckingDependencies(true);
    try {
      setDependencyReport(await window.api.research.getDependencyStatus());
    } catch (error) {
      const message = presentError(error, "Unable to inspect research dependencies.", buildInfo);
      setDependencyReport({
        available: false,
        checkedAt: new Date().toISOString(),
        runtime: "",
        dependencies: [],
        guidance: [message]
      });
    } finally {
      setIsCheckingDependencies(false);
    }
  }

  async function refreshRuntimeStatus(): Promise<void> {
    try {
      setRuntimeStatus(await window.api.runtime.getDependencyStatus());
    } catch (error) {
      const message = presentError(error, "Unable to inspect runtime dependencies.", buildInfo);
      setRuntimeStatus({
        available: false,
        checkedAt: new Date().toISOString(),
        dependencies: [],
        guidance: [message],
        repairCommand: 'uv tool install --upgrade "graphifyy[all]"'
      });
    }
  }

  async function refreshProjectStorageUsage(): Promise<void> {
    try {
      setProjectStorageUsage(await window.api.projects.getStorageUsage());
    } catch (error) {
      setProjectStorageUsage({
        bytes: 0,
        label: "Unavailable",
        projectsPath: "",
        checkedAt: new Date().toISOString()
      });
      setStatus(presentError(error, "Unable to inspect project storage.", buildInfo));
    }
  }

  async function repairRuntime(): Promise<void> {
    setIsRepairingRuntime(true);
    setStatus("Repairing Graphify runtime...");

    try {
      setRuntimeStatus(await window.api.runtime.installOrRepairDependencies());
      setStatus("Runtime check complete.");
    } catch (error) {
      setStatus(presentError(error, "Unable to repair runtime dependencies.", buildInfo));
    } finally {
      setIsRepairingRuntime(false);
    }
  }

  async function refreshAccount(): Promise<void> {
    setIsRefreshingAccount(true);
    setStatus("Refreshing account...");
    try {
      const refreshed = await window.api.settings.refreshAccount();
      setSettings(refreshed);
      onSettingsSaved?.(refreshed);
      setStatus("Account refreshed.");
    } catch (error) {
      setStatus(presentError(error, "Unable to refresh account.", buildInfo));
    } finally {
      setIsRefreshingAccount(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-slate-950/20 p-4 backdrop-blur-sm">
      <section className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-floral shadow-2xl">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200/80 px-5">
          <div className="flex items-center gap-3">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-slate-950 text-white">
              <Settings size={16} />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Settings</h2>
              <p className="text-xs text-slate-500">{status}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white/70 px-3 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:opacity-50"
              disabled={!settings || isSaving}
              type="button"
              onClick={() => void saveSettings()}
            >
              <Save size={15} />
              {isSaving ? "Saving" : "Save"}
            </button>
            <button
              className="grid h-9 w-9 place-items-center rounded-md text-slate-500 transition hover:bg-white/70 hover:text-slate-950"
              type="button"
              onClick={onClose}
            >
              <X size={17} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="rounded-lg border border-slate-200 bg-white/55 p-4 lg:col-span-2">
              <div className="mb-4 flex items-center gap-2">
                <Settings size={17} className="text-slate-500" />
                <h3 className="text-sm font-semibold text-slate-950">Appearance</h3>
              </div>
              <label className="flex items-center justify-between gap-4 rounded-md border border-slate-200 bg-white/65 px-3 py-2 text-sm font-semibold text-slate-700">
                Flip top bar horizontally
                <input
                  checked={settings?.appearance.topBarMirrored ?? false}
                  className="h-4 w-4 accent-slate-950"
                  type="checkbox"
                  onChange={(event) =>
                    setSettings((current) =>
                      current
                        ? {
                            ...current,
                            appearance: { ...current.appearance, topBarMirrored: event.target.checked }
                          }
                        : current
                    )
                  }
                />
              </label>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white/55 p-4 lg:col-span-2">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <HardDrive size={17} className="text-slate-500" />
                  <h3 className="text-sm font-semibold text-slate-950">Project Storage</h3>
                </div>
                <button
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-white/70 px-3 text-xs font-semibold text-slate-600 transition hover:bg-white hover:text-slate-950"
                  type="button"
                  onClick={() => void refreshProjectStorageUsage()}
                >
                  <RefreshCcw size={13} />
                  Refresh
                </button>
              </div>
              <div className="rounded-md border border-slate-200 bg-white/65 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Projects folder</p>
                <p className="mt-2 text-lg font-semibold text-slate-950">{projectStorageUsage?.label ?? "Checking..."}</p>
                <p className="mt-1 truncate text-xs text-slate-500">{projectStorageUsage?.projectsPath || "Local project data"}</p>
                <p className="mt-1 text-xs text-slate-400">
                  Checked{" "}
                  {projectStorageUsage?.checkedAt
                    ? new Date(projectStorageUsage.checkedAt).toLocaleString()
                    : "now"}
                </p>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white/55 p-4 lg:col-span-2">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <UserRound size={17} className="text-slate-500" />
                  <h3 className="text-sm font-semibold text-slate-950">Second Brain Account</h3>
                </div>
                <span
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(
                    account?.status ?? "unknown"
                  )}`}
                >
                  {statusLabel(account?.status ?? "unknown")}
                </span>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-md border border-slate-200 bg-white/65 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Access</p>
                  <p className="mt-2 text-sm font-semibold text-slate-950">{account?.planName || "Second Brain"}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Trial ends {formatAccountDate(account?.trialEndsAt ?? "")}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Renews {formatAccountDate(account?.subscriptionRenewsAt ?? "")}
                  </p>
                </div>
                <div className="rounded-md border border-slate-200 bg-white/65 p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                    {account?.usage?.label ?? "Usage"}
                  </p>
                  {account?.usage ? (
                    <>
                      <p className="mt-2 text-sm font-semibold text-slate-950">
                        {account.usage.used.toLocaleString()} / {account.usage.limit.toLocaleString()}
                      </p>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-slate-950" style={{ width: `${usagePercent ?? 0}%` }} />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">Resets {formatAccountDate(account.usage.resetAt ?? "")}</p>
                    </>
                  ) : (
                    <p className="mt-2 text-sm text-slate-500">Usage sync will appear here when the account API is available.</p>
                  )}
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="block text-xs font-semibold text-slate-500">
                  Account email
                  <input
                    className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white/80 px-3 text-sm text-slate-800 outline-none transition focus:border-slate-400"
                    placeholder="you@downloadsecondbrain.com"
                    type="email"
                    value={account?.email ?? ""}
                    onChange={(event) =>
                      setSettings((current) =>
                        current
                          ? {
                              ...current,
                              account: { ...current.account, email: event.target.value }
                            }
                          : current
                      )
                    }
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-500">
                  Access key
                  <input
                    className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white/80 px-3 text-sm text-slate-800 outline-none transition focus:border-slate-400"
                    type="password"
                    value={account?.secretKey ?? ""}
                    onChange={(event) =>
                      setSettings((current) =>
                        current
                          ? {
                              ...current,
                              account: { ...current.account, secretKey: event.target.value },
                              managedProxy: { ...current.managedProxy, secretKey: event.target.value, enabled: true }
                            }
                          : current
                      )
                    }
                  />
                </label>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white/70 px-3 text-sm font-semibold text-slate-700 transition hover:bg-white"
                  type="button"
                  onClick={() => void openAccountUrl(account?.accountUrl)}
                >
                  <ExternalLink size={15} />
                  Sign in on web
                </button>
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white/70 px-3 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:opacity-50"
                  disabled={isRefreshingAccount}
                  type="button"
                  onClick={() => void refreshAccount()}
                >
                  <RefreshCcw className={isRefreshingAccount ? "animate-spin" : ""} size={15} />
                  Refresh account
                </button>
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-slate-950 px-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                  type="button"
                  onClick={() => void openAccountUrl(account?.checkoutUrl)}
                >
                  <CreditCard size={15} />
                  Manage trial
                </button>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white/55 p-4 lg:col-span-2">
              <div className="mb-4 flex items-center gap-2">
                <Cloud size={17} className="text-slate-500" />
                <h3 className="text-sm font-semibold text-slate-950">{productionBuild ? "Managed Access" : "AI Access"}</h3>
              </div>
              {!productionBuild ? (
                <div className="grid grid-cols-2 gap-2 rounded-md border border-slate-200 bg-white/65 p-1">
                  <button
                    className={`h-9 rounded text-sm font-semibold transition ${
                      isProxyMode ? "bg-slate-950 text-white shadow-sm" : "text-slate-600 hover:bg-white hover:text-slate-950"
                    }`}
                    type="button"
                    onClick={() =>
                      setSettings((current) =>
                        current ? { ...current, aiMode: "proxy", managedProxy: { ...current.managedProxy, enabled: true } } : current
                      )
                    }
                  >
                    Account Cloud
                  </button>
                  <button
                    className={`h-9 rounded text-sm font-semibold transition ${
                      !isProxyMode ? "bg-slate-950 text-white shadow-sm" : "text-slate-600 hover:bg-white hover:text-slate-950"
                    }`}
                    type="button"
                    onClick={() =>
                      setSettings((current) =>
                        current ? { ...current, aiMode: "local", managedProxy: { ...current.managedProxy, enabled: false } } : current
                      )
                    }
                  >
                    Local Runtime
                  </button>
                </div>
              ) : null}

              {isProxyMode ? (
                <div className="mt-4 rounded-md border border-slate-200 bg-white/65 p-3 text-sm leading-6 text-slate-600">
                  <div className="flex items-start gap-2">
                    <KeyRound className="mt-0.5 text-slate-500" size={16} />
                    <p>
                      Cloud AI is authenticated with the account access key above. Model and endpoint details are managed by
                      Second Brain for production users.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
                  Local runtime uses the saved developer defaults and installed Graphify runtime on this device. Endpoint,
                  model, and API key fields are intentionally hidden from the production interface.
                </div>
              )}
            </section>

            {!productionBuild && !isProxyMode ? (
              <section className="rounded-lg border border-slate-200 bg-white/55 p-4 lg:col-span-2">
                <div className="mb-4 flex items-center gap-2">
                  <Cpu size={17} className="text-slate-500" />
                  <h3 className="text-sm font-semibold text-slate-950">Local Graphify Controls</h3>
                </div>
                <label className="block text-xs font-semibold text-slate-500">
                  Graphify executable
                  <input
                    className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white/80 px-3 text-sm text-slate-800 outline-none transition focus:border-slate-400"
                    placeholder="Auto-detect"
                    type="text"
                    value={settings?.graphify.graphifyBin ?? ""}
                    onChange={(event) =>
                      setSettings((current) =>
                        current
                          ? { ...current, graphify: { ...current.graphify, graphifyBin: event.target.value } }
                          : current
                      )
                    }
                  />
                </label>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="block text-xs font-semibold text-slate-500">
                    Max tokens
                    <input
                      className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white/80 px-3 text-sm text-slate-800 outline-none transition focus:border-slate-400"
                      min={512}
                      step={512}
                      type="number"
                      value={settings?.graphify.maxTokens ?? 32768}
                      onChange={(event) =>
                        setSettings((current) =>
                          current
                            ? {
                                ...current,
                                graphify: {
                                  ...current.graphify,
                                  maxTokens: numberValue(event.target.value, current.graphify.maxTokens)
                                }
                              }
                            : current
                        )
                      }
                    />
                  </label>
                  <label className="block text-xs font-semibold text-slate-500">
                    Retry tokens
                    <input
                      className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white/80 px-3 text-sm text-slate-800 outline-none transition focus:border-slate-400"
                      min={512}
                      step={512}
                      type="number"
                      value={settings?.graphify.retryMaxTokens ?? 16384}
                      onChange={(event) =>
                        setSettings((current) =>
                          current
                            ? {
                                ...current,
                                graphify: {
                                  ...current.graphify,
                                  retryMaxTokens: numberValue(event.target.value, current.graphify.retryMaxTokens)
                                }
                              }
                            : current
                        )
                      }
                    />
                  </label>
                  <label className="block text-xs font-semibold text-slate-500">
                    Timeout ms
                    <input
                      className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white/80 px-3 text-sm text-slate-800 outline-none transition focus:border-slate-400"
                      min={10000}
                      step={10000}
                      type="number"
                      value={settings?.graphify.timeoutMs ?? 600000}
                      onChange={(event) =>
                        setSettings((current) =>
                          current
                            ? {
                                ...current,
                                graphify: {
                                  ...current.graphify,
                                  timeoutMs: numberValue(event.target.value, current.graphify.timeoutMs)
                                }
                              }
                            : current
                        )
                      }
                    />
                  </label>
                  <label className="block text-xs font-semibold text-slate-500">
                    Cards per pass
                    <input
                      className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white/80 px-3 text-sm text-slate-800 outline-none transition focus:border-slate-400"
                      min={1}
                      step={1}
                      type="number"
                      value={settings?.graphify.cardDefinitionMaxPerPass ?? 24}
                      onChange={(event) =>
                        setSettings((current) =>
                          current
                            ? {
                                ...current,
                                graphify: {
                                  ...current.graphify,
                                  cardDefinitionMaxPerPass: numberValue(
                                    event.target.value,
                                    current.graphify.cardDefinitionMaxPerPass
                                  )
                                }
                              }
                            : current
                        )
                      }
                    />
                  </label>
                </div>
                <label className="mt-4 flex items-center justify-between gap-4 rounded-md border border-slate-200 bg-white/65 px-3 py-2 text-sm font-semibold text-slate-700">
                  Card definitions
                  <input
                    checked={settings?.graphify.cardDefinitions ?? true}
                    className="h-4 w-4 accent-slate-950"
                    type="checkbox"
                    onChange={(event) =>
                      setSettings((current) =>
                        current
                          ? {
                              ...current,
                              graphify: { ...current.graphify, cardDefinitions: event.target.checked }
                            }
                          : current
                      )
                    }
                  />
                </label>
              </section>
            ) : null}

            {!productionBuild ? (
            <section className="rounded-lg border border-slate-200 bg-white/55 p-4 lg:col-span-2">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Cpu size={17} className="text-slate-500" />
                  <h3 className="text-sm font-semibold text-slate-950">Graphify Runtime</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-white/70 px-3 text-xs font-semibold text-slate-700 transition hover:bg-white"
                    type="button"
                    onClick={() => void refreshRuntimeStatus()}
                  >
                    <RefreshCcw size={14} />
                    Check
                  </button>
                  <button
                    className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-slate-950 px-3 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                    disabled={isRepairingRuntime}
                    type="button"
                    onClick={() => void repairRuntime()}
                  >
                    <RefreshCcw className={isRepairingRuntime ? "animate-spin" : ""} size={14} />
                    Repair
                  </button>
                </div>
              </div>
              {runtimeStatus ? (
                <div className="space-y-3">
                  <div className="grid gap-2 md:grid-cols-3">
                    {runtimeStatus.dependencies.map((dependency) => (
                      <div key={dependency.name} className="rounded-md border border-slate-200 bg-white/60 p-3">
                        <div className="flex items-center gap-2">
                          {dependency.available ? (
                            <CheckCircle2 className="text-emerald-600" size={16} />
                          ) : (
                            <AlertTriangle className="text-amber-600" size={16} />
                          )}
                          <p className="text-sm font-semibold capitalize text-slate-900">{dependency.name}</p>
                        </div>
                        <p className="mt-2 break-words text-xs leading-5 text-slate-500">
                          {dependency.version || dependency.guidance}
                        </p>
                      </div>
                    ))}
                  </div>
                  {runtimeStatus.guidance.length ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950">
                      {runtimeStatus.guidance.map((line) => (
                        <p key={line}>{line}</p>
                      ))}
                      <p className="mt-2 font-mono">{runtimeStatus.repairCommand}</p>
                    </div>
                  ) : null}
                  {runtimeStatus.lastRepairOutput ? (
                    <pre className="max-h-36 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-100">
                      {runtimeStatus.lastRepairOutput}
                    </pre>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-slate-500">Runtime status has not been checked yet.</p>
              )}
            </section>
            ) : null}

            {!productionBuild ? (
            <section className="rounded-lg border border-slate-200 bg-white/55 p-4 lg:col-span-2">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Cpu size={17} className="text-slate-500" />
                  <h3 className="text-sm font-semibold text-slate-950">Research PDF Runtime</h3>
                </div>
                <button
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-white/70 px-3 text-xs font-semibold text-slate-700 transition hover:bg-white disabled:opacity-50"
                  disabled={isCheckingDependencies}
                  type="button"
                  onClick={() => void refreshDependencyStatus()}
                >
                  <RefreshCcw className={isCheckingDependencies ? "animate-spin" : ""} size={14} />
                  Check
                </button>
              </div>
              {dependencyReport ? (
                <div className="space-y-3">
                  <p className="break-words text-xs leading-5 text-slate-500">
                    Runtime: {dependencyReport.runtime || "Unavailable"}
                  </p>
                  <div className="grid gap-2 md:grid-cols-2">
                    {dependencyReport.dependencies.map((dependency) => (
                      <div
                        key={dependency.importName}
                        className="flex items-start gap-3 rounded-md border border-slate-200 bg-white/60 p-3"
                      >
                        {dependency.installed ? (
                          <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={16} />
                        ) : (
                          <AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={16} />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900">
                            {dependency.name}
                            {dependency.version ? <span className="font-normal text-slate-500"> · {dependency.version}</span> : null}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-slate-500">{dependency.purpose}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  {dependencyReport.guidance.length > 0 ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950">
                      {dependencyReport.guidance.map((line) => (
                        <p key={line}>{line}</p>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-slate-500">Research dependency status has not been checked yet.</p>
              )}
            </section>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
