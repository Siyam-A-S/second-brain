import { create } from "zustand";
import type { TrackerRecord } from "../../shared/ipc";

type TrackerState = {
  trackers: TrackerRecord[];
  setTrackers: (trackers: TrackerRecord[]) => void;
  upsertTracker: (tracker: TrackerRecord) => void;
  upsertTrackers: (trackers: TrackerRecord[]) => void;
  removeTracker: (uuid: string) => void;
};

export const useTrackerStore = create<TrackerState>((set) => ({
  trackers: [],
  setTrackers: (trackers) => set({ trackers }),
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
    }),
  removeTracker: (uuid) =>
    set((state) => ({
      trackers: state.trackers.filter((tracker) => tracker.uuid !== uuid)
    }))
}));
