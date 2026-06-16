import { Clipboard, PanelLeftClose, PanelLeftOpen, UploadCloud } from "lucide-react";
import { ClipboardList } from "./ClipboardList";
import { DropTarget } from "./DropTarget";
import type { ProcessDroppedItemsResult } from "../../shared/ipc";

type SidebarProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onDropProcessed: (result: ProcessDroppedItemsResult) => void;
  refreshKey: number;
};

export function Sidebar({ collapsed, onToggleCollapsed, onDropProcessed, refreshKey }: SidebarProps): JSX.Element {
  if (collapsed) {
    return (
      <aside className="flex w-16 shrink-0 flex-col items-center gap-3 border-r border-black/5 bg-white/25 p-3">
        <button
          className="grid h-9 w-9 place-items-center rounded-md bg-white/70 text-slate-600 shadow-sm transition hover:bg-white hover:text-slate-950"
          title="Expand left panel"
          type="button"
          onClick={onToggleCollapsed}
        >
          <PanelLeftOpen size={17} />
        </button>
        <div className="mt-2 grid h-9 w-9 place-items-center rounded-md border border-slate-200/80 bg-white/45 text-slate-500">
          <UploadCloud size={17} />
        </div>
        <div className="grid h-9 w-9 place-items-center rounded-md border border-slate-200/80 bg-white/45 text-slate-500">
          <Clipboard size={17} />
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex min-w-80 basis-[30%] flex-col gap-5 border-r border-black/5 bg-white/25 p-5">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-950">Capture</h2>
          <p className="text-xs text-slate-500">Drop or reuse local context</p>
        </div>
        <button
          className="grid h-9 w-9 place-items-center rounded-md bg-white/70 text-slate-600 shadow-sm transition hover:bg-white hover:text-slate-950"
          title="Collapse left panel"
          type="button"
          onClick={onToggleCollapsed}
        >
          <PanelLeftClose size={17} />
        </button>
      </div>
      <div className="min-h-[18rem] shrink-0">
        <DropTarget onProcessed={onDropProcessed} />
      </div>
      <ClipboardList refreshKey={refreshKey} />
    </aside>
  );
}
