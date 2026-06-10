import { create } from "zustand";
import type { TrackerIngestionStatus, TrackerRecord } from "../../shared/ipc";

type TrackerState = {
  trackers: TrackerRecord[];
  status: TrackerIngestionStatus;
  setTrackers: (trackers: TrackerRecord[]) => void;
  setStatus: (status: TrackerIngestionStatus) => void;
  upsertTracker: (tracker: TrackerRecord) => void;
  upsertTrackers: (trackers: TrackerRecord[]) => void;
};

const idleStatus: TrackerIngestionStatus = {
  stage: "idle",
  message: "Drop content with dates or times to start tracking."
};

export const useTrackerStore = create<TrackerState>((set) => ({
  trackers: [],
  status: idleStatus,
  setTrackers: (trackers) => set({ trackers }),
  setStatus: (status) => set({ status }),
  upsertTracker: (tracker) =>
    set((state) => ({
      trackers: [tracker, ...state.trackers.filter((candidate) => candidate.uuid !== tracker.uuid)]
    })),
  upsertTrackers: (trackers) =>
    set((state) => {
      const incoming = new Map(trackers.map((tracker) => [tracker.uuid, tracker]));

      return {
        trackers: [...trackers, ...state.trackers.filter((candidate) => !incoming.has(candidate.uuid))]
      };
    })
}));
