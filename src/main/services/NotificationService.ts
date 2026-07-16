import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Notification } from "electron";
import type { NotificationConstructorOptions } from "electron";
import type { TrackerRecord } from "../../shared/brain";
import type { TrackerService } from "./TrackerService";

const checkIntervalMs = 60_000;
const weeklyMs = 7 * 24 * 60 * 60_000;
const maxRetainedNotifications = 20;

export type TrackerNotificationBucket = "60m" | "15m" | "due";

type NativeNotification = InstanceType<typeof Notification>;
type NotificationFactory = (options: NotificationConstructorOptions) => NativeNotification;

export type NotificationServiceOptions = {
  sentKeysPath: string;
  iconPath?: string | undefined;
  platform?: NodeJS.Platform | undefined;
  activateApp?: (() => void) | undefined;
  isSupported?: (() => boolean) | undefined;
  createNotification?: NotificationFactory | undefined;
};

function compactText(value: string, maxLength: number): string {
  const compacted = value.replace(/\s+/g, " ").trim();
  return compacted.length <= maxLength ? compacted : `${compacted.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function contextSnippet(ticket: TrackerRecord): string {
  const linked = ticket.sourceNodeIds.slice(0, 3).join(", ");
  if (linked) {
    return linked;
  }

  return ticket.description || "No linked graph context yet";
}

function minutesUntilDue(ticket: TrackerRecord, now: Date): number | null {
  if (!ticket.dueDate || ticket.status === "done") {
    return null;
  }

  const due = new Date(ticket.dueDate).getTime();
  if (Number.isNaN(due)) {
    return null;
  }

  return Math.ceil((due - now.getTime()) / 60_000);
}

export function trackerNotificationBucket(ticket: TrackerRecord, now = new Date()): TrackerNotificationBucket | null {
  const remainingMinutes = minutesUntilDue(ticket, now);
  if (remainingMinutes === null || remainingMinutes > 60) {
    return null;
  }

  if (remainingMinutes > 15) {
    return "60m";
  }

  return remainingMinutes > 0 ? "15m" : "due";
}

export function trackerNotificationKey(ticket: TrackerRecord, bucket: TrackerNotificationBucket): string {
  return `${ticket.uuid}:${ticket.dueDate ?? "undated"}:${bucket}`;
}

function notificationTimingLabel(bucket: TrackerNotificationBucket, ticket: TrackerRecord, now: Date): string {
  const remainingMinutes = minutesUntilDue(ticket, now);
  if (bucket === "due" || remainingMinutes === null || remainingMinutes <= 0) {
    return "Due now";
  }

  return `Due in about ${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"}`;
}

function sentKeyRecord(value: unknown): { sentDueKeys: string[]; lastUndatedSummaryAt: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { sentDueKeys: [], lastUndatedSummaryAt: 0 };
  }

  const parsed = value as Record<string, unknown>;
  return {
    sentDueKeys: Array.isArray(parsed.sentDueKeys)
      ? parsed.sentDueKeys.filter((item): item is string => typeof item === "string")
      : [],
    lastUndatedSummaryAt: typeof parsed.lastUndatedSummaryAt === "number" ? parsed.lastUndatedSummaryAt : 0
  };
}

export class NotificationService {
  private interval: NodeJS.Timeout | null = null;
  private loadedState = false;
  private readonly sentDueKeys = new Set<string>();
  private lastUndatedSummaryAt = 0;
  private activeNotifications: NativeNotification[] = [];
  private readonly platform: NodeJS.Platform;
  private readonly isSupported: () => boolean;
  private readonly createNotification: NotificationFactory;

  constructor(
    private readonly tracker: Pick<TrackerService, "listTrackers" | "undatedOpenCount">,
    private readonly options: NotificationServiceOptions
  ) {
    this.platform = options.platform ?? process.platform;
    this.isSupported = options.isSupported ?? (() => Notification.isSupported());
    this.createNotification = options.createNotification ?? ((notificationOptions) => new Notification(notificationOptions));
  }

  start(): void {
    if (this.interval) {
      return;
    }

    this.registerActivationHandler();
    void this.check();
    this.interval = setInterval(() => {
      void this.check();
    }, checkIntervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.activeNotifications = [];
  }

  async check(now = new Date()): Promise<void> {
    if (!this.isSupported()) {
      return;
    }

    await this.loadState();

    try {
      const tickets = await this.tracker.listTrackers({ scope: "all" });
      for (const ticket of tickets) {
        const bucket = trackerNotificationBucket(ticket, now);
        if (!bucket) {
          continue;
        }

        const key = trackerNotificationKey(ticket, bucket);
        if (this.sentDueKeys.has(key)) {
          continue;
        }

        this.sentDueKeys.add(key);
        await this.saveState();
        this.showNotification({
          title: compactText(ticket.title || "Tracker item", 80),
          body: compactText(`${notificationTimingLabel(bucket, ticket, now)}. Context: ${contextSnippet(ticket)}`, 220),
          silent: false
        });
      }

      if (now.getTime() - this.lastUndatedSummaryAt >= weeklyMs) {
        const undatedCount = await this.tracker.undatedOpenCount();
        if (undatedCount > 0) {
          this.lastUndatedSummaryAt = now.getTime();
          await this.saveState();
          this.showNotification({
            title: "Second Brain Tracker",
            body: compactText(`${undatedCount} open tracker item${undatedCount === 1 ? "" : "s"} have no deadline.`, 220),
            silent: true
          });
        }
      }
    } catch (error) {
      console.warn("Tracker notification check failed.", error);
    }
  }

  private async loadState(): Promise<void> {
    if (this.loadedState) {
      return;
    }

    this.loadedState = true;
    try {
      const parsed = sentKeyRecord(JSON.parse(await readFile(this.options.sentKeysPath, "utf8")));
      for (const key of parsed.sentDueKeys) {
        this.sentDueKeys.add(key);
      }
      this.lastUndatedSummaryAt = parsed.lastUndatedSummaryAt;
    } catch {
      this.sentDueKeys.clear();
      this.lastUndatedSummaryAt = 0;
    }
  }

  private async saveState(): Promise<void> {
    const keys = Array.from(this.sentDueKeys).slice(-500);
    this.sentDueKeys.clear();
    for (const key of keys) {
      this.sentDueKeys.add(key);
    }

    await mkdir(path.dirname(this.options.sentKeysPath), { recursive: true });
    await writeFile(
      this.options.sentKeysPath,
      `${JSON.stringify({ sentDueKeys: keys, lastUndatedSummaryAt: this.lastUndatedSummaryAt }, null, 2)}\n`,
      "utf8"
    );
  }

  private showNotification(options: NotificationConstructorOptions): void {
    const notificationOptions = this.options.iconPath ? { ...options, icon: this.options.iconPath } : options;
    const notification = this.createNotification(notificationOptions);

    this.retainNotification(notification);
    notification.on("click", () => this.options.activateApp?.());
    notification.on("close", () => this.releaseNotification(notification));
    notification.on("failed", (_event, error) => {
      this.releaseNotification(notification);
      const hint =
        this.platform === "darwin"
          ? " macOS requires a signed app bundle for native notification delivery."
          : this.platform === "win32"
            ? " Windows may require a Start Menu shortcut with matching AppUserModelID and ToastActivatorCLSID."
            : "";
      console.warn(`Tracker notification failed.${hint}`, error);
    });
    notification.show();
  }

  private retainNotification(notification: NativeNotification): void {
    this.activeNotifications.push(notification);
    if (this.activeNotifications.length > maxRetainedNotifications) {
      this.activeNotifications = this.activeNotifications.slice(-maxRetainedNotifications);
    }
  }

  private releaseNotification(notification: NativeNotification): void {
    this.activeNotifications = this.activeNotifications.filter((candidate) => candidate !== notification);
  }

  private registerActivationHandler(): void {
    if (this.platform !== "win32") {
      return;
    }

    const notificationWithActivation = Notification as typeof Notification & {
      handleActivation?: (callback: () => void) => void;
    };
    notificationWithActivation.handleActivation?.(() => this.options.activateApp?.());
  }
}
