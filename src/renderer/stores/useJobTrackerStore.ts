import { create } from "zustand";
import type { JobIngestionStatus, JobTrackerRecord } from "../../shared/ipc";

type JobTrackerState = {
  jobs: JobTrackerRecord[];
  status: JobIngestionStatus;
  setJobs: (jobs: JobTrackerRecord[]) => void;
  setStatus: (status: JobIngestionStatus) => void;
  upsertJob: (job: JobTrackerRecord) => void;
};

const idleStatus: JobIngestionStatus = {
  stage: "idle",
  message: "Drop a job description to extract metadata."
};

export const useJobTrackerStore = create<JobTrackerState>((set) => ({
  jobs: [],
  status: idleStatus,
  setJobs: (jobs) => set({ jobs }),
  setStatus: (status) => set({ status }),
  upsertJob: (job) =>
    set((state) => ({
      jobs: [job, ...state.jobs.filter((candidate) => candidate.uuid !== job.uuid)]
    }))
}));
