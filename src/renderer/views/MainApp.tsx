import { useEffect, useState } from "react";
import type { AppSettings, ProcessDroppedItemsResult } from "../../shared/ipc";
import type { ThemeMode } from "../components/TitleBar";
import { TitleBar } from "../components/TitleBar";
import { Sidebar } from "../components/Sidebar";
import { DropTarget } from "../components/DropTarget";
import { TrackerTable } from "../components/TrackerTable";
import { GraphBoardRenderer } from "../components/GraphBoardRenderer";
import { SettingsPanel } from "../components/SettingsPanel";
import { ExplorerWorkbench } from "../components/ExplorerWorkbench";
import { ChatWorkbench } from "../components/ChatWorkbench";

type ActiveView = "graph" | "chat" | "explorer" | "tracker";

const themeStorageKey = "second-brain.themeMode";
const accentHueStorageKey = "second-brain.accentHue";
const activeViewStorageKey = "second-brain.activeView";
const leftPanelCollapsedStorageKey = "second-brain.leftPanelCollapsed";
const topBarMirroredStorageKey = "second-brain.topBarMirrored";
const defaultAccentHue = 110;
const themeVariableNames = [
  "--color-frame",
  "--color-panel",
  "--color-keycap",
  "--color-legend",
  "--color-highlight",
  "--color-led-status",
  "--color-text-main"
];

function initialThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "classic";
  }

  const stored = window.localStorage.getItem(themeStorageKey);
  if (stored === "classic" || stored === "keypiphy") {
    return stored;
  }

  return document.documentElement.dataset.theme === "keypiphy" || document.documentElement.dataset.theme === "mint"
    ? "keypiphy"
    : "classic";
}

function initialAccentHue(): number {
  if (typeof window === "undefined") {
    return defaultAccentHue;
  }

  const stored = Number(window.localStorage.getItem(accentHueStorageKey));
  return Number.isFinite(stored) && stored >= 0 && stored <= 360 ? stored : defaultAccentHue;
}

function initialActiveView(): ActiveView {
  if (typeof window === "undefined") {
    return "graph";
  }

  const stored = window.localStorage.getItem(activeViewStorageKey);
  return stored === "graph" || stored === "chat" || stored === "explorer" || stored === "tracker" ? stored : "graph";
}

function initialStoredBoolean(storageKey: string, fallback = false): boolean {
  if (typeof window === "undefined") {
    return fallback;
  }

  const stored = window.localStorage.getItem(storageKey);
  return stored === null ? fallback : stored === "true";
}

function wrapHue(hue: number): number {
  return ((hue % 360) + 360) % 360;
}

function keypiphyPaletteFromHue(hue: number): Record<string, string> {
  const panelHue = wrapHue(hue);
  const accentHue = wrapHue(hue + 70);
  const textHue = wrapHue(hue + 170);

  return {
    "--color-frame": `hsl(${panelHue} 48% 92%)`,
    "--color-panel": `hsl(${panelHue} 54% 94%)`,
    "--color-keycap": `hsl(${panelHue} 36% 83%)`,
    "--color-legend": `hsl(${textHue} 26% 18%)`,
    "--color-highlight": `hsl(${accentHue} 100% 20%)`,
    "--color-led-status": `hsl(${accentHue} 100% 25%)`,
    "--color-text-main": `hsl(${textHue} 18% 18%)`
  };
}

export function MainApp(): JSX.Element {
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeView, setActiveView] = useState<ActiveView>(initialActiveView);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(() => initialStoredBoolean(leftPanelCollapsedStorageKey));
  const [themeMode, setThemeMode] = useState<ThemeMode>(initialThemeMode);
  const [accentHue, setAccentHue] = useState(initialAccentHue);
  const [topBarMirrored, setTopBarMirrored] = useState(() => initialStoredBoolean(topBarMirroredStorageKey));

  useEffect(() => {
    const handleError = (event: ErrorEvent): void => {
      void window.api.app.reportRendererError({
        scope: "renderer:error",
        error: event.message,
        detail: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          stack: event.error instanceof Error ? event.error.stack : undefined
        }
      });
    };
    const handleRejection = (event: PromiseRejectionEvent): void => {
      void window.api.app.reportRendererError({
        scope: "renderer:unhandledRejection",
        error: event.reason instanceof Error ? event.reason.message : String(event.reason),
        detail: event.reason instanceof Error ? { stack: event.reason.stack } : undefined
      });
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (themeMode === "keypiphy") {
      root.dataset.theme = "keypiphy";
      for (const [name, value] of Object.entries(keypiphyPaletteFromHue(accentHue))) {
        root.style.setProperty(name, value);
      }
    } else {
      root.dataset.theme = "classic";
      for (const name of themeVariableNames) {
        root.style.removeProperty(name);
      }
    }

    window.localStorage.setItem(themeStorageKey, themeMode);
    window.localStorage.setItem(accentHueStorageKey, String(accentHue));
  }, [accentHue, themeMode]);

  useEffect(() => {
    window.localStorage.setItem(activeViewStorageKey, activeView);
  }, [activeView]);

  useEffect(() => {
    window.localStorage.setItem(leftPanelCollapsedStorageKey, String(leftPanelCollapsed));
  }, [leftPanelCollapsed]);

  useEffect(() => {
    window.localStorage.setItem(topBarMirroredStorageKey, String(topBarMirrored));
  }, [topBarMirrored]);

  useEffect(() => {
    let mounted = true;
    void window.api.settings
      .getApp()
      .then((settings) => {
        if (mounted) {
          setTopBarMirrored(settings.appearance.topBarMirrored);
        }
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void window.api.runtime
      .getDependencyStatus()
      .then((status) => {
        if (mounted && !status.available) {
          setSettingsOpen(true);
        }
      })
      .catch(() => {
        if (mounted) {
          setSettingsOpen(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  function handleDropProcessed(result: ProcessDroppedItemsResult): void {
    setRefreshKey((key) => key + 1);
    if (result.graphify) {
      setActiveView("graph");
    }
  }

  function handleProjectChanged(): void {
    setRefreshKey((key) => key + 1);
  }

  function handleSettingsSaved(settings: AppSettings): void {
    setTopBarMirrored(settings.appearance.topBarMirrored);
  }

  return (
    <div className="keyboard-frame flex h-full flex-col bg-frame text-textMain">
      <TitleBar
        accentHue={accentHue}
        mirrored={topBarMirrored}
        themeMode={themeMode}
        onAccentHueChange={setAccentHue}
        onOpenSettings={() => setSettingsOpen(true)}
        onThemeModeChange={setThemeMode}
      />
      <div className="flex min-h-0 flex-1 p-3 min-[760px]:hidden">
        <DropTarget onProcessed={handleDropProcessed} />
      </div>
      <div className="hidden min-h-0 flex-1 min-[760px]:flex">
        <Sidebar
          collapsed={leftPanelCollapsed}
          refreshKey={refreshKey}
          onDropProcessed={handleDropProcessed}
          onProjectChanged={handleProjectChanged}
          onToggleCollapsed={() => setLeftPanelCollapsed((value) => !value)}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="material-frosted flex h-12 shrink-0 items-center gap-2 border-b border-black/10 bg-panel px-6">
            <button
              className={`rounded-xl px-3 py-1.5 font-mono text-sm font-semibold transition active:translate-y-[2px] active:shadow-inner ${
                activeView === "graph" ? "bg-keycap text-highlight shadow-keycap" : "bg-keycap text-legend shadow-keycap hover:text-highlight"
              }`}
              type="button"
              onClick={() => setActiveView("graph")}
            >
              Board
            </button>
            <button
              className={`rounded-xl px-3 py-1.5 font-mono text-sm font-semibold transition active:translate-y-[2px] active:shadow-inner ${
                activeView === "chat" ? "bg-keycap text-highlight shadow-keycap" : "bg-keycap text-legend shadow-keycap hover:text-highlight"
              }`}
              type="button"
              onClick={() => setActiveView("chat")}
            >
              Chat
            </button>
            <button
              className={`rounded-xl px-3 py-1.5 font-mono text-sm font-semibold transition active:translate-y-[2px] active:shadow-inner ${
                activeView === "explorer" ? "bg-keycap text-highlight shadow-keycap" : "bg-keycap text-legend shadow-keycap hover:text-highlight"
              }`}
              type="button"
              onClick={() => setActiveView("explorer")}
            >
              Explorer
            </button>
            <button
              className={`rounded-xl px-3 py-1.5 font-mono text-sm font-semibold transition active:translate-y-[2px] active:shadow-inner ${
                activeView === "tracker" ? "bg-keycap text-highlight shadow-keycap" : "bg-keycap text-legend shadow-keycap hover:text-highlight"
              }`}
              type="button"
              onClick={() => setActiveView("tracker")}
            >
              Tracker
            </button>
          </div>
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <section className={activeView === "graph" ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden min-h-0 min-w-0 flex-1 flex-col"}>
              <GraphBoardRenderer refreshKey={refreshKey} />
            </section>
            <section className={activeView === "chat" ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden min-h-0 min-w-0 flex-1 flex-col"}>
              <ChatWorkbench refreshKey={refreshKey} />
            </section>
            <section
              className={activeView === "explorer" ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden min-h-0 min-w-0 flex-1 flex-col"}
            >
              <ExplorerWorkbench refreshKey={refreshKey} />
            </section>
            <section className={activeView === "tracker" ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden min-h-0 min-w-0 flex-1 flex-col"}>
              <TrackerTable refreshKey={refreshKey} />
            </section>
          </div>
        </div>
      </div>
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} onSettingsSaved={handleSettingsSaved} />
    </div>
  );
}
