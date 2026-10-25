import type { OledTarget, OledTask, Operation } from "../../runtime/types";
import type { Workspace } from "../keymap/model";
export function targetLabel(target: OledTarget): string {
  const states = { working: "工作中", waiting: "等待中", done: "已完成" };
  if (target.kind === "modeDefault")
    return `模式 ${target.mode + 1} · 默认画面`;
  if (target.kind === "multiState") return `多任务 · ${states[target.state]}`;
  return `模式 ${target.mode + 1} · ${states[target.state]}`;
}
export function unsettledOled(task: OledTask): boolean {
  return ["pending", "accepted", "running", "uncertain"].includes(task.status);
}
export function markOled(
  workspace: Workspace,
  id: string,
  status: string,
  message: string | null = null,
): Workspace {
  const task = workspace.oledTasks.find(
    (item) => item.request.operationId === id,
  );
  if (
    !task ||
    task.status === "completed" ||
    (task.status === status && task.message === message) ||
    (status === "accepted" && !["pending", "uncertain"].includes(task.status))
  )
    return workspace;
  return {
    ...workspace,
    oledTasks: workspace.oledTasks.map((item) =>
      item === task ? { ...task, status, message } : item,
    ),
  };
}
export function reconcileOled(
  workspace: Workspace,
  operation: Operation,
): Workspace {
  const task = workspace.oledTasks.find(
    (item) => item.request.operationId === operation.operationId,
  );
  if (!task || task.request.deviceId !== operation.deviceId) return workspace;
  return markOled(
    workspace,
    operation.operationId,
    operation.status,
    operation.errorCode,
  );
}
