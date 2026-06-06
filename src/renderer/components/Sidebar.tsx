import { ClipboardList } from "./ClipboardList";
import { DropTarget } from "./DropTarget";
import type { ProcessDroppedItemsResult } from "../../shared/ipc";

type SidebarProps = {
  onDropProcessed: (result: ProcessDroppedItemsResult) => void;
};

export function Sidebar({ onDropProcessed }: SidebarProps): JSX.Element {
  return (
    <aside className="flex min-w-80 basis-[30%] flex-col gap-5 border-r border-black/5 bg-white/25 p-5">
      <div className="min-h-0 flex-1">
        <DropTarget onProcessed={onDropProcessed} />
      </div>
      <ClipboardList />
    </aside>
  );
}
