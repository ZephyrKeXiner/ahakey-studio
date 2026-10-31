import type {
  ConfigurationDocument,
  ConfigurationPatch,
  Operation,
} from "../../runtime/types";
import type { Workspace } from "../keymap/model";
const roles = ["voice", "approve", "reject", "submit"];
const names = ["Voice 键", "批准键", "拒绝键", "提交键"];
export type FieldValue = string | number | null;
export interface DraftField {
  value: FieldValue;
  revision: number;
  dirty: boolean;
}
export interface SettingsDraft {
  fields: Record<string, DraftField>;
  counter: number;
  history: { savedAt: string; fields: Record<string, DraftField> }[];
}
export interface SettingsTask {
  request: ConfigurationPatch;
  revisions: Record<string, number>;
  createdAt: string;
  status: string;
  message: string | null;
  reconciled: boolean;
}
export const descriptionId = (mode: number, index: number) =>
  `description:${mode}:${index}`;
export const fieldIds = [
  "brightness",
  ...Array.from({ length: 16 }, (_, index) =>
    descriptionId(Math.floor(index / 4), index % 4),
  ),
];
const empty = (): SettingsDraft => ({ fields: {}, counter: 0, history: [] });
export function fieldLabel(id: string): string {
  if (id === "brightness") return "全局亮度";
  const [, mode, index] = id.split(":").map(Number);
  return `模式 ${mode + 1}，${names[index]}描述`;
}
export function formatField(value: FieldValue, id: string): string {
  return value === null
    ? "未知"
    : id === "brightness"
      ? `${value}%`
      : value === ""
        ? "空描述"
        : String(value);
}
export function observedFields(
  document: ConfigurationDocument,
): Record<string, FieldValue> {
  const result: Record<string, FieldValue> = {};
  result.brightness = document.readback
    ? (document.readback.device?.brightnessPercent ?? null)
    : (document.configuration?.device.brightnessPercent ?? null);
  const modes = document.readback?.modes ?? document.configuration?.modes;
  for (let mode = 0; mode < 4; mode++)
    for (let index = 0; index < 4; index++)
      result[descriptionId(mode, index)] =
        modes
          ?.find((item) => item.mode === mode)
          ?.keys.find((key) => key.role === roles[index])?.description ?? null;
  return result;
}
export function validateField(id: string, value: FieldValue): string | null {
  if (!fieldIds.includes(id)) return "未知设置项目。";
  if (id === "brightness")
    return typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 100
      ? null
      : "亮度需要是 1–100 的整数。";
  return typeof value === "string" &&
    value.length <= 20 &&
    /^[\x00-\x7F]*$/.test(value)
    ? null
    : "描述最多 20 个 ASCII 字符，可使用英文字母、数字和符号。";
}
export function editField(
  workspace: Workspace,
  deviceId: string,
  id: string,
  value: FieldValue,
): Workspace {
  if (!fieldIds.includes(id)) throw new Error("未知设置项目。");
  const draft = workspace.settingsDrafts[deviceId] ?? empty();
  const counter = draft.counter + 1;
  return {
    ...workspace,
    settingsDrafts: {
      ...workspace.settingsDrafts,
      [deviceId]: {
        ...draft,
        counter,
        fields: {
          ...draft.fields,
          [id]: { value, dirty: true, revision: counter },
        },
      },
    },
  };
}
export function syncSettings(
  workspace: Workspace,
  document: ConfigurationDocument,
  now: string,
): Workspace {
  const draft = workspace.settingsDrafts[document.deviceId] ?? empty();
  let counter = draft.counter;
  const fields = Object.fromEntries(
    Object.entries(observedFields(document)).map(([id, value]) => [
      id,
      { value, dirty: false, revision: ++counter },
    ]),
  );
  const history = Object.values(draft.fields).some((field) => field.dirty)
    ? [
        { savedAt: now, fields: structuredClone(draft.fields) },
        ...draft.history,
      ].slice(0, 5)
    : draft.history;
  return {
    ...workspace,
    settingsDrafts: {
      ...workspace.settingsDrafts,
      [document.deviceId]: { fields, counter, history },
    },
  };
}
export function restoreSettings(
  workspace: Workspace,
  deviceId: string,
): Workspace {
  const draft = workspace.settingsDrafts[deviceId];
  if (!draft?.history.length) return workspace;
  let counter = draft.counter;
  const fields = Object.fromEntries(
    Object.entries(draft.history[0].fields).map(([id, field]) => [
      id,
      { ...field, revision: ++counter, dirty: field.value !== null },
    ]),
  );
  return {
    ...workspace,
    settingsDrafts: {
      ...workspace.settingsDrafts,
      [deviceId]: {
        fields,
        counter,
        history: [
          {
            savedAt: new Date().toISOString(),
            fields: structuredClone(draft.fields),
          },
          ...draft.history.slice(1),
        ].slice(0, 5),
      },
    },
  };
}
export function submittedFields(
  request: ConfigurationPatch,
): Record<string, FieldValue> {
  const fields: Record<string, FieldValue> = {};
  if (request.brightnessPercent !== undefined)
    fields.brightness = request.brightnessPercent;
  for (const field of request.descriptions ?? [])
    fields[descriptionId(field.mode, field.index)] = field.description;
  return fields;
}
export function prepareSettings(
  workspace: Workspace,
  document: ConfigurationDocument,
  id: string,
  now: string,
): SettingsTask {
  const request: ConfigurationPatch = {
    operationId: id,
    deviceId: document.deviceId,
    baseToken: document.baseToken,
  };
  const revisions: Record<string, number> = {};
  for (const [id, field] of Object.entries(
    workspace.settingsDrafts[document.deviceId]?.fields ?? {},
  )) {
    if (!field.dirty) continue;
    const error = validateField(id, field.value);
    if (error) throw new Error(error);
    revisions[id] = field.revision;
    if (id === "brightness") request.brightnessPercent = field.value as number;
    else {
      const [, mode, index] = id.split(":").map(Number);
      (request.descriptions ??= []).push({
        mode,
        index,
        description: field.value as string,
      });
    }
  }
  if (!Object.keys(revisions).length) throw new Error("没有待写入的设置。");
  request.descriptions?.sort((a, b) => a.mode - b.mode || a.index - b.index);
  return {
    request,
    revisions,
    createdAt: now,
    status: "pending",
    message: null,
    reconciled: false,
  };
}
export function markSettings(
  workspace: Workspace,
  id: string,
  status: string,
  message: string | null = null,
): Workspace {
  const task = workspace.settingsTasks.find(
    (item) => item.request.operationId === id,
  );
  if (
    !task ||
    task.reconciled ||
    (task.status === status && task.message === message) ||
    (task.status === "running" && status === "accepted")
  )
    return workspace;
  return {
    ...workspace,
    settingsTasks: workspace.settingsTasks.map((item) =>
      item === task ? { ...item, status, message } : item,
    ),
  };
}
export function reconcileSettings(
  workspace: Workspace,
  operation: Operation,
): Workspace {
  const task = workspace.settingsTasks.find(
    (item) => item.request.operationId === operation.operationId,
  );
  if (!task || task.reconciled || task.request.deviceId !== operation.deviceId)
    return workspace;
  let updated = markSettings(
    workspace,
    operation.operationId,
    operation.status,
    operation.errorCode,
  );
  if (!["completed", "failed", "cancelled"].includes(operation.status))
    return updated;
  const draft = updated.settingsDrafts[operation.deviceId];
  if (
    operation.status === "completed" &&
    operation.effect === "complete" &&
    draft
  ) {
    const fields = { ...draft.fields };
    for (const [id, value] of Object.entries(submittedFields(task.request))) {
      const current = fields[id];
      if (
        current &&
        current.revision === task.revisions[id] &&
        current.value === value
      )
        fields[id] = { ...current, dirty: false };
    }
    updated = {
      ...updated,
      settingsDrafts: {
        ...updated.settingsDrafts,
        [operation.deviceId]: { ...draft, fields },
      },
    };
  }
  return {
    ...updated,
    settingsTasks: updated.settingsTasks.map((item) =>
      item.request.operationId === operation.operationId
        ? { ...item, reconciled: true }
        : item,
    ),
  };
}
export const unsettledSettings = (task: SettingsTask) =>
  ["pending", "accepted", "running", "uncertain", "paused"].includes(
    task.status,
  );
export function hasPendingWrites(
  workspace: Workspace,
  deviceId: string,
): boolean {
  return [
    ...workspace.tasks,
    ...workspace.oledTasks,
    ...workspace.settingsTasks,
  ].some(
    (task) =>
      task.request.deviceId === deviceId &&
      ["pending", "accepted", "running", "uncertain"].includes(task.status),
  );
}
