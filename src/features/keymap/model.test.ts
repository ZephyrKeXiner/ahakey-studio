import { describe, expect, it } from "vitest";
import type {
  Action,
  ConfigurationDocument,
  Operation,
} from "../../runtime/types";
import {
  editAction,
  emptyWorkspace,
  keyId,
  markTask,
  observedAction,
  prepareTask,
  reconcileTask,
  restoreDraft,
  retainTask,
  refreshDevice,
  validateAction,
} from "./model";

const shortcut = (keyCode: number): Action => ({
  type: "shortcut",
  modifiers: [],
  keyCode,
});
const document: ConfigurationDocument = {
  deviceId: "x1-test",
  baseToken: "base-a",
  configuration: null,
  readback: {
    modes: [
      {
        mode: 0,
        keys: [
          { role: "voice", action: shortcut(4), description: "A" },
          { role: "approve", action: null, description: null },
        ],
      },
    ],
  },
};
const completed: Operation = {
  operationId: "task-a",
  deviceId: "x1-test",
  status: "completed",
  effect: "complete",
  progress: 1,
  errorCode: null,
};

function pending() {
  const draft = editAction(emptyWorkspace(), "x1-test", 0, 0, shortcut(5));
  const task = prepareTask(draft, document, 0, "task-a", "2026-10-22");
  return retainTask(draft, task);
}
describe("keymap revisions and durable task identity", () => {
  it("keeps unobserved keys unknown when syncing a partial read", () => {
    const next = refreshDevice(emptyWorkspace(), document, "now");
    expect(next.devices["x1-test"].keys[keyId(0, 0)].action).toEqual(
      shortcut(4),
    );
    expect(next.devices["x1-test"].keys[keyId(0, 1)].action).toBeNull();
    expect(next.devices["x1-test"].keys[keyId(3, 3)].action).toBeNull();
    expect(observedAction(document, 0, 1)).toBeNull();
  });
  it("freezes only changed keys and does not mutate the request when editing continues", () => {
    const frozen = pending();
    const edited = editAction(frozen, "x1-test", 0, 0, shortcut(6));
    expect(edited.tasks[0].request.keys).toEqual([
      { index: 0, action: shortcut(5) },
    ]);
    expect(edited.tasks[0].request.baseToken).toBe("base-a");
    expect(Object.keys(edited.tasks[0].request)).not.toContain(
      "brightnessPercent",
    );
  });
  it("keeps newer edits dirty when the old operation completes", () => {
    const edited = editAction(pending(), "x1-test", 0, 0, shortcut(6));
    const next = reconcileTask(edited, completed);
    expect(next.devices["x1-test"].keys["0:0"]).toMatchObject({
      action: shortcut(6),
      dirty: true,
    });
    expect(next.tasks[0].reconciled).toBe(true);
  });
  it("also preserves a new revision changed back to the submitted value", () => {
    const edited = editAction(
      editAction(pending(), "x1-test", 0, 0, shortcut(6)),
      "x1-test",
      0,
      0,
      shortcut(5),
    );
    expect(
      reconcileTask(edited, completed).devices["x1-test"].keys["0:0"].dirty,
    ).toBe(true);
  });
  it("clears exactly the submitted revision and ignores a late accepted response", () => {
    const next = reconcileTask(pending(), completed);
    expect(next.devices["x1-test"].keys["0:0"].dirty).toBe(false);
    expect(markTask(next, "task-a", "accepted")).toBe(next);
    expect(reconcileTask(next, completed)).toBe(next);
  });
  it("never clears drafts on failed or unknown completion", () => {
    expect(
      reconcileTask(pending(), {
        ...completed,
        status: "failed",
        effect: "unknown",
        errorCode: "RUNTIME_RESTARTED",
      }).devices["x1-test"].keys["0:0"].dirty,
    ).toBe(true);
    expect(
      reconcileTask(pending(), { ...completed, effect: "unknown" }).devices[
        "x1-test"
      ].keys["0:0"].dirty,
    ).toBe(true);
  });
  it("refreshes clean keys while retaining dirty revisions and pending requests", () => {
    const before = pending();
    const next = refreshDevice(before, document, "now");
    expect(next.devices["x1-test"].keys["0:0"]).toEqual(
      before.devices["x1-test"].keys["0:0"],
    );
    expect(next.tasks).toBe(before.tasks);
    expect(next.devices["x1-test"].keys["0:1"].action).toBeNull();
    expect(refreshDevice(next, document, "later")).toBe(next);
    const acknowledged = reconcileTask(next, completed);
    const refreshed = refreshDevice(acknowledged, document, "later");
    expect(refreshed.devices["x1-test"].keys["0:0"]).toMatchObject({
      action: shortcut(4),
      dirty: false,
    });
  });
  it("keeps the last displayed baseline while a hardware read is in progress", () => {
    const before = refreshDevice(emptyWorkspace(), document, "now");
    const reading: ConfigurationDocument = {
      ...document,
      readback: undefined,
      read: { status: "reading", attempt: 1, maxAttempts: 3, errorCode: null },
    };
    expect(refreshDevice(before, reading, "later")).toBe(before);
  });
  it("can still restore a draft saved by an older Studio version", () => {
    const before = editAction(emptyWorkspace(), "x1-test", 0, 0, shortcut(6));
    const synced = refreshDevice(emptyWorkspace(), document, "now");
    synced.devices["x1-test"].history = [
      { savedAt: "before", keys: before.devices["x1-test"].keys },
    ];
    const restored = restoreDraft(synced, "x1-test");
    expect(restored.devices["x1-test"].keys["0:0"]).toMatchObject({
      action: shortcut(6),
      dirty: true,
    });
    expect(restored.tasks).toEqual([]);
  });
  it("recovers a pending operation after serializing and reopening the workspace", () => {
    const reloaded = JSON.parse(JSON.stringify(pending()));
    const recovered = reconcileTask(reloaded, completed);
    expect(recovered.tasks[0].request.operationId).toBe("task-a");
    expect(recovered.devices["x1-test"].keys["0:0"].dirty).toBe(false);
    expect(
      reconcileTask(pending(), { ...completed, deviceId: "another-device" })
        .tasks[0].reconciled,
    ).toBe(false);
  });
  it("validates macro limits without rounding or truncating the user's steps", () => {
    expect(
      validateAction({
        type: "macro",
        steps: [{ type: "delay", delayMs: 31 }],
      }),
    ).not.toBeNull();
    expect(
      validateAction({
        type: "macro",
        steps: [{ type: "delay", delayMs: 30 }],
      }),
    ).toBeNull();
    expect(
      validateAction({
        type: "macro",
        steps: Array.from({ length: 50 }, () => ({ type: "noOp" })),
      }),
    ).not.toBeNull();
    expect(validateAction(shortcut(256))).not.toBeNull();
    expect(validateAction(shortcut(0))).toBeNull();
  });
});
