import { useState } from "react";
import type { ProcessDroppedItemsResult } from "../../shared/ipc";
import { TitleBar } from "../components/TitleBar";
import { Sidebar } from "../components/Sidebar";
import { DropTarget } from "../components/DropTarget";
import { TrackerTable } from "../components/TrackerTable";
import { BoardRenderer } from "../components/BoardRenderer";
import { SettingsPanel } from "../components/SettingsPanel";

type ActiveView = "tracker" | "board";

export function MainApp(): JSX.Element {
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeView, setActiveView] = useState<ActiveView>("tracker");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);

  function handleDropProcessed(result: ProcessDroppedItemsResult): void {
    setRefreshKey((key) => key + 1);
    if (result.tracker || result.trackerError) {
      setActiveView("tracker");
    } else if (result.graphify) {
      setActiveView("board");
    }
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
          onToggleCollapsed={() => setLeftPanelCollapsed((value) => !value)}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex h-11 shrink-0 items-center gap-1 border-b border-slate-900/5 bg-white/20 px-6">
            <button
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                activeView === "tracker" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-950"
              }`}
              type="button"
              onClick={() => setActiveView("tracker")}
            >
              Tracker
            </button>
            <button
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                activeView === "board" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-950"
              }`}
              type="button"
              onClick={() => setActiveView("board")}
            >
              Board
            </button>
          </div>
          {activeView === "tracker" ? (
            <TrackerTable refreshKey={refreshKey} />
          ) : (
            <BoardRenderer refreshKey={refreshKey} />
          )}
        </div>
      </div>
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
