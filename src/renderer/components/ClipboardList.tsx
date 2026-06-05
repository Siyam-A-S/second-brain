import { useMemo } from "react";
import { motion } from "framer-motion";
import { Code2, FileText, FolderOpen } from "lucide-react";
import { ClipboardItem, useClipboardStore } from "../stores/useClipboardStore";

const icons: Record<ClipboardItem["kind"], typeof Code2> = {
  code: Code2,
  path: FolderOpen,
  text: FileText
};

export function ClipboardList(): JSX.Element {
  const rawItems = useClipboardStore((state) => state.items);
  const recordUse = useClipboardStore((state) => state.recordUse);
  const items = useMemo(
    () =>
      [...rawItems].sort((a, b) => {
        if (a.frequency !== b.frequency) {
          return a.frequency - b.frequency;
        }

        return b.lastUsedAt - a.lastUsedAt;
      }),
    [rawItems]
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink">Floating clipboard items</h2>
          <p className="text-xs text-stone-500">LFU order, with recency as the tie-breaker</p>
        </div>
        <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-medium text-stone-600 shadow-sm">
          {items.length}
        </span>
      </div>

      <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
        {items.map((item, index) => {
          const Icon = icons[item.kind];

          return (
            <motion.button
              key={item.id}
              animate={{ opacity: 1, y: 0 }}
              className="w-full rounded-lg bg-gradient-to-br from-white via-white to-amber-50 p-4 text-left shadow-float transition hover:-translate-y-0.5 hover:shadow-lg"
              initial={{ opacity: 0, y: 8 }}
              transition={{ delay: index * 0.035, type: "spring", stiffness: 280, damping: 24 }}
              type="button"
              onClick={() => recordUse(item.id)}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-stone-900 text-white">
                    <Icon size={15} />
                  </span>
                  <span className="truncate text-sm font-semibold text-ink">{item.title}</span>
                </div>
                <span className="shrink-0 rounded-full bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-700">
                  {item.frequency}
                </span>
              </div>
              <p className="line-clamp-2 break-words font-mono text-xs leading-5 text-stone-600">
                {item.value}
              </p>
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}
