import type { SettingsDraft, SettingsTask } from "../settings/model";
import type { OledTask, OledDraft } from "../../runtime/types";
import type {
  Action,
  ConfigurationDocument,
  KeymapRequest,
  Operation,
} from "../../runtime/types";

export const roles = ["voice", "approve", "reject", "submit"] as const;
export const roleNames = ["Voice 键", "批准键", "拒绝键", "提交键"];
export interface DraftKey {
  action: Action | null;
  revision: number;
  dirty: boolean;
}
export interface DeviceDraft {
  keys: Record<string, DraftKey>;
  counter: number;
  synchronizedAt: string | null;
  history: { savedAt: string; keys: Record<string, DraftKey> }[];
}
export interface LocalTask {
  request: KeymapRequest;
  revisions: Record<string, number>;
  createdAt: string;
  status: string;
  message: string | null;
  reconciled: boolean;
}
export interface Workspace {
  version: 1;
  devices: Record<string, DeviceDraft>;
  tasks: LocalTask[];
  oledTasks: OledTask[];
  oledDrafts: Record<string, OledDraft>;
  settingsDrafts: Record<string, SettingsDraft>;
  settingsTasks: SettingsTask[];
}
export const emptyWorkspace = (): Workspace => ({
  version: 1,
  devices: {},
  tasks: [],
  oledTasks: [],
  oledDrafts: {},
  settingsDrafts: {},
  settingsTasks: [],
});
export const emptyDevice = (): DeviceDraft => ({
  keys: {},
  counter: 0,
  synchronizedAt: null,
  history: [],
});
export const keyId = (mode: number, index: number) => `${mode}:${index}`;
export function sameAction(a: Action | null, b: Action | null): boolean {
  const canonical = (action: Action | null) =>
    action?.type === "shortcut"
      ? { ...action, modifiers: [...action.modifiers].sort() }
      : action;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
export function observedAction(
  document: ConfigurationDocument,
  mode: number,
  index: number,
): Action | null {
  const modes = document.readback?.modes ?? document.configuration?.modes;
  return (
    modes
      ?.find((item) => item.mode === mode)
      ?.keys.find((key) => key.role === roles[index])?.action ?? null
  );
}
export function editAction(
  workspace: Workspace,
  deviceId: string,
  mode: number,
  index: number,
  action: Action,
): Workspace {
  const device = workspace.devices[deviceId] ?? emptyDevice();
  const next = device.counter + 1;
  return {
    ...workspace,
    devices: {
      ...workspace.devices,
      [deviceId]: {
        ...device,
        counter: next,
        keys: {
          ...device.keys,
          [keyId(mode, index)]: { action, revision: next, dirty: true },
        },
      },
    },
  };
}
export function refreshDevice(
  workspace: Workspace,
  document: ConfigurationDocument,
  now: string,
): Workspace {
  // A full read temporarily invalidates the cache. Keep the displayed baseline
  // until the result arrives, and always preserve edits made while it was reading.
  if (document.read?.status === "reading") return workspace;
  const device = workspace.devices[document.deviceId] ?? emptyDevice();
  const keys = { ...device.keys };
  let counter = device.counter;
  for (let mode = 0; mode < 4; mode++)
    for (let index = 0; index < 4; index++) {
      const id = keyId(mode, index);
      const current = keys[id];
      if (current?.dirty) continue;
      const action = observedAction(document, mode, index);
      if (current && sameAction(current.action, action)) continue;
      keys[id] = { action, revision: ++counter, dirty: false };
    }
  if (counter === device.counter) return workspace;
  return {
    ...workspace,
    devices: {
      ...workspace.devices,
      [document.deviceId]: { ...device, keys, counter, synchronizedAt: now },
    },
  };
}
export function restoreDraft(
  workspace: Workspace,
  deviceId: string,
): Workspace {
  const device = workspace.devices[deviceId];
  if (!device?.history.length) return workspace;
  let counter = device.counter;
  const keys = Object.fromEntries(
    Object.entries(device.history[0].keys).map(([id, key]) => [
      id,
      { ...key, revision: ++counter, dirty: key.action !== null },
    ]),
  );
  const history = [
    { savedAt: new Date().toISOString(), keys: structuredClone(device.keys) },
    ...device.history.slice(1),
  ].slice(0, 5);
  return {
    ...workspace,
    devices: {
      ...workspace.devices,
      [deviceId]: { ...device, keys, counter, history },
    },
  };
}
export function validateAction(action: Action): string | null {
  const keyValid = (key: number) =>
    Number.isInteger(key) && key >= 0 && key <= 255;
  if (action.type === "shortcut" && !keyValid(action.keyCode))
    return "键码需要是 0–255 的整数。";
  if (action.type === "macro") {
    if (!action.steps.length || action.steps.length > 49)
      return "宏需要包含 1–49 个步骤。";
    for (const step of action.steps) {
      if (
        (step.type === "keyDown" || step.type === "keyUp") &&
        !keyValid(step.keyCode)
      )
        return "宏键码需要是 0–255 的整数。";
      if (
        step.type === "delay" &&
        (!Number.isInteger(step.delayMs) ||
          step.delayMs < 0 ||
          step.delayMs > 765 ||
          step.delayMs % 3 !== 0)
      )
        return "宏延时需要为 0–765 毫秒，且为 3 的倍数。";
    }
  }
  return null;
}
export function prepareTask(
  workspace: Workspace,
  document: ConfigurationDocument,
  mode: number,
  operationId: string,
  now: string,
): LocalTask {
  const device = workspace.devices[document.deviceId] ?? emptyDevice();
  const keys: KeymapRequest["keys"] = [];
  const revisions: Record<string, number> = {};
  for (let index = 0; index < 4; index++) {
    const draft = device.keys[keyId(mode, index)];
    if (!draft?.dirty || !draft.action) continue;
    const error = validateAction(draft.action);
    if (error) throw new Error(error);
    keys.push({ index, action: structuredClone(draft.action) });
    revisions[keyId(mode, index)] = draft.revision;
  }
  if (!keys.length) throw new Error("当前模式没有待写入的键位。");
  return {
    request: {
      operationId,
      deviceId: document.deviceId,
      baseToken: document.baseToken,
      mode,
      keys,
    },
    revisions,
    createdAt: now,
    status: "pending",
    message: null,
    reconciled: false,
  };
}
export function retainTask(workspace: Workspace, task: LocalTask): Workspace {
  if (
    workspace.tasks.some(
      (item) => item.request.operationId === task.request.operationId,
    )
  )
    return workspace;
  return { ...workspace, tasks: [task, ...workspace.tasks] };
}
export function markTask(
  workspace: Workspace,
  id: string,
  status: string,
  message: string | null = null,
): Workspace {
  const task = workspace.tasks.find((item) => item.request.operationId === id);
  if (
    !task ||
    task.reconciled ||
    (task.status === status && task.message === message)
  )
    return workspace;
  if (task.status === "running" && status === "accepted") return workspace;
  return {
    ...workspace,
    tasks: workspace.tasks.map((item) =>
      item === task ? { ...task, status, message } : item,
    ),
  };
}
export function reconcileTask(
  workspace: Workspace,
  operation: Operation,
): Workspace {
  const task = workspace.tasks.find(
    (item) => item.request.operationId === operation.operationId,
  );
  if (!task || task.reconciled || task.request.deviceId !== operation.deviceId)
    return workspace;
  const terminal = ["completed", "failed", "cancelled"].includes(
    operation.status,
  );
  let updated = markTask(
    workspace,
    operation.operationId,
    operation.status,
    operation.errorCode,
  );
  if (!terminal) return updated;
  const device = updated.devices[operation.deviceId];
  if (
    operation.status === "completed" &&
    operation.effect === "complete" &&
    device
  ) {
    const keys = { ...device.keys };
    for (const submitted of task.request.keys) {
      const id = keyId(task.request.mode, submitted.index);
      const current = keys[id];
      // An old completion only acknowledges exactly the revision that was submitted.
      if (
        current &&
        current.revision === task.revisions[id] &&
        sameAction(current.action, submitted.action)
      )
        keys[id] = { ...current, dirty: false };
    }
    updated = {
      ...updated,
      devices: {
        ...updated.devices,
        [operation.deviceId]: { ...device, keys },
      },
    };
  }
  return {
    ...updated,
    tasks: updated.tasks.map((item) =>
      item.request.operationId === operation.operationId
        ? { ...item, reconciled: true }
        : item,
    ),
  };
}
export function unsettledTask(task: LocalTask): boolean {
  return ["pending", "accepted", "running", "uncertain", "paused"].includes(
    task.status,
  );
}
