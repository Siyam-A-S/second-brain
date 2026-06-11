import { useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { FileText, FolderOpen, Terminal } from "lucide-react";
import type { SmartClip } from "../../shared/ipc";
import { useClipboardStore } from "../stores/useClipboardStore";

const icons: Record<SmartClip["kind"], typeof Terminal> = {
  bash: Terminal,
  path: FolderOpen,
  text: FileText
};

type ClipboardListProps = {
  refreshKey: number;
};

export function ClipboardList({ refreshKey }: ClipboardListProps): JSX.Element {
  const rawItems = useClipboardStore((state) => state.items);
  const isLoading = useClipboardStore((state) => state.isLoading);
  const error = useClipboardStore((state) => state.error);
  const load = useClipboardStore((state) => state.load);
  const copy = useClipboardStore((state) => state.copy);
  const items = useMemo(
    () =>
      [...rawItems].sort((a, b) => {
        if (a.frequency !== b.frequency) {
          return b.frequency - a.frequency;
        }

        return Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt);
      }),
    [rawItems]
  );

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    const refresh = (): void => {
      void load();
    };

    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink">Smart Clips</h2>
          <p className="text-xs text-stone-500">Commands, paths, and reusable text</p>
        </div>
        <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-medium text-stone-600 shadow-sm">
          {isLoading ? "..." : items.length}
        </span>
      </div>

      {error ? <p className="mb-3 rounded-md bg-rose-50 p-2 text-xs text-rose-700">{error}</p> : null}

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
              onClick={() => void copy(item.id)}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-stone-900 text-white">
                    <Icon size={15} />
                  </span>
                  <span className="truncate text-sm font-semibold text-ink">{item.title}</span>
                </div>
                <span className="shrink-0 rounded-full bg-teal-50 px-2 py-1 text-xs font-semibold capitalize text-teal-700">
                  {item.kind === "bash" ? "bash" : item.kind}
                </span>
              </div>
              <p className="line-clamp-2 break-words font-mono text-xs leading-5 text-stone-600">
                {item.value}
              </p>
            </motion.button>
          );
        })}
        {!isLoading && items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-stone-300 bg-white/45 p-4 text-xs leading-5 text-stone-500">
            Drop text, commands, or files to collect reusable clips.
          </div>
        ) : null}
      </div>
    </section>
  );
}
