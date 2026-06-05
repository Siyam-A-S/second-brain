import { ClipboardList } from "./ClipboardList";
import { DropTarget } from "./DropTarget";

export function Sidebar(): JSX.Element {
  return (
    <aside className="flex min-w-80 basis-[30%] flex-col gap-5 border-r border-black/5 bg-white/25 p-5">
      <div className="min-h-0 flex-1">
        <DropTarget />
      </div>
      <ClipboardList />
    </aside>
  );
}
