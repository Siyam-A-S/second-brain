import { useEffect, useMemo, useState } from "react";
import { AlertCircle, BriefcaseBusiness, CheckCircle2, Download, Loader2, RefreshCcw } from "lucide-react";
import type { JobApplicationStatus, JobIngestionStatus, JobTrackerRecord } from "../../shared/ipc";
import { useJobTrackerStore } from "../stores/useJobTrackerStore";

type JobTrackerTableProps = {
  refreshKey: number;
};

type LoadState = "loading" | "ready" | "error";
type ExportState = "idle" | "downloaded" | "error";

const statusOptions: JobApplicationStatus[] = ["Applied", "Interview", "Offer", "Rejected", "Withdrawn"];

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

function jobsToCsv(jobs: JobTrackerRecord[]): string {
  const rows = [
    ["Company", "Role", "Job Posted", "Application Date", "Status", "Resume", "Summary"],
    ...jobs.map((job) => [
      job.company,
      job.role,
      job.job_posted,
      job.application_date,
      job.status,
      job.resume,
      job.description_summary
    ])
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function progressWidth(stage: JobIngestionStatus["stage"]): string {
  switch (stage) {
    case "extracting":
      return "62%";
    case "saved":
      return "100%";
    case "error":
      return "100%";
    case "idle":
    default:
      return "0%";
  }
}

function progressClass(stage: JobIngestionStatus["stage"]): string {
  switch (stage) {
    case "error":
      return "bg-rose-500";
    case "saved":
      return "bg-emerald-500";
    case "extracting":
      return "bg-slate-900";
    case "idle":
    default:
      return "bg-slate-300";
  }
}

export function JobTrackerTable({ refreshKey }: JobTrackerTableProps): JSX.Element {
  const [resumeDrafts, setResumeDrafts] = useState<Record<string, string>>({});
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [exportState, setExportState] = useState<ExportState>("idle");
  const jobs = useJobTrackerStore((state) => state.jobs);
  const setJobs = useJobTrackerStore((state) => state.setJobs);
  const status = useJobTrackerStore((state) => state.status);
  const setStatus = useJobTrackerStore((state) => state.setStatus);
  const upsertJob = useJobTrackerStore((state) => state.upsertJob);

  useEffect(() => {
    return window.api.jobs.onIngestionStatus((nextStatus) => {
      setStatus(nextStatus);

      const savedJob = nextStatus.job;
      if (savedJob) {
        upsertJob(savedJob);
      }
    });
  }, [setStatus, upsertJob]);

  useEffect(() => {
    let isMounted = true;

    setLoadState("loading");
    void window.api.jobs
      .list()
      .then((records) => {
        if (!isMounted) {
          return;
        }

        setJobs(records);
        setLoadState("ready");
      })
      .catch((error) => {
        console.error("Unable to load jobs", error);
        if (isMounted) {
          setLoadState("error");
        }
      });

    return () => {
      isMounted = false;
    };
  }, [refreshKey]);

  const sortedJobs = useMemo(
    () =>
      [...jobs].sort((left, right) => {
        const byUpdated = right.updatedAt.localeCompare(left.updatedAt);
        return byUpdated !== 0 ? byUpdated : right.application_date.localeCompare(left.application_date);
      }),
    [jobs]
  );

  function placeUpdatedJob(updated: JobTrackerRecord): void {
    upsertJob(updated);
    setResumeDrafts((current) => {
      const next = { ...current };
      delete next[updated.uuid];
      return next;
    });
  }

  async function updateJob(input: { uuid: string; status?: JobApplicationStatus; resume?: string }): Promise<void> {
    try {
      const updated = await window.api.jobs.update(input);
      placeUpdatedJob(updated);
      setStatus({
        stage: "saved",
        message: `Updated ${updated.role} at ${updated.company}`,
        job: updated
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update job.";
      console.error("Unable to update job", error);
      setStatus({
        stage: "error",
        message,
        error: message
      });
    }
  }

  async function refreshJobs(): Promise<void> {
    setLoadState("loading");
    try {
        setJobs(await window.api.jobs.list());
      setLoadState("ready");
    } catch (error) {
      console.error("Unable to refresh jobs", error);
      setLoadState("error");
    }
  }

  function exportCsv(): void {
    try {
      const csv = jobsToCsv(sortedJobs);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `second-brain-jobs-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportState("downloaded");
      window.setTimeout(() => setExportState("idle"), 2_000);
    } catch (error) {
      console.error("Unable to export jobs CSV", error);
      setExportState("error");
      window.setTimeout(() => setExportState("idle"), 2_000);
    }
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-floral">
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-slate-900/5 px-6">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold leading-6 text-slate-950">Job Tracker</h1>
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
            title="Refresh jobs"
            type="button"
            onClick={() => void refreshJobs()}
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
          <div className="grid h-full place-items-center text-sm text-slate-500">Loading jobs...</div>
        ) : null}

        {loadState === "error" ? (
          <div className="grid h-full place-items-center">
            <div className="max-w-sm text-center">
              <AlertCircle className="mx-auto text-rose-500" size={28} />
              <h2 className="mt-3 text-base font-semibold text-slate-950">Jobs unavailable</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">The local job tracker could not be read.</p>
            </div>
          </div>
        ) : null}

        {loadState === "ready" && sortedJobs.length === 0 ? (
          <div className="grid h-full place-items-center">
            <div className="max-w-md text-center">
              <BriefcaseBusiness className="mx-auto text-slate-400" size={32} />
              <h2 className="mt-4 text-xl font-semibold text-slate-950">Drop a job post</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                The local model will extract company, role, date, and a short responsibilities summary.
              </p>
            </div>
          </div>
        ) : null}

        {loadState === "ready" && sortedJobs.length > 0 ? (
          <div className="max-w-full overflow-x-auto overflow-y-hidden rounded-lg border border-slate-200 bg-white/55 shadow-sm">
            <table className="w-full min-w-[1320px] border-collapse text-left text-sm">
              <thead className="border-b border-slate-200 bg-white/70 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Company</th>
                  <th className="px-4 py-3 font-semibold">Role</th>
                  <th className="px-4 py-3 font-semibold">Job Posted</th>
                  <th className="px-4 py-3 font-semibold">Application Date</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Resume</th>
                  <th className="px-4 py-3 font-semibold">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80">
                {sortedJobs.map((job) => (
                  <tr key={job.uuid} className="align-top transition hover:bg-white/70">
                    <td className="whitespace-nowrap px-4 py-4 font-semibold text-slate-950">{job.company}</td>
                    <td className="min-w-48 px-4 py-4 text-slate-800">{job.role}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-slate-600">{formatDate(job.job_posted)}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-slate-600">{formatDate(job.application_date)}</td>
                    <td className="px-4 py-4">
                      <select
                        className="h-9 rounded-md border border-slate-200 bg-white/75 px-2 text-sm font-medium text-slate-800 outline-none transition focus:border-slate-400"
                        value={job.status}
                        onChange={(event) =>
                          void updateJob({
                            uuid: job.uuid,
                            status: event.target.value as JobApplicationStatus
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
                    <td className="min-w-64 px-4 py-4">
                      <input
                        className="h-9 w-full rounded-md border border-slate-200 bg-white/75 px-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-400"
                        placeholder="Resume path"
                        type="text"
                        value={resumeDrafts[job.uuid] ?? job.resume}
                        onBlur={(event) => {
                          const nextResume = event.currentTarget.value.trim();
                          if (nextResume !== job.resume) {
                            void updateJob({
                              uuid: job.uuid,
                              resume: nextResume
                            });
                          }
                        }}
                        onChange={(event) =>
                          setResumeDrafts((current) => ({
                            ...current,
                            [job.uuid]: event.target.value
                          }))
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.currentTarget.blur();
                          }
                        }}
                      />
                    </td>
                    <td className="max-w-xl px-4 py-4 leading-6 text-slate-700">{job.description_summary}</td>
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
