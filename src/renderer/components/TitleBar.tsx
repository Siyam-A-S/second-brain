import { Maximize2, Minus, Settings, X } from "lucide-react";

export type ThemeMode = "classic" | "keypiphy";

type TitleBarProps = {
  accentHue: number;
  onOpenSettings: () => void;
  onAccentHueChange: (hue: number) => void;
  onThemeModeChange: (mode: ThemeMode) => void;
  themeMode: ThemeMode;
};

export function TitleBar({
  accentHue,
  onOpenSettings,
  onAccentHueChange,
  onThemeModeChange,
  themeMode
}: TitleBarProps): JSX.Element {
  return (
    <header className="drag-region material-frosted flex h-11 shrink-0 items-center justify-between border-b border-black/10 bg-frame px-3">
      <div className="flex items-center gap-3">
        <div className="h-3 w-3 rounded-full bg-led shadow-[0_0_8px_var(--color-led-status),inset_0_1px_1px_rgba(255,255,255,0.7)]" />
        <span className="font-mono text-sm font-semibold tracking-normal text-led">Second Brain</span>
      </div>

      <div className="no-drag flex items-center gap-2">
        <div className="hidden items-center rounded-xl bg-keycap p-1 shadow-keycap min-[760px]:flex">
          <button
            className={`rounded-lg px-2 py-1 font-mono text-[11px] font-semibold transition active:translate-y-[1px] ${
              themeMode === "classic" ? "bg-white/70 text-highlight shadow-inner" : "text-legend hover:text-highlight"
            }`}
            type="button"
            onClick={() => onThemeModeChange("classic")}
          >
            Classic
          </button>
          <button
            className={`rounded-lg px-2 py-1 font-mono text-[11px] font-semibold transition active:translate-y-[1px] ${
              themeMode === "keypiphy" ? "bg-white/70 text-highlight shadow-inner" : "text-legend hover:text-highlight"
            }`}
            type="button"
            onClick={() => onThemeModeChange("keypiphy")}
          >
            Keypiphy
          </button>
          <label
            className={`ml-1 flex items-center overflow-hidden rounded-lg bg-white/35 shadow-inner transition-[max-width,opacity,padding,transform] duration-200 ease-out ${
              themeMode === "keypiphy"
                ? "max-w-32 translate-y-0 px-2 py-1 opacity-100"
                : "pointer-events-none max-w-0 translate-y-2 px-0 py-1 opacity-0"
            }`}
          >
            <input
              aria-label="Keypiphy color"
              className="h-2 w-24 shrink-0 cursor-pointer accent-[var(--color-highlight)]"
              max={360}
              min={0}
              type="range"
              value={accentHue}
              onChange={(event) => onAccentHueChange(Number(event.target.value))}
            />
          </label>
        </div>
        <button
          aria-label="Open settings"
          className="grid h-8 w-8 place-items-center rounded-xl bg-keycap text-legend shadow-keycap transition hover:text-highlight active:translate-y-[2px] active:shadow-inner"
          type="button"
          onClick={onOpenSettings}
        >
          <Settings size={15} />
        </button>
        <button
          aria-label="Minimize to floating drop-zone"
          className="grid h-8 w-8 place-items-center rounded-xl bg-keycap text-legend shadow-keycap transition hover:text-highlight active:translate-y-[2px] active:shadow-inner"
          type="button"
          onClick={() => void window.api.window.minimize()}
        >
          <Minus size={16} />
        </button>
        <button
          aria-label="Maximize window"
          className="grid h-8 w-8 place-items-center rounded-xl bg-keycap text-legend shadow-keycap transition hover:text-highlight active:translate-y-[2px] active:shadow-inner"
          type="button"
          onClick={() => void window.api.window.maximize()}
        >
          <Maximize2 size={15} />
        </button>
        <button
          aria-label="Close application"
          className="grid h-8 w-8 place-items-center rounded-xl bg-keycap text-legend shadow-keycap transition hover:bg-rose-200 hover:text-rose-700 active:translate-y-[2px] active:shadow-inner"
          type="button"
          onClick={() => void window.api.window.close()}
        >
          <X size={16} />
        </button>
      </div>
    </header>
  );
}
