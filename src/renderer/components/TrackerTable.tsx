import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CalendarClock, CheckCircle2, Download, Loader2, RefreshCcw } from "lucide-react";
import type { TrackerIngestionStatus, TrackerRecord, TrackerStatus } from "../../shared/ipc";
import { useTrackerStore } from "../stores/useTrackerStore";

type TrackerTableProps = {
  refreshKey: number;
};

type LoadState = "loading" | "ready" | "error";
type ExportState = "idle" | "downloaded" | "error";

const statusOptions: TrackerStatus[] = ["Tracking", "Done", "Dismissed"];

function formatDate(value: string): string {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function trackersToCsv(trackers: TrackerRecord[]): string {
  const rows = [
    ["Title", "Date", "Time", "End Time", "Timezone", "Location", "Link", "Status", "Source", "Context"],
    ...trackers.map((tracker) => [
      tracker.title,
      tracker.date,
      tracker.time,
      tracker.endTime ?? "",
      tracker.timezone ?? "",
      tracker.location ?? "",
      tracker.link ?? "",
      tracker.status,
      tracker.source ?? "",
      tracker.context
    ])
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function progressWidth(stage: TrackerIngestionStatus["stage"]): string {
  switch (stage) {
    case "extracting":
      return "62%";
    case "saved":
    case "skipped":
    case "error":
      return "100%";
    case "idle":
    default:
      return "0%";
  }
}

function progressClass(stage: TrackerIngestionStatus["stage"]): string {
  switch (stage) {
    case "error":
      return "bg-rose-500";
    case "saved":
      return "bg-emerald-500";
    case "skipped":
      return "bg-slate-400";
    case "extracting":
      return "bg-slate-900";
    case "idle":
    default:
      return "bg-slate-300";
  }
}

export function TrackerTable({ refreshKey }: TrackerTableProps): JSX.Element {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [exportState, setExportState] = useState<ExportState>("idle");
  const trackers = useTrackerStore((state) => state.trackers);
  const setTrackers = useTrackerStore((state) => state.setTrackers);
  const status = useTrackerStore((state) => state.status);
  const setStatus = useTrackerStore((state) => state.setStatus);
  const upsertTracker = useTrackerStore((state) => state.upsertTracker);
  const upsertTrackers = useTrackerStore((state) => state.upsertTrackers);

  useEffect(() => {
    return window.api.tracker.onIngestionStatus((nextStatus) => {
      setStatus(nextStatus);

      if (nextStatus.trackers?.length) {
        upsertTrackers(nextStatus.trackers);
        return;
      }

      if (nextStatus.tracker) {
        upsertTracker(nextStatus.tracker);
      }
    });
  }, [setStatus, upsertTracker, upsertTrackers]);

  useEffect(() => {
    let isMounted = true;

    setLoadState("loading");
    void window.api.tracker
      .list()
      .then((records) => {
        if (!isMounted) {
          return;
        }

        setTrackers(records);
        setLoadState("ready");
      })
      .catch((error) => {
        console.error("Unable to load tracker", error);
        if (isMounted) {
          setLoadState("error");
        }
      });

    return () => {
      isMounted = false;
    };
  }, [refreshKey, setTrackers]);

  const sortedTrackers = useMemo(
    () =>
      [...trackers].sort((left, right) => {
        const leftWhen = `${left.date || "9999-99-99"} ${left.time || "99:99"}`;
        const rightWhen = `${right.date || "9999-99-99"} ${right.time || "99:99"}`;
        const byWhen = leftWhen.localeCompare(rightWhen);
        return byWhen !== 0 ? byWhen : right.updatedAt.localeCompare(left.updatedAt);
      }),
    [trackers]
  );

  async function updateTracker(input: { uuid: string; status?: TrackerStatus; context?: string }): Promise<void> {
    try {
      const updated = await window.api.tracker.update(input);
      upsertTracker(updated);
      setStatus({
        stage: "saved",
        message: `Updated ${updated.title}`,
        tracker: updated
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update tracker.";
      console.error("Unable to update tracker", error);
      setStatus({
        stage: "error",
        message,
        error: message
      });
    }
  }

  async function refreshTrackers(): Promise<void> {
    setLoadState("loading");
    try {
      setTrackers(await window.api.tracker.list());
      setLoadState("ready");
    } catch (error) {
      console.error("Unable to refresh tracker", error);
      setLoadState("error");
    }
  }

  function exportCsv(): void {
    try {
      const csv = trackersToCsv(sortedTrackers);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `second-brain-tracker-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportState("downloaded");
      window.setTimeout(() => setExportState("idle"), 2_000);
    } catch (error) {
      console.error("Unable to export tracker CSV", error);
      setExportState("error");
      window.setTimeout(() => setExportState("idle"), 2_000);
    }
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-floral">
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-slate-900/5 px-6">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-6 text-slate-950">Tracker</h1>
          <p className="mt-1 truncate text-xs text-slate-500">{status.message}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 bg-white/60 text-slate-600 transition hover:bg-white hover:text-slate-950"
            title={exportState === "downloaded" ? "Downloaded" : "Export CSV"}
            type="button"
            onClick={exportCsv}
          >
            {exportState === "downloaded" ? <CheckCircle2 size={16} /> : <Download size={16} />}
          </button>
          <button
            className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 bg-white/60 text-slate-600 transition hover:bg-white hover:text-slate-950"
            title="Refresh tracker"
            type="button"
            onClick={() => void refreshTrackers()}
          >
            <RefreshCcw size={16} />
          </button>
        </div>
      </header>

      <div className="h-1 bg-slate-900/5">
        <div
          className={`h-full transition-all duration-300 ease-out ${progressClass(status.stage)}`}
          style={{ width: progressWidth(status.stage) }}
        />
      </div>

      {status.stage !== "idle" ? (
        <div
          className={`flex items-center gap-2 border-b px-6 py-3 text-sm ${
            status.stage === "error"
              ? "border-rose-900/10 bg-rose-50 text-rose-900"
              : "border-emerald-900/10 bg-emerald-50 text-emerald-900"
          }`}
        >
          {status.stage === "extracting" ? (
            <Loader2 className="animate-spin" size={16} />
          ) : status.stage === "error" ? (
            <AlertCircle size={16} />
          ) : (
            <CheckCircle2 size={16} />
          )}
          <span className="truncate">{status.message}</span>
        </div>
      ) : null}

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-6">
        {loadState === "loading" ? (
          <div className="grid h-full place-items-center text-sm text-slate-500">Loading tracker...</div>
        ) : null}

        {loadState === "error" ? (
          <div className="grid h-full place-items-center">
            <div className="max-w-sm text-center">
              <AlertCircle className="mx-auto text-rose-500" size={28} />
              <h2 className="mt-3 text-base font-semibold text-slate-950">Tracker unavailable</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">The local tracker could not be read.</p>
            </div>
          </div>
        ) : null}

        {loadState === "ready" && sortedTrackers.length === 0 ? (
          <div className="grid h-full place-items-center">
            <div className="max-w-md text-center">
              <CalendarClock className="mx-auto text-slate-400" size={32} />
              <h2 className="mt-4 text-xl font-semibold text-slate-950">Nothing to track yet</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Drop notes, emails, PDFs, or snippets with explicit dates, times, deadlines, meetings, or follow-ups.
              </p>
            </div>
          </div>
        ) : null}

        {loadState === "ready" && sortedTrackers.length > 0 ? (
          <div className="max-w-full overflow-x-auto overflow-y-hidden rounded-lg border border-slate-200 bg-white/55 shadow-sm">
            <table className="w-full min-w-[1320px] border-collapse text-left text-sm">
              <thead className="border-b border-slate-200 bg-white/70 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">When</th>
                  <th className="px-4 py-3 font-semibold">Track</th>
                  <th className="px-4 py-3 font-semibold">Place</th>
                  <th className="px-4 py-3 font-semibold">Link</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Context</th>
                  <th className="px-4 py-3 font-semibold">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80">
                {sortedTrackers.map((tracker) => (
                  <tr key={tracker.uuid} className="align-top transition hover:bg-white/70">
                    <td className="whitespace-nowrap px-4 py-4 text-slate-700">
                      <div className="font-semibold text-slate-950">{formatDate(tracker.date)}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {[
                          tracker.time && tracker.endTime ? `${tracker.time}-${tracker.endTime}` : tracker.time,
                          tracker.timezone
                        ]
                          .filter(Boolean)
                          .join(" ") || "Any time"}
                      </div>
                    </td>
                    <td className="min-w-64 px-4 py-4 font-semibold text-slate-950">{tracker.title}</td>
                    <td className="max-w-56 px-4 py-4 text-slate-700">
                      <div className="max-h-20 overflow-y-auto break-words pr-1">{tracker.location || "Unknown"}</div>
                    </td>
                    <td className="max-w-64 px-4 py-4 text-slate-700">
                      {tracker.link ? (
                        <a
                          className="block max-h-20 overflow-y-auto break-words pr-1 text-slate-950 underline decoration-slate-300 underline-offset-4"
                          href={tracker.link}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {tracker.link}
                        </a>
                      ) : (
                        "None"
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <select
                        className="h-9 rounded-md border border-slate-200 bg-white/75 px-2 text-sm font-medium text-slate-800 outline-none transition focus:border-slate-400"
                        value={tracker.status}
                        onChange={(event) =>
                          void updateTracker({
                            uuid: tracker.uuid,
                            status: event.target.value as TrackerStatus
                          })
                        }
                      >
                        {statusOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="max-w-xl px-4 py-4 leading-6 text-slate-700">
                      <div className="max-h-28 overflow-y-auto pr-1">{tracker.context}</div>
                    </td>
                    <td className="max-w-xs px-4 py-4 text-slate-600">
                      <div className="max-h-24 overflow-y-auto break-words pr-1">{tracker.source || "Dropped content"}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}
