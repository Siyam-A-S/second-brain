import { FolderKanban, PanelLeftClose, PanelLeftOpen, UploadCloud } from "lucide-react";
import { DropTarget } from "./DropTarget";
import { ProjectList } from "./ProjectList";
import type { ProcessDroppedItemsResult } from "../../shared/ipc";

type SidebarProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onDropProcessed: (result: ProcessDroppedItemsResult) => void;
  onProjectChanged: () => void;
  refreshKey: number;
};

export function Sidebar({
  collapsed,
  onToggleCollapsed,
  onDropProcessed,
  onProjectChanged,
  refreshKey
}: SidebarProps): JSX.Element {
  if (collapsed) {
    return (
      <aside className="material-frosted flex w-16 shrink-0 flex-col items-center gap-3 border-r border-black/10 bg-panel p-3">
        <button
          className="grid h-9 w-9 place-items-center rounded-xl bg-keycap text-legend shadow-keycap transition hover:text-highlight active:translate-y-[2px] active:shadow-inner"
          title="Expand left panel"
          type="button"
          onClick={onToggleCollapsed}
        >
          <PanelLeftOpen size={17} />
        </button>
        <div className="mt-2 grid h-9 w-9 place-items-center rounded-xl border border-black/10 bg-keycap text-legend shadow-keycap">
          <UploadCloud size={17} />
        </div>
        <div className="grid h-9 w-9 place-items-center rounded-xl border border-black/10 bg-keycap text-legend shadow-keycap">
          <FolderKanban size={17} />
        </div>
      </aside>
    );
  }

  return (
    <aside className="material-frosted flex min-w-80 basis-[30%] flex-col gap-5 border-r border-black/10 bg-panel p-5">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div>
          <h2 className="font-mono text-sm font-semibold text-legend">Capture</h2>
          <p className="text-xs text-textMain">Drop into the active project</p>
        </div>
        <button
          className="grid h-9 w-9 place-items-center rounded-xl bg-keycap text-legend shadow-keycap transition hover:text-highlight active:translate-y-[2px] active:shadow-inner"
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
      <ProjectList refreshKey={refreshKey} onProjectChanged={onProjectChanged} />
    </aside>
  );
}
