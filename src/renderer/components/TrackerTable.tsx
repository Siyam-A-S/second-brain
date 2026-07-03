import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Download, Link2, Loader2, Pin, Plus, RefreshCcw, Trash2 } from "lucide-react";
import type { TrackerListScope, TrackerPriority, TrackerRecord, TrackerStatus, UpdateTrackerInput } from "../../shared/ipc";
import { useTrackerStore } from "../stores/useTrackerStore";

type TrackerTableProps = {
  refreshKey: number;
};

type LoadState = "loading" | "ready" | "error";

const statusOptions: TrackerStatus[] = ["backlog", "todo", "in_progress", "blocked", "done"];
const priorityOptions: TrackerPriority[] = ["low", "medium", "high", "urgent"];

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatDueDate(value: string | undefined): string {
  if (!value) {
    return "No deadline";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const hasExplicitTime = !/^\d{4}-\d{2}-\d{2}$/.test(value);
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric"
  };
  if (hasExplicitTime) {
    options.hour = "numeric";
    options.minute = "2-digit";
  }
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function toDatetimeLocalValue(value: string | undefined): string {
  if (!value) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    return value;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function ticketsToCsv(tickets: TrackerRecord[]): string {
  const rows = [
    ["Title", "Status", "Priority", "Due Date", "Labels", "Sources", "Description"],
    ...tickets.map((ticket) => [
      ticket.title,
      ticket.status,
      ticket.priority,
      ticket.dueDate ?? "",
      ticket.labels.join("; "),
      ticket.sourceFiles.join("; "),
      ticket.description
    ])
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function TrackerTable({ refreshKey }: TrackerTableProps): JSX.Element {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [exported, setExported] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftDueDate, setDraftDueDate] = useState("");
  const [draftPriority, setDraftPriority] = useState<TrackerPriority>("medium");
  const [viewScope, setViewScope] = useState<TrackerListScope>("project");
  const [error, setError] = useState<string | null>(null);
  const tickets = useTrackerStore((state) => state.trackers);
  const setTrackers = useTrackerStore((state) => state.setTrackers);
  const upsertTracker = useTrackerStore((state) => state.upsertTracker);
  const removeTracker = useTrackerStore((state) => state.removeTracker);

  useEffect(() => {
    void refreshTickets();
  }, [refreshKey, viewScope]);

  const sortedTickets = useMemo(
    () =>
      [...tickets].sort((left, right) => {
        const statusOrder = new Map<TrackerStatus, number>([
          ["blocked", 0],
          ["in_progress", 1],
          ["todo", 2],
          ["backlog", 3],
          ["done", 4]
        ]);

        return (
          (statusOrder.get(left.status) ?? 99) - (statusOrder.get(right.status) ?? 99) ||
          (left.dueDate ?? "9999-99-99").localeCompare(right.dueDate ?? "9999-99-99") ||
          right.updatedAt.localeCompare(left.updatedAt)
        );
      }),
    [tickets]
  );

  async function refreshTickets(): Promise<void> {
    setLoadState("loading");
    setError(null);

    try {
      setTrackers(await window.api.tracker.list({ scope: viewScope }));
      setLoadState("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load tracker.";
      console.error("Unable to refresh tracker", error);
      setLoadState("error");
      setError(message);
    }
  }

  async function createTicket(): Promise<void> {
    if (!draftTitle.trim()) {
      return;
    }

    try {
      const ticket = await window.api.tracker.create({
        title: draftTitle,
        description: draftDescription,
        dueDate: draftDueDate || undefined,
        priority: draftPriority,
        status: "todo"
      });
      upsertTracker(ticket);
      setDraftTitle("");
      setDraftDescription("");
      setDraftDueDate("");
      setDraftPriority("medium");
      setError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create ticket.";
      setError(message);
    }
  }

  async function updateTicket(input: UpdateTrackerInput): Promise<void> {
    try {
      const updated = await window.api.tracker.update(input);
      upsertTracker(updated);
      setError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update ticket.";
      setError(message);
    }
  }

  async function deleteTicket(uuid: string): Promise<void> {
    try {
      await window.api.tracker.remove(uuid);
      removeTracker(uuid);
      setError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete ticket.";
      setError(message);
    }
  }

  function exportCsv(): void {
    const csv = ticketsToCsv(sortedTickets);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `second-brain-tickets-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setExported(true);
    window.setTimeout(() => setExported(false), 2_000);
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-floral">
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-slate-900/5 px-6">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-6 text-slate-950">Tracker</h1>
          <p className="mt-1 truncate text-xs text-slate-500">
            {viewScope === "project" ? "Active project events" : "Global events across all projects"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="grid grid-cols-2 gap-1 rounded-md border border-slate-200 bg-white/60 p-1">
            {([
              ["project", "Project"],
              ["all", "All"]
            ] as Array<[TrackerListScope, string]>).map(([scope, label]) => (
              <button
                key={scope}
                className={`h-7 rounded px-2.5 text-xs font-semibold transition ${
                  viewScope === scope ? "bg-slate-950 text-white shadow-sm" : "text-slate-600 hover:bg-white"
                }`}
                type="button"
                onClick={() => setViewScope(scope)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 bg-white/60 text-slate-600 transition hover:bg-white hover:text-slate-950"
            title={exported ? "Downloaded" : "Export CSV"}
            type="button"
            onClick={exportCsv}
          >
            {exported ? <CheckCircle2 size={16} /> : <Download size={16} />}
          </button>
          <button
            className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 bg-white/60 text-slate-600 transition hover:bg-white hover:text-slate-950"
            title="Refresh tracker"
            type="button"
            onClick={() => void refreshTickets()}
          >
            {loadState === "loading" ? <Loader2 className="animate-spin" size={16} /> : <RefreshCcw size={16} />}
          </button>
        </div>
      </header>

      <div className="grid shrink-0 gap-3 border-b border-slate-900/5 bg-white/20 p-4 lg:grid-cols-[minmax(12rem,1fr)_minmax(16rem,2fr)_12rem_8rem_2.5rem]">
        <input
          className="h-10 rounded-md border border-slate-200 bg-white/75 px-3 text-sm outline-none transition focus:border-slate-400"
          placeholder="Task title"
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
        />
        <input
          className="h-10 rounded-md border border-slate-200 bg-white/75 px-3 text-sm outline-none transition focus:border-slate-400"
          placeholder="Description"
          value={draftDescription}
          onChange={(event) => setDraftDescription(event.target.value)}
        />
        <input
          className="h-10 rounded-md border border-slate-200 bg-white/75 px-3 text-sm outline-none transition focus:border-slate-400"
          type="datetime-local"
          value={draftDueDate}
          onChange={(event) => setDraftDueDate(event.target.value)}
        />
        <select
          className="h-10 rounded-md border border-slate-200 bg-white/75 px-3 text-sm outline-none transition focus:border-slate-400"
          value={draftPriority}
          onChange={(event) => setDraftPriority(event.target.value as TrackerPriority)}
        >
          {priorityOptions.map((priority) => (
            <option key={priority} value={priority}>
              {titleCase(priority)}
            </option>
          ))}
        </select>
        <button
          className="grid h-10 place-items-center rounded-md bg-slate-950 text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!draftTitle.trim()}
          title="Create ticket"
          type="button"
          onClick={() => void createTicket()}
        >
          <Plus size={16} />
        </button>
      </div>

      {error ? (
        <div className="flex items-center gap-2 border-b border-rose-200 bg-rose-50 px-6 py-3 text-sm text-rose-900">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-6">
        {loadState === "loading" ? (
          <div className="grid h-full place-items-center text-sm text-slate-500">Loading tickets...</div>
        ) : null}

        {loadState === "error" ? (
          <div className="grid h-full place-items-center">
            <div className="max-w-sm text-center">
              <AlertCircle className="mx-auto text-rose-500" size={28} />
              <h2 className="mt-3 text-base font-semibold text-slate-950">Tracker unavailable</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{error ?? "The local tracker could not be read."}</p>
            </div>
          </div>
        ) : null}

        {loadState === "ready" && sortedTickets.length === 0 ? (
          <div className="grid h-full place-items-center text-center text-sm leading-6 text-slate-500">
            Create the first tracker event for this {viewScope === "project" ? "project" : "workspace"}.
          </div>
        ) : null}

        {loadState === "ready" && sortedTickets.length > 0 ? (
          <div className="grid gap-3">
            {sortedTickets.map((ticket) => {
              const grounded = ticket.sourceNodeIds.length > 0;
              return (
                <article
                  key={ticket.uuid}
                  className={`rounded-xl border p-3 text-sm shadow-sm ${
                    grounded ? "border-teal-200 bg-teal-50/80" : "border-amber-200 bg-amber-50/80"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <input
                        className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 font-semibold text-slate-950 outline-none transition focus:border-slate-200 focus:bg-white/85"
                        value={ticket.title}
                        onChange={(event) => void updateTicket({ uuid: ticket.uuid, title: event.target.value })}
                      />
                      <textarea
                        className="mt-2 h-16 w-full resize-none rounded-md border border-transparent bg-transparent px-2 py-1 text-sm leading-6 text-slate-700 outline-none transition focus:border-slate-200 focus:bg-white/85"
                        placeholder="Notes"
                        value={ticket.description}
                        onChange={(event) => void updateTicket({ uuid: ticket.uuid, description: event.target.value })}
                      />
                    </div>
                    <Pin className={grounded ? "text-teal-700" : "text-amber-700"} size={16} />
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                        grounded ? "border-teal-300 bg-white/80 text-teal-800" : "border-amber-200 bg-white/80 text-amber-800"
                      }`}
                    >
                      {grounded ? `Grounded · ${ticket.sourceNodeIds.length} nodes` : "Floating task"}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white/75 px-2 py-0.5 text-xs font-semibold text-slate-600">
                      {formatDueDate(ticket.dueDate)}
                    </span>
                    {viewScope === "all" ? (
                      <span className="rounded-full border border-slate-200 bg-white/75 px-2 py-0.5 text-xs font-semibold text-slate-600">
                        {ticket.projectName || "Unknown project"}
                      </span>
                    ) : null}
                  </div>

                  {ticket.sourceFiles.length ? (
                    <div className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-slate-600">
                      <Link2 className="mt-0.5 shrink-0" size={13} />
                      <span className="break-words">{ticket.sourceFiles.join(", ")}</span>
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                      <select
                        className="h-9 rounded-lg border border-slate-200 bg-white/75 px-2 text-sm font-medium text-slate-800 outline-none transition focus:border-slate-400"
                        value={ticket.status}
                        onChange={(event) => void updateTicket({ uuid: ticket.uuid, status: event.target.value as TrackerStatus })}
                      >
                        {statusOptions.map((option) => (
                          <option key={option} value={option}>
                            {titleCase(option)}
                          </option>
                        ))}
                      </select>
                      <select
                        className="h-9 rounded-lg border border-slate-200 bg-white/75 px-2 text-sm font-medium text-slate-800 outline-none transition focus:border-slate-400"
                        value={ticket.priority}
                        onChange={(event) => void updateTicket({ uuid: ticket.uuid, priority: event.target.value as TrackerPriority })}
                      >
                        {priorityOptions.map((option) => (
                          <option key={option} value={option}>
                            {titleCase(option)}
                          </option>
                        ))}
                      </select>
                      <input
                        className="h-9 rounded-lg border border-slate-200 bg-white/75 px-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
                        type="datetime-local"
                        value={toDatetimeLocalValue(ticket.dueDate)}
                        onChange={(event) =>
                          void updateTicket({ uuid: ticket.uuid, dueDate: event.target.value || null })
                        }
                      />
                      <button
                        className="ml-auto grid h-9 w-9 place-items-center rounded-lg text-rose-500 transition hover:bg-rose-50 hover:text-rose-700"
                        title="Delete tracker event"
                        type="button"
                        onClick={() => void deleteTicket(ticket.uuid)}
                      >
                        <Trash2 size={16} />
                      </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
