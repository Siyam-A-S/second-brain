import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Download, Loader2, Plus, RefreshCcw, Trash2 } from "lucide-react";
import type { TrackerPriority, TrackerRecord, TrackerStatus, UpdateTrackerInput } from "../../shared/ipc";
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
  const [error, setError] = useState<string | null>(null);
  const tickets = useTrackerStore((state) => state.trackers);
  const setTrackers = useTrackerStore((state) => state.setTrackers);
  const upsertTracker = useTrackerStore((state) => state.upsertTracker);
  const removeTracker = useTrackerStore((state) => state.removeTracker);

  useEffect(() => {
    void refreshTickets();
  }, [refreshKey]);

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
      setTrackers(await window.api.tracker.list());
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
          <p className="mt-1 truncate text-xs text-slate-500">Manual project tickets</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
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

      <div className="grid shrink-0 gap-3 border-b border-slate-900/5 bg-white/20 p-4 lg:grid-cols-[minmax(12rem,1fr)_minmax(16rem,2fr)_9rem_8rem_2.5rem]">
        <input
          className="h-10 rounded-md border border-slate-200 bg-white/75 px-3 text-sm outline-none transition focus:border-slate-400"
          placeholder="Ticket title"
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
          type="date"
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
            Create the first ticket for this project.
          </div>
        ) : null}

        {loadState === "ready" && sortedTickets.length > 0 ? (
          <div className="max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-white/55 shadow-sm">
            <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
              <thead className="sticky top-0 z-10 border-b border-slate-200 bg-white/85 text-xs uppercase text-slate-500 backdrop-blur">
                <tr>
                  <th className="px-4 py-3 font-semibold">Ticket</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Priority</th>
                  <th className="px-4 py-3 font-semibold">Due</th>
                  <th className="px-4 py-3 font-semibold">Sources</th>
                  <th className="px-4 py-3 font-semibold"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80">
                {sortedTickets.map((ticket) => (
                  <tr key={ticket.uuid} className="align-top transition hover:bg-white/70">
                    <td className="min-w-96 px-4 py-4">
                      <input
                        className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 font-semibold text-slate-950 outline-none transition focus:border-slate-200 focus:bg-white"
                        value={ticket.title}
                        onChange={(event) => void updateTicket({ uuid: ticket.uuid, title: event.target.value })}
                      />
                      <textarea
                        className="mt-2 h-20 w-full resize-none rounded-md border border-transparent bg-transparent px-2 py-1 text-sm leading-6 text-slate-700 outline-none transition focus:border-slate-200 focus:bg-white"
                        value={ticket.description}
                        onChange={(event) => void updateTicket({ uuid: ticket.uuid, description: event.target.value })}
                      />
                    </td>
                    <td className="px-4 py-4">
                      <select
                        className="h-9 rounded-md border border-slate-200 bg-white/75 px-2 text-sm font-medium text-slate-800 outline-none transition focus:border-slate-400"
                        value={ticket.status}
                        onChange={(event) => void updateTicket({ uuid: ticket.uuid, status: event.target.value as TrackerStatus })}
                      >
                        {statusOptions.map((option) => (
                          <option key={option} value={option}>
                            {titleCase(option)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-4">
                      <select
                        className="h-9 rounded-md border border-slate-200 bg-white/75 px-2 text-sm font-medium text-slate-800 outline-none transition focus:border-slate-400"
                        value={ticket.priority}
                        onChange={(event) => void updateTicket({ uuid: ticket.uuid, priority: event.target.value as TrackerPriority })}
                      >
                        {priorityOptions.map((option) => (
                          <option key={option} value={option}>
                            {titleCase(option)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-4">
                      <input
                        className="h-9 rounded-md border border-slate-200 bg-white/75 px-2 text-sm text-slate-700 outline-none transition focus:border-slate-400"
                        type="date"
                        value={ticket.dueDate ?? ""}
                        onChange={(event) =>
                          void updateTicket({ uuid: ticket.uuid, dueDate: event.target.value || null })
                        }
                      />
                    </td>
                    <td className="max-w-xs px-4 py-4 text-slate-600">
                      <div className="max-h-24 overflow-y-auto break-words pr-1">
                        {ticket.sourceFiles.length ? ticket.sourceFiles.join(", ") : "None"}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <button
                        className="grid h-9 w-9 place-items-center rounded-md text-rose-500 transition hover:bg-rose-50 hover:text-rose-700"
                        title="Delete ticket"
                        type="button"
                        onClick={() => void deleteTicket(ticket.uuid)}
                      >
                        <Trash2 size={16} />
                      </button>
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
