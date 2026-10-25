import { describe, expect, it } from "vitest";
import { emptyWorkspace } from "../keymap/model";
import type { OledTask } from "../../runtime/types";
import { markOled, reconcileOled, unsettledOled } from "./model";
const task: OledTask = {
  request: {
    operationId: "oled-a",
    deviceId: "mock-x1",
    baseToken: "base-a",
    resourceId: "a".repeat(64),
    target: { kind: "modeDefault", mode: 0 },
  },
  resource: {
    resourceId: "a".repeat(64),
    width: 160,
    height: 80,
    frameCount: 1,
    intervalMs: 100,
    byteLength: 28672,
    crc32: 1,
  },
  filename: "test.png",
  createdAt: "2026-10-22T00:00:00Z",
  status: "pending",
  message: null,
};
describe("OLED task recovery", () => {
  it("retains resource and original request through pause and reload", () => {
    const workspace = { ...emptyWorkspace(), oledTasks: [task] };
    const paused = reconcileOled(workspace, {
      operationId: "oled-a",
      deviceId: "mock-x1",
      status: "paused",
      effect: "unknown",
      progress: 0.3,
      errorCode: "UPLOAD_PAUSED",
    });
    const reloaded = JSON.parse(JSON.stringify(paused));
    expect(reloaded.oledTasks[0].request).toEqual(task.request);
    expect(reloaded.oledTasks[0].resource).toEqual(task.resource);
    expect(unsettledOled(reloaded.oledTasks[0])).toBe(false);
  });
  it.each(["running", "paused", "failed"])(
    "ignores a late upload acknowledgement after %s",
    (status) => {
      const workspace = {
        ...emptyWorkspace(),
        oledTasks: [{ ...task, status }],
      };
      expect(markOled(workspace, "oled-a", "accepted")).toBe(workspace);
    },
  );
  it("does not downgrade a completed operation after a late response", () => {
    const workspace = { ...emptyWorkspace(), oledTasks: [task] };
    const complete = reconcileOled(workspace, {
      operationId: "oled-a",
      deviceId: "mock-x1",
      status: "completed",
      effect: "complete",
      progress: 1,
      errorCode: null,
    });
    expect(markOled(complete, "oled-a", "accepted")).toBe(complete);
    expect(markOled(complete, "oled-a", "uncertain")).toBe(complete);
  });
});
