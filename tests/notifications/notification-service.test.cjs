const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { mkdtemp, rm } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  NotificationService,
  trackerNotificationBucket,
  trackerNotificationKey
} = require("../../dist/main/services/NotificationService.js");

function tracker(overrides = {}) {
  return {
    uuid: overrides.uuid ?? "tracker-1",
    title: overrides.title ?? "Finish paper notes",
    description: overrides.description ?? "Review local graph context",
    status: overrides.status ?? "todo",
    priority: "medium",
    labels: [],
    dueDate: overrides.dueDate,
    sourceNodeIds: [],
    sourceFiles: [],
    createdAt: "2026-07-16T10:00:00.000Z",
    updatedAt: "2026-07-16T10:00:00.000Z"
  };
}

function dueAt(minutes) {
  return new Date(Date.UTC(2026, 6, 16, 10, minutes, 0)).toISOString();
}

class FakeNotification extends EventEmitter {
  constructor(options, shown) {
    super();
    this.options = options;
    this.shown = shown;
  }

  show() {
    this.shown.push(this.options);
    this.emit("show");
  }
}

test("tracker notification buckets cover 60m, 15m, and due windows", () => {
  const now = new Date("2026-07-16T10:00:00.000Z");
  assert.equal(trackerNotificationBucket(tracker({ dueDate: dueAt(61) }), now), null);
  assert.equal(trackerNotificationBucket(tracker({ dueDate: dueAt(45) }), now), "60m");
  assert.equal(trackerNotificationBucket(tracker({ dueDate: dueAt(12) }), now), "15m");
  assert.equal(trackerNotificationBucket(tracker({ dueDate: dueAt(0) }), now), "due");
  assert.equal(trackerNotificationBucket(tracker({ dueDate: dueAt(-5) }), now), "due");
  assert.equal(trackerNotificationBucket(tracker({ dueDate: dueAt(12), status: "done" }), now), null);
});

test("tracker notification keys include due date so reschedules can notify again", () => {
  const first = tracker({ dueDate: dueAt(12) });
  const second = tracker({ dueDate: dueAt(20) });
  assert.notEqual(trackerNotificationKey(first, "15m"), trackerNotificationKey(second, "15m"));
});

test("notification service dedupes sent buckets and persists them", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "second-brain-notifications-"));
  const sentKeysPath = path.join(root, "tracker-notifications.json");
  const shown = [];
  const ticket = tracker({ dueDate: dueAt(12) });
  const trackerService = {
    listTrackers: async () => [ticket],
    undatedOpenCount: async () => 0
  };

  const options = {
    sentKeysPath,
    isSupported: () => true,
    createNotification: (notificationOptions) => new FakeNotification(notificationOptions, shown)
  };

  try {
    const service = new NotificationService(trackerService, options);
    await service.check(new Date("2026-07-16T10:00:00.000Z"));
    await service.check(new Date("2026-07-16T10:01:00.000Z"));
    assert.equal(shown.length, 1);

    const restarted = new NotificationService(trackerService, options);
    await restarted.check(new Date("2026-07-16T10:02:00.000Z"));
    assert.equal(shown.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("notification service skips tracker checks when notifications are unsupported", async () => {
  let listed = false;
  const service = new NotificationService(
    {
      listTrackers: async () => {
        listed = true;
        return [];
      },
      undatedOpenCount: async () => 0
    },
    {
      sentKeysPath: path.join(os.tmpdir(), "second-brain-unused-notifications.json"),
      isSupported: () => false,
      createNotification: () => {
        throw new Error("Should not create notifications.");
      }
    }
  );

  await service.check(new Date("2026-07-16T10:00:00.000Z"));
  assert.equal(listed, false);
});
