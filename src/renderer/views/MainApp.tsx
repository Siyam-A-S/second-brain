import { useState } from "react";
import type { ProcessDroppedItemsResult } from "../../shared/ipc";
import { TitleBar } from "../components/TitleBar";
import { Sidebar } from "../components/Sidebar";
import { JobTrackerTable } from "../components/JobTrackerTable";
import { BoardRenderer } from "../components/BoardRenderer";

type ActiveView = "jobs" | "board";

export function MainApp(): JSX.Element {
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeView, setActiveView] = useState<ActiveView>("jobs");

  function handleDropProcessed(result: ProcessDroppedItemsResult): void {
    setRefreshKey((key) => key + 1);
    if (result.job || result.jobError) {
      setActiveView("jobs");
    } else if (result.graphify) {
      setActiveView("board");
    }
  }

  return (
    <div className="flex h-full flex-col bg-floral text-ink">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar onDropProcessed={handleDropProcessed} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex h-11 shrink-0 items-center gap-1 border-b border-slate-900/5 bg-white/20 px-6">
            <button
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                activeView === "jobs" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-950"
              }`}
              type="button"
              onClick={() => setActiveView("jobs")}
            >
              Jobs
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
          {activeView === "jobs" ? (
            <JobTrackerTable refreshKey={refreshKey} />
          ) : (
            <BoardRenderer refreshKey={refreshKey} />
          )}
        </div>
      </div>
    </div>
  );
}
