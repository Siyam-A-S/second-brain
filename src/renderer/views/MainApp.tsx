import { useState } from "react";
import type { ProcessDroppedItemsResult } from "../../shared/ipc";
import { TitleBar } from "../components/TitleBar";
import { Sidebar } from "../components/Sidebar";
import { DropTarget } from "../components/DropTarget";
import { TrackerTable } from "../components/TrackerTable";
import { GraphBoardRenderer } from "../components/GraphBoardRenderer";
import { SettingsPanel } from "../components/SettingsPanel";
import { ExplorerWorkbench } from "../components/ExplorerWorkbench";

type ActiveView = "graph" | "explorer" | "tracker";

export function MainApp(): JSX.Element {
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeView, setActiveView] = useState<ActiveView>("graph");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);

  function handleDropProcessed(result: ProcessDroppedItemsResult): void {
    setRefreshKey((key) => key + 1);
    if (result.graphify) {
      setActiveView("graph");
    }
  }

  function handleProjectChanged(): void {
    setRefreshKey((key) => key + 1);
    setActiveView("graph");
  }

  return (
    <div className="flex h-full flex-col bg-floral text-ink">
      <TitleBar onOpenSettings={() => setSettingsOpen(true)} />
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
          <div className="flex h-11 shrink-0 items-center gap-1 border-b border-slate-900/5 bg-white/20 px-6">
            <button
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                activeView === "graph" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-950"
              }`}
              type="button"
              onClick={() => setActiveView("graph")}
            >
              Graph Board
            </button>
            <button
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                activeView === "explorer" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-950"
              }`}
              type="button"
              onClick={() => setActiveView("explorer")}
            >
              Explorer
            </button>
            <button
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                activeView === "tracker" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-950"
              }`}
              type="button"
              onClick={() => setActiveView("tracker")}
            >
              Tracker
            </button>
          </div>
          {activeView === "graph" ? (
            <GraphBoardRenderer refreshKey={refreshKey} />
          ) : activeView === "explorer" ? (
            <ExplorerWorkbench refreshKey={refreshKey} />
          ) : (
            <TrackerTable refreshKey={refreshKey} />
          )}
        </div>
      </div>
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
