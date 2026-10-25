import { describe, expect, it } from "vitest";
import { emptyWorkspace } from "../keymap/model";
import type { ConfigurationDocument, Operation } from "../../runtime/types";
import {
  editField,
  observedFields,
  prepareSettings,
  reconcileSettings,
  restoreSettings,
  syncSettings,
  hasPendingWrites,
} from "./model";
const document: ConfigurationDocument = {
  deviceId: "x1",
  baseToken: "base",
  configuration: null,
  readback: {
    device: { brightnessPercent: 75 },
    modes: [
      { mode: 0, keys: [{ role: "voice", action: null, description: null }] },
    ],
  },
};
const done: Operation = {
  operationId: "task",
  deviceId: "x1",
  status: "completed",
  effect: "complete",
  progress: 1,
  errorCode: null,
};
describe("field drafts and scoped operations", () => {
  it("preserves unknown descriptions and archives drafts before an explicit sync", () => {
    const synced = syncSettings(emptyWorkspace(), document, "now");
    expect(synced.settingsDrafts.x1.fields.brightness.value).toBe(75);
    expect(synced.settingsDrafts.x1.fields["description:0:0"].value).toBeNull();
    const edited = editField(synced, "x1", "description:0:0", "Plan");
    const refreshed = syncSettings(edited, document, "later");
    const restored = restoreSettings(refreshed, "x1");
    expect(restored.settingsDrafts.x1.fields["description:0:0"]).toMatchObject({
      value: "Plan",
      dirty: true,
    });
    expect(restored.settingsTasks).toEqual([]);
  });
  it("freezes only changed fields and preserves newer revisions when completion arrives", () => {
    let state = syncSettings(emptyWorkspace(), document, "now");
    state = editField(state, "x1", "description:2:1", "");
    const task = prepareSettings(state, document, "task", "now");
    expect(task.request).toEqual({
      deviceId: "x1",
      baseToken: "base",
      operationId: "task",
      descriptions: [{ mode: 2, index: 1, description: "" }],
    });
    state = { ...state, settingsTasks: [task] };
    expect(hasPendingWrites(state, "x1")).toBe(true);
    state = editField(state, "x1", "description:2:1", "New draft");
    state = reconcileSettings(state, done);
    expect(state.settingsDrafts.x1.fields["description:2:1"]).toMatchObject({
      value: "New draft",
      dirty: true,
    });
    expect(hasPendingWrites(state, "x1")).toBe(false);
  });
  it("acknowledges the submitted brightness only, never another device or unknown effects", () => {
    let state = editField(emptyWorkspace(), "x1", "brightness", 57);
    const task = prepareSettings(state, document, "task", "now");
    expect(task.request.descriptions).toBeUndefined();
    state = { ...state, settingsTasks: [task] };
    expect(reconcileSettings(state, { ...done, deviceId: "other" })).toBe(
      state,
    );
    expect(
      reconcileSettings(state, { ...done, status: "failed", effect: "unknown" })
        .settingsDrafts.x1.fields.brightness.dirty,
    ).toBe(true);
    expect(
      reconcileSettings(state, done).settingsDrafts.x1.fields.brightness.dirty,
    ).toBe(false);
  });
  it.each([
    ["brightness", 0],
    ["brightness", 101],
    ["brightness", null],
    ["brightness", 1.5],
    ["description:0:0", "中文"],
    ["description:0:0", "x".repeat(21)],
  ] as const)(
    "rejects invalid %s values without preparing a request",
    (id, value) => {
      const state = editField(emptyWorkspace(), "x1", id, value);
      expect(() => prepareSettings(state, document, "task", "now")).toThrow();
    },
  );
  it("does not use an older complete baseline to fill an unknown readback", () => {
    const result = observedFields({
      ...document,
      configuration: {
        device: { brightnessPercent: 20 },
        modes: [
          {
            mode: 0,
            lights: [],
            keys: [
              {
                role: "voice",
                action: { type: "disabled" },
                description: "Old",
              },
            ],
          },
        ],
      },
    });
    expect(result.brightness).toBe(75);
    expect(result["description:0:0"]).toBeNull();
  });
});
