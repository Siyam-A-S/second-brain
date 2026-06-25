import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Cloud, Cpu, RefreshCcw, Save, Settings, X } from "lucide-react";
import type { AppSettings, DependencyRuntimeStatus, ResearchDependencyReport } from "../../shared/ipc";

type SettingsPanelProps = {
  open: boolean;
  onClose: () => void;
};

function numberValue(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps): JSX.Element | null {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [dependencyReport, setDependencyReport] = useState<ResearchDependencyReport | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<DependencyRuntimeStatus | null>(null);
  const [status, setStatus] = useState("Loading settings...");
  const [isSaving, setIsSaving] = useState(false);
  const [isCheckingDependencies, setIsCheckingDependencies] = useState(false);
  const [isRepairingRuntime, setIsRepairingRuntime] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    let mounted = true;
    setStatus("Loading settings...");

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
        const message = error instanceof Error ? error.message : "Unable to load settings.";
        setStatus(message);
      });
    void refreshDependencyStatus();
    void refreshRuntimeStatus();

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
        aiMode: settings.aiMode,
        ai: {
          endpoint: settings.ai.endpoint,
          apiKey: settings.ai.apiKey,
          model: settings.ai.model
        },
        managedProxy: settings.managedProxy,
        graphify: settings.graphify
      });
      setSettings(saved);
      setStatus("Settings saved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save settings.";
      setStatus(message);
    } finally {
      setIsSaving(false);
    }
  }

  const aiMode = settings?.aiMode ?? "proxy";
  const isProxyMode = aiMode === "proxy";

  async function refreshDependencyStatus(): Promise<void> {
    setIsCheckingDependencies(true);
    try {
      setDependencyReport(await window.api.research.getDependencyStatus());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to inspect research dependencies.";
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
      const message = error instanceof Error ? error.message : "Unable to inspect runtime dependencies.";
      setRuntimeStatus({
        available: false,
        checkedAt: new Date().toISOString(),
        dependencies: [],
        guidance: [message],
        repairCommand: 'uv tool install --upgrade "graphifyy[all]"'
      });
    }
  }

  async function repairRuntime(): Promise<void> {
    setIsRepairingRuntime(true);
    setStatus("Repairing Graphify runtime...");

    try {
      setRuntimeStatus(await window.api.runtime.installOrRepairDependencies());
      setStatus("Runtime check complete.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to repair runtime dependencies.";
      setStatus(message);
    } finally {
      setIsRepairingRuntime(false);
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
                <Cloud size={17} className="text-slate-500" />
                <h3 className="text-sm font-semibold text-slate-950">AI Mode</h3>
              </div>
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
                  Use Proxy AI
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
                  Use Local AI
                </button>
              </div>

              {isProxyMode ? (
                <label className="mt-4 block text-xs font-semibold text-slate-500">
                  Secret key
                  <input
                    className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white/80 px-3 text-sm text-slate-800 outline-none transition focus:border-slate-400"
                    type="password"
                    value={settings?.managedProxy.secretKey ?? ""}
                    onChange={(event) =>
                      setSettings((current) =>
                        current
                          ? {
                              ...current,
                              managedProxy: { ...current.managedProxy, secretKey: event.target.value, enabled: true }
                            }
                          : current
                      )
                    }
                  />
                </label>
              ) : (
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <label className="block text-xs font-semibold text-slate-500 md:col-span-3">
                    Base URL
                    <input
                      className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white/80 px-3 text-sm text-slate-800 outline-none transition focus:border-slate-400"
                      type="url"
                      value={settings?.ai.endpoint ?? ""}
                      onChange={(event) =>
                        setSettings((current) =>
                          current ? { ...current, ai: { ...current.ai, endpoint: event.target.value } } : current
                        )
                      }
                    />
                  </label>
                  <label className="block text-xs font-semibold text-slate-500 md:col-span-2">
                    Model
                    <input
                      className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white/80 px-3 text-sm text-slate-800 outline-none transition focus:border-slate-400"
                      type="text"
                      value={settings?.ai.model ?? ""}
                      onChange={(event) =>
                        setSettings((current) =>
                          current ? { ...current, ai: { ...current.ai, model: event.target.value } } : current
                        )
                      }
                    />
                  </label>
                  <label className="block text-xs font-semibold text-slate-500">
                    API key
                    <input
                      className="mt-1 h-10 w-full rounded-md border border-slate-200 bg-white/80 px-3 text-sm text-slate-800 outline-none transition focus:border-slate-400"
                      type="password"
                      value={settings?.ai.apiKey ?? ""}
                      onChange={(event) =>
                        setSettings((current) =>
                          current ? { ...current, ai: { ...current.ai, apiKey: event.target.value } } : current
                        )
                      }
                    />
                  </label>
                </div>
              )}
            </section>

            {!isProxyMode ? (
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
                      value={settings?.graphify.maxTokens ?? 8192}
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
                      value={settings?.graphify.retryMaxTokens ?? 4096}
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
          </div>
        </div>
      </section>
    </div>
  );
}
