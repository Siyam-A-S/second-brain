import { useEffect, useState } from "react";
import { Cpu, KeyRound, Save, Settings, X } from "lucide-react";
import type { AppSettings } from "../../shared/ipc";

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
  const [status, setStatus] = useState("Loading settings...");
  const [isSaving, setIsSaving] = useState(false);

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
        ai: {
          endpoint: settings.ai.endpoint,
          apiKey: settings.ai.apiKey,
          model: settings.ai.model
        },
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
            <section className="rounded-lg border border-slate-200 bg-white/55 p-4">
              <div className="mb-4 flex items-center gap-2">
                <KeyRound size={17} className="text-slate-500" />
                <h3 className="text-sm font-semibold text-slate-950">AI Endpoint</h3>
              </div>
              <label className="block text-xs font-semibold text-slate-500">
                Endpoint
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
              <label className="mt-3 block text-xs font-semibold text-slate-500">
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
              <label className="mt-3 block text-xs font-semibold text-slate-500">
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
            </section>

            <section className="rounded-lg border border-slate-200 bg-white/55 p-4">
              <div className="mb-4 flex items-center gap-2">
                <Cpu size={17} className="text-slate-500" />
                <h3 className="text-sm font-semibold text-slate-950">Graphify</h3>
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
          </div>
        </div>
      </section>
    </div>
  );
}
