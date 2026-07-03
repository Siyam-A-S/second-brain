import { Notification } from "electron";
import type { TrackerRecord } from "../../shared/brain";
import type { TrackerService } from "./TrackerService";

const fiveMinutesMs = 5 * 60_000;
const weeklyMs = 7 * 24 * 60 * 60_000;

function contextSnippet(ticket: TrackerRecord): string {
  const linked = ticket.sourceNodeIds.slice(0, 3).join(", ");
  if (linked) {
    return linked;
  }

  return ticket.description.slice(0, 120) || "No linked graph context yet";
}

function notificationKey(ticket: TrackerRecord, now = new Date()): string {
  const due = ticket.dueDate ? new Date(ticket.dueDate).getTime() : 0;
  const remainingMinutes = due ? Math.round((due - now.getTime()) / 60_000) : 0;
  const bucket = remainingMinutes <= 20 ? "15m" : "60m";
  return `${ticket.uuid}:${bucket}`;
}

export class NotificationService {
  private interval: NodeJS.Timeout | null = null;
  private readonly sentDueKeys = new Set<string>();
  private lastUndatedSummaryAt = 0;

  constructor(private readonly tracker: TrackerService) {}

  start(): void {
    if (this.interval) {
      return;
    }

    void this.check();
    this.interval = setInterval(() => {
      void this.check();
    }, fiveMinutesMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async check(now = new Date()): Promise<void> {
    if (!Notification.isSupported()) {
      return;
    }

    try {
      const dueSoon = await this.tracker.dueSoon(now);
      for (const ticket of dueSoon) {
        const key = notificationKey(ticket, now);
        if (this.sentDueKeys.has(key)) {
          continue;
        }

        this.sentDueKeys.add(key);
        new Notification({
          title: ticket.title,
          body: `Due soon. Context: ${contextSnippet(ticket)}`
        }).show();
      }

      if (now.getTime() - this.lastUndatedSummaryAt >= weeklyMs) {
        const undatedCount = await this.tracker.undatedOpenCount();
        if (undatedCount > 0) {
          this.lastUndatedSummaryAt = now.getTime();
          new Notification({
            title: "Second Brain Tracker",
            body: `${undatedCount} open tracker item${undatedCount === 1 ? "" : "s"} have no deadline.`
          }).show();
        }
      }
    } catch (error) {
      console.warn("Tracker notification check failed.", error);
    }
  }
}
