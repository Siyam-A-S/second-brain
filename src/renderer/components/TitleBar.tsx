import { Maximize2, Minus, X } from "lucide-react";

export function TitleBar(): JSX.Element {
  return (
    <header className="drag-region flex h-11 shrink-0 items-center justify-between border-b border-black/5 bg-floral/90 px-3 backdrop-blur">
      <div className="flex items-center gap-3">
        <div className="h-3 w-3 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-500 shadow-sm" />
        <span className="text-sm font-semibold tracking-normal text-ink">Second Brain</span>
      </div>

      <div className="no-drag flex items-center gap-1">
        <button
          aria-label="Minimize to floating drop-zone"
          className="grid h-8 w-8 place-items-center rounded-md text-stone-600 transition hover:bg-black/5 hover:text-ink"
          type="button"
          onClick={() => void window.api.window.minimize()}
        >
          <Minus size={16} />
        </button>
        <button
          aria-label="Maximize window"
          className="grid h-8 w-8 place-items-center rounded-md text-stone-600 transition hover:bg-black/5 hover:text-ink"
          type="button"
          onClick={() => void window.api.window.maximize()}
        >
          <Maximize2 size={15} />
        </button>
        <button
          aria-label="Close application"
          className="grid h-8 w-8 place-items-center rounded-md text-stone-600 transition hover:bg-red-500 hover:text-white"
          type="button"
          onClick={() => void window.api.window.close()}
        >
          <X size={16} />
        </button>
      </div>
    </header>
  );
}
