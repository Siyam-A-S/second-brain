import { useEffect, useState } from "react";
import { ClipboardList } from "./ClipboardList";
import { DropTarget } from "./DropTarget";
import type { AiSettings, ProcessDroppedItemsResult } from "../../shared/ipc";

type SidebarProps = {
  onDropProcessed: (result: ProcessDroppedItemsResult) => void;
};

function AiSettingsPanel(): JSX.Element {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [status, setStatus] = useState("Loading AI settings...");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let mounted = true;

    void window.api.settings
      .getAi()
      .then((loaded) => {
        if (!mounted) {
          return;
        }

        setSettings(loaded);
        setStatus("AI settings ready.");
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Unable to load AI settings.";
        setStatus(message);
      });

    return () => {
      mounted = false;
    };
  }, []);

  async function saveSettings(): Promise<void> {
    if (!settings) {
      return;
    }

    setIsSaving(true);
    setStatus("Saving AI settings...");

    try {
      const saved = await window.api.settings.updateAi({
        endpoint: settings.endpoint,
        apiKey: settings.apiKey,
        model: settings.model
      });
      setSettings(saved);
      setStatus("AI settings saved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save AI settings.";
      setStatus(message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="shrink-0 rounded-lg border border-slate-200 bg-white/55 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-950">AI</h2>
        <button
          className="h-8 rounded-md border border-slate-200 bg-white/70 px-3 text-xs font-semibold text-slate-700 transition hover:bg-white disabled:opacity-50"
          disabled={!settings || isSaving}
          type="button"
          onClick={() => void saveSettings()}
        >
          {isSaving ? "Saving" : "Save"}
        </button>
      </div>
      <label className="mt-3 block text-xs font-semibold text-slate-500">
        Endpoint
        <input
          className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white/75 px-2 text-xs text-slate-800 outline-none transition focus:border-slate-400"
          type="url"
          value={settings?.endpoint ?? ""}
          onChange={(event) =>
            setSettings((current) => (current ? { ...current, endpoint: event.target.value } : current))
          }
        />
      </label>
      <label className="mt-3 block text-xs font-semibold text-slate-500">
        Model
        <input
          className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white/75 px-2 text-xs text-slate-800 outline-none transition focus:border-slate-400"
          type="text"
          value={settings?.model ?? ""}
          onChange={(event) =>
            setSettings((current) => (current ? { ...current, model: event.target.value } : current))
          }
        />
      </label>
      <label className="mt-3 block text-xs font-semibold text-slate-500">
        API key
        <input
          className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white/75 px-2 text-xs text-slate-800 outline-none transition focus:border-slate-400"
          type="password"
          value={settings?.apiKey ?? ""}
          onChange={(event) =>
            setSettings((current) => (current ? { ...current, apiKey: event.target.value } : current))
          }
        />
      </label>
      <p className="mt-3 truncate text-xs text-slate-500">{status}</p>
    </section>
  );
}

export function Sidebar({ onDropProcessed }: SidebarProps): JSX.Element {
  return (
    <aside className="flex min-w-80 basis-[30%] flex-col gap-5 border-r border-black/5 bg-white/25 p-5">
      <AiSettingsPanel />
      <div className="min-h-0 flex-1">
        <DropTarget onProcessed={onDropProcessed} />
      </div>
      <ClipboardList />
    </aside>
  );
}
