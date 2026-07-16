import { useEffect, useState } from "react";
import type { AccountAuthState, AppBuildInfo, AppSettings, ProcessDroppedItemsResult, UserPersona } from "../../shared/ipc";
import type { ThemeMode } from "../components/TitleBar";
import { TitleBar } from "../components/TitleBar";
import { Sidebar } from "../components/Sidebar";
import { DropTarget } from "../components/DropTarget";
import { TrackerTable } from "../components/TrackerTable";
import { GraphBoardRenderer } from "../components/GraphBoardRenderer";
import { SettingsPanel } from "../components/SettingsPanel";
import { ExplorerWorkbench } from "../components/ExplorerWorkbench";
import { ChatWorkbench } from "../components/ChatWorkbench";
import { isProductionBuild, presentError } from "../lib/errorPresentation";

type ActiveView = "graph" | "chat" | "explorer" | "tracker";

const themeStorageKey = "second-brain.themeMode";
const accentHueStorageKey = "second-brain.accentHue";
const activeViewStorageKey = "second-brain.activeView";
const leftPanelCollapsedStorageKey = "second-brain.leftPanelCollapsed";
const topBarMirroredStorageKey = "second-brain.topBarMirrored";
const personaOnboardingStorageKey = "second-brain.personaOnboardingComplete";
const defaultAccentHue = 110;
const personaAssets: Record<UserPersona, { label: string; src: string }> = {
  dolphin: { label: "Dolphin", src: new URL("../../../build/Dolphin.PNG", import.meta.url).href },
  jellyfish: { label: "Jellyfish", src: new URL("../../../build/Jellyfish.PNG", import.meta.url).href },
  ant: { label: "Ant", src: new URL("../../../build/Ant.PNG", import.meta.url).href },
  monkey: { label: "Monkey", src: new URL("../../../build/Monkey.PNG", import.meta.url).href },
  hippo: { label: "Hippo", src: new URL("../../../build/Hippo.PNG", import.meta.url).href }
};
const themeVariableNames = [
  "--color-frame",
  "--color-panel",
  "--color-keycap",
  "--color-legend",
  "--color-highlight",
  "--color-led-status",
  "--color-text-main"
];

function initialThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "classic";
  }

  const stored = window.localStorage.getItem(themeStorageKey);
  if (stored === "classic" || stored === "keypiphy") {
    return stored;
  }

  return document.documentElement.dataset.theme === "keypiphy" || document.documentElement.dataset.theme === "mint"
    ? "keypiphy"
    : "classic";
}

function initialAccentHue(): number {
  if (typeof window === "undefined") {
    return defaultAccentHue;
  }

  const stored = Number(window.localStorage.getItem(accentHueStorageKey));
  return Number.isFinite(stored) && stored >= 0 && stored <= 360 ? stored : defaultAccentHue;
}

function initialActiveView(): ActiveView {
  if (typeof window === "undefined") {
    return "graph";
  }

  const stored = window.localStorage.getItem(activeViewStorageKey);
  return stored === "graph" || stored === "chat" || stored === "explorer" || stored === "tracker" ? stored : "graph";
}

function initialStoredBoolean(storageKey: string, fallback = false): boolean {
  if (typeof window === "undefined") {
    return fallback;
  }

  const stored = window.localStorage.getItem(storageKey);
  return stored === null ? fallback : stored === "true";
}

function wrapHue(hue: number): number {
  return ((hue % 360) + 360) % 360;
}

function keypiphyPaletteFromHue(hue: number): Record<string, string> {
  const panelHue = wrapHue(hue);
  const accentHue = wrapHue(hue + 70);
  const textHue = wrapHue(hue + 170);

  return {
    "--color-frame": `hsl(${panelHue} 48% 92%)`,
    "--color-panel": `hsl(${panelHue} 54% 94%)`,
    "--color-keycap": `hsl(${panelHue} 36% 83%)`,
    "--color-legend": `hsl(${textHue} 26% 18%)`,
    "--color-highlight": `hsl(${accentHue} 100% 20%)`,
    "--color-led-status": `hsl(${accentHue} 100% 25%)`,
    "--color-text-main": `hsl(${textHue} 18% 18%)`
  };
}

export function MainApp(): JSX.Element {
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeView, setActiveView] = useState<ActiveView>(initialActiveView);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(() => initialStoredBoolean(leftPanelCollapsedStorageKey));
  const [themeMode, setThemeMode] = useState<ThemeMode>(initialThemeMode);
  const [accentHue, setAccentHue] = useState(initialAccentHue);
  const [topBarMirrored, setTopBarMirrored] = useState(() => initialStoredBoolean(topBarMirroredStorageKey));
  const [persona, setPersona] = useState<UserPersona>("dolphin");
  const [personaOnboardingOpen, setPersonaOnboardingOpen] = useState(false);
  const [buildInfo, setBuildInfo] = useState<AppBuildInfo | null>(null);
  const [accountState, setAccountState] = useState<AccountAuthState | null>(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountStatus, setAccountStatus] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const productionBuild = isProductionBuild(buildInfo);

  useEffect(() => {
    const handleError = (event: ErrorEvent): void => {
      void window.api.app.reportRendererError({
        scope: "renderer:error",
        error: event.message,
        detail: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          stack: event.error instanceof Error ? event.error.stack : undefined
        }
      });
    };
    const handleRejection = (event: PromiseRejectionEvent): void => {
      void window.api.app.reportRendererError({
        scope: "renderer:unhandledRejection",
        error: event.reason instanceof Error ? event.reason.message : String(event.reason),
        detail: event.reason instanceof Error ? { stack: event.reason.stack } : undefined
      });
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (themeMode === "keypiphy") {
      root.dataset.theme = "keypiphy";
      for (const [name, value] of Object.entries(keypiphyPaletteFromHue(accentHue))) {
        root.style.setProperty(name, value);
      }
    } else {
      root.dataset.theme = "classic";
      for (const name of themeVariableNames) {
        root.style.removeProperty(name);
      }
    }

    window.localStorage.setItem(themeStorageKey, themeMode);
    window.localStorage.setItem(accentHueStorageKey, String(accentHue));
  }, [accentHue, themeMode]);

  useEffect(() => {
    let mounted = true;
    Promise.all([window.api.app.getBuildInfo(), window.api.account.getState()])
      .then(([info, state]) => {
        if (!mounted) {
          return;
        }
        setBuildInfo(info);
        setAccountState(state);
        setAccountEmail(state.email || "");
      })
      .catch((error) => {
        if (mounted) {
          setAccountStatus(presentError(error, "Unable to load account.", buildInfo));
        }
      })
      .finally(() => {
        if (mounted) {
          setAccountLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(activeViewStorageKey, activeView);
  }, [activeView]);

  useEffect(() => {
    window.localStorage.setItem(leftPanelCollapsedStorageKey, String(leftPanelCollapsed));
  }, [leftPanelCollapsed]);

  useEffect(() => {
    window.localStorage.setItem(topBarMirroredStorageKey, String(topBarMirrored));
  }, [topBarMirrored]);

  useEffect(() => {
    let mounted = true;
    void window.api.settings
      .getApp()
      .then((settings) => {
        if (mounted) {
          setTopBarMirrored(settings.appearance.topBarMirrored);
          setPersona(settings.appearance.persona);
        }
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (buildInfo === null || (productionBuild && !accountState?.signedIn)) {
      return;
    }

    if (window.localStorage.getItem(personaOnboardingStorageKey) !== "true") {
      setPersonaOnboardingOpen(true);
    }
  }, [accountState?.signedIn, buildInfo, productionBuild]);

  useEffect(() => {
    if (buildInfo === null || (productionBuild && !accountState?.signedIn)) {
      return undefined;
    }

    let mounted = true;
    void window.api.runtime
      .getDependencyStatus()
      .then((status) => {
        if (mounted && !status.available) {
          setSettingsOpen(true);
        }
      })
      .catch(() => {
        if (mounted) {
          setSettingsOpen(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, [accountState?.signedIn, buildInfo, productionBuild]);

  function handleDropProcessed(result: ProcessDroppedItemsResult): void {
    setRefreshKey((key) => key + 1);
    if (result.graphify) {
      setActiveView("graph");
    }
  }

  function handleProjectChanged(): void {
    setRefreshKey((key) => key + 1);
  }

  function handleSettingsSaved(settings: AppSettings): void {
    setTopBarMirrored(settings.appearance.topBarMirrored);
    setPersona(settings.appearance.persona);
    setRefreshKey((key) => key + 1);
  }

  async function selectPersona(nextPersona: UserPersona): Promise<void> {
    setPersona(nextPersona);
    window.localStorage.setItem(personaOnboardingStorageKey, "true");
    setPersonaOnboardingOpen(false);
    try {
      const settings = await window.api.settings.updateApp({
        appearance: {
          persona: nextPersona
        }
      });
      handleSettingsSaved(settings);
    } catch (error) {
      setAccountStatus(presentError(error, "Unable to save persona.", buildInfo));
    }
  }

  function skipPersonaOnboarding(): void {
    window.localStorage.setItem(personaOnboardingStorageKey, "true");
    setPersonaOnboardingOpen(false);
  }

  async function handleAccountSignIn(): Promise<void> {
    setAccountBusy(true);
    setAccountStatus("");
    try {
      const state = await window.api.account.signIn({ email: accountEmail, password: accountPassword });
      setAccountState(state);
      setAccountEmail(state.email || accountEmail);
      setAccountPassword("");
      setAccountStatus(state.signedIn ? "Signed in." : "Account needs attention.");
    } catch (error) {
      setAccountStatus(presentError(error, "Unable to sign in.", buildInfo));
    } finally {
      setAccountBusy(false);
    }
  }

  async function handleAccountWebSignIn(): Promise<void> {
    const baseUrl = accountState?.accountUrl || buildInfo?.websiteUrl || "https://www.downloadsecondbrain.com";
    const trimmedEmail = accountEmail.trim();
    const target = trimmedEmail
      ? `${baseUrl.replace(/\/$/, "")}/login?email=${encodeURIComponent(trimmedEmail)}&desktop=1`
      : `${baseUrl.replace(/\/$/, "")}/login?desktop=1`;
    try {
      await window.api.window.openExternal(target);
    } catch (error) {
      setAccountStatus(presentError(error, "Unable to open account login.", buildInfo));
    }
  }

  async function handleAccountRefresh(): Promise<void> {
    setAccountBusy(true);
    setAccountStatus("");
    try {
      const state = await window.api.account.refresh();
      setAccountState(state);
      setAccountEmail(state.email || accountEmail);
      setAccountStatus(state.signedIn ? "Account refreshed." : "Please sign in.");
    } catch (error) {
      setAccountStatus(presentError(error, "Unable to refresh account.", buildInfo));
    } finally {
      setAccountBusy(false);
    }
  }

  if (accountLoading || buildInfo === null) {
    return <div className="keyboard-frame flex h-full flex-col bg-frame text-textMain" />;
  }

  if (productionBuild && !accountState?.signedIn) {
    return (
      <div className="keyboard-frame flex h-full flex-col bg-frame text-textMain">
        <TitleBar
          accentHue={accentHue}
          mirrored={topBarMirrored}
          themeMode={themeMode}
          onAccentHueChange={setAccentHue}
          onOpenSettings={() => setSettingsOpen(true)}
          onThemeModeChange={setThemeMode}
        />
        <main className="flex min-h-0 flex-1 items-center justify-center px-4 py-8">
          <section className="material-frosted w-full max-w-md rounded-2xl border border-black/10 bg-panel p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)]">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-led">Second Brain</p>
            <h1 className="mt-3 text-2xl font-semibold text-textMain">Sign in to continue</h1>
            <p className="mt-2 text-sm leading-6 text-textMain/70">
              Use the email and password for your Second Brain account. Your session stays on this device and desktop requests use it securely.
            </p>
            <div className="mt-5 space-y-3">
              <label className="block text-sm font-medium text-textMain/80">
                Email
                <input
                  className="mt-1 w-full rounded-xl border border-black/10 bg-white/70 px-3 py-2 font-mono text-sm text-textMain shadow-inner outline-none focus:border-highlight"
                  type="email"
                  value={accountEmail}
                  onChange={(event) => setAccountEmail(event.target.value)}
                  placeholder="you@example.com"
                />
              </label>
              <label className="block text-sm font-medium text-textMain/80">
                Password
                <input
                  className="mt-1 w-full rounded-xl border border-black/10 bg-white/70 px-3 py-2 font-mono text-sm text-textMain shadow-inner outline-none focus:border-highlight"
                  type="password"
                  value={accountPassword}
                  onChange={(event) => setAccountPassword(event.target.value)}
                  placeholder="Password"
                />
              </label>
            </div>
            {accountStatus ? <p className="mt-3 text-sm text-textMain/70">{accountStatus}</p> : null}
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                className="rounded-xl bg-keycap px-4 py-2 font-mono text-sm font-semibold text-highlight shadow-keycap transition active:translate-y-[2px] active:shadow-inner disabled:opacity-60"
                type="button"
                disabled={accountBusy || !accountEmail.trim() || !accountPassword}
                onClick={() => void handleAccountSignIn()}
              >
                {accountBusy ? "Signing in..." : "Sign in"}
              </button>
              <button
                className="rounded-xl bg-keycap px-4 py-2 font-mono text-sm font-semibold text-legend shadow-keycap transition active:translate-y-[2px] active:shadow-inner"
                type="button"
                onClick={() => void handleAccountWebSignIn()}
              >
                Open web login
              </button>
              <button
                className="rounded-xl bg-keycap px-4 py-2 font-mono text-sm font-semibold text-legend shadow-keycap transition active:translate-y-[2px] active:shadow-inner disabled:opacity-60"
                type="button"
                disabled={accountBusy}
                onClick={() => void handleAccountRefresh()}
              >
                Refresh
              </button>
            </div>
          </section>
        </main>
        <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} onSettingsSaved={handleSettingsSaved} />
      </div>
    );
  }

  return (
    <div className="keyboard-frame flex h-full flex-col bg-frame text-textMain">
      <TitleBar
        accentHue={accentHue}
        mirrored={topBarMirrored}
        themeMode={themeMode}
        onAccentHueChange={setAccentHue}
        onOpenSettings={() => setSettingsOpen(true)}
        onThemeModeChange={setThemeMode}
      />
      <div className="flex min-h-0 flex-1 p-3 min-[760px]:hidden">
        <DropTarget onProcessed={handleDropProcessed} />
      </div>
      <div className="hidden min-h-0 flex-1 min-[760px]:flex">
        <Sidebar
          collapsed={leftPanelCollapsed}
          refreshKey={refreshKey}
          onDropProcessed={handleDropProcessed}
          onProjectChanged={handleProjectChanged}
          onToggleCollapsed={() => setLeftPanelCollapsed((value) => !value)}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="material-frosted flex h-12 shrink-0 items-center gap-2 border-b border-black/10 bg-panel px-6">
            <button
              className={`rounded-xl px-3 py-1.5 font-mono text-sm font-semibold transition active:translate-y-[2px] active:shadow-inner ${
                activeView === "graph" ? "bg-keycap text-highlight shadow-keycap" : "bg-keycap text-legend shadow-keycap hover:text-highlight"
              }`}
              type="button"
              onClick={() => setActiveView("graph")}
            >
              Board
            </button>
            <button
              className={`rounded-xl px-3 py-1.5 font-mono text-sm font-semibold transition active:translate-y-[2px] active:shadow-inner ${
                activeView === "chat" ? "bg-keycap text-highlight shadow-keycap" : "bg-keycap text-legend shadow-keycap hover:text-highlight"
              }`}
              type="button"
              onClick={() => setActiveView("chat")}
            >
              Chat
            </button>
            <button
              className={`rounded-xl px-3 py-1.5 font-mono text-sm font-semibold transition active:translate-y-[2px] active:shadow-inner ${
                activeView === "explorer" ? "bg-keycap text-highlight shadow-keycap" : "bg-keycap text-legend shadow-keycap hover:text-highlight"
              }`}
              type="button"
              onClick={() => setActiveView("explorer")}
            >
              Explorer
            </button>
            <button
              className={`rounded-xl px-3 py-1.5 font-mono text-sm font-semibold transition active:translate-y-[2px] active:shadow-inner ${
                activeView === "tracker" ? "bg-keycap text-highlight shadow-keycap" : "bg-keycap text-legend shadow-keycap hover:text-highlight"
              }`}
              type="button"
              onClick={() => setActiveView("tracker")}
            >
              Tracker
            </button>
          </div>
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <section className={activeView === "graph" ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden min-h-0 min-w-0 flex-1 flex-col"}>
              <GraphBoardRenderer refreshKey={refreshKey} />
            </section>
            <section className={activeView === "chat" ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden min-h-0 min-w-0 flex-1 flex-col"}>
              <ChatWorkbench refreshKey={refreshKey} />
            </section>
            <section
              className={activeView === "explorer" ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden min-h-0 min-w-0 flex-1 flex-col"}
            >
              <ExplorerWorkbench refreshKey={refreshKey} />
            </section>
            <section className={activeView === "tracker" ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden min-h-0 min-w-0 flex-1 flex-col"}>
              <TrackerTable refreshKey={refreshKey} />
            </section>
          </div>
        </div>
      </div>
      {personaOnboardingOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/20 px-4 backdrop-blur-sm">
          <section className="material-frosted w-full max-w-md rounded-xl border border-black/10 bg-panel p-5 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xs font-semibold uppercase text-highlight">Persona</p>
                <h2 className="mt-1 text-xl font-semibold text-textMain">Choose your chat icon</h2>
              </div>
              <button
                className="rounded-md px-2 py-1 text-xs font-semibold text-legend/70 transition hover:bg-white/60 hover:text-legend"
                type="button"
                onClick={skipPersonaOnboarding}
              >
                Skip
              </button>
            </div>
            <div className="mt-5 grid grid-cols-5 gap-2">
              {(Object.entries(personaAssets) as Array<[UserPersona, (typeof personaAssets)[UserPersona]]>).map(([nextPersona, asset]) => {
                const selected = persona === nextPersona;
                return (
                  <button
                    key={nextPersona}
                    className={`flex min-w-0 flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs font-semibold transition ${
                      selected
                        ? "border-emerald-300 bg-emerald-50 text-emerald-800 shadow-[0_0_14px_rgba(16,185,129,0.22)]"
                        : "border-black/10 bg-white/65 text-legend hover:border-emerald-200 hover:bg-emerald-50/80"
                    }`}
                    type="button"
                    onClick={() => void selectPersona(nextPersona)}
                  >
                    <img alt="" className="h-11 w-11 rounded-full object-cover" src={asset.src} />
                    <span className="max-w-full truncate">{asset.label}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} onSettingsSaved={handleSettingsSaved} />
    </div>
  );
}
