import { Dialog } from "../../components/Dialog";
import type { ClientView } from "../../runtime/types";
import type { WorkspaceController } from "../keymap/useWorkspace";
import { targetLabel } from "../oled/model";
import { useOperationControl } from "./useOperationControl";
export function OperationDialog({
  id,
  runtime,
  controller,
  onClose,
}: {
  id: string;
  runtime: ClientView;
  controller: WorkspaceController;
  onClose: () => void;
}) {
  const { busy, error, query, control } = useOperationControl(
    id,
    runtime,
    controller,
  );
  const task = controller.workspace.oledTasks.find(
    (task) => task.request.operationId === id,
  );
  const operation = runtime.inspection?.snapshot.operations.find(
    (operation) => operation.operationId === id,
  );
  if (!task) return null;
  const online = runtime.status === "connected";
  const status = operation?.status ?? task.status;
  const active = ["accepted", "running"].includes(status);
  const ready =
    online &&
    runtime.inspection?.snapshot.devices.some(
      (device) =>
        device.deviceId === task.request.deviceId &&
        device.connectionState === "ready",
    );
  const progress = operation
    ? Math.round(Math.max(0, Math.min(1, operation.progress)) * 100)
    : 0;
  const completed = status === "completed" && operation?.effect === "complete";
  const title = !online
    ? "连接已中断"
    : completed
      ? "画面已写入"
      : status === "paused"
        ? "上传已暂停"
        : active
          ? "正在上传画面"
          : status === "pending"
            ? "正在提交上传"
            : "核对上传结果";
  return (
    <Dialog
      title={title}
      onClose={onClose}
      actions={
        <>
          <button className="secondary-button" onClick={onClose} autoFocus>
            {active ? "返回编辑，后台继续" : "返回编辑"}
          </button>
          {active ? (
            <button
              className="primary-button"
              disabled={!online || busy}
              onClick={() => void control(false)}
            >
              {busy ? "正在请求暂停…" : "暂停写入并恢复键盘"}
            </button>
          ) : null}
          {status === "paused" ? (
            <button
              className="primary-button"
              disabled={!ready || busy || !!controller.storageError}
              onClick={() => void control(true)}
            >
              {busy ? "正在核对…" : "继续上传"}
            </button>
          ) : null}
          {["pending", "uncertain"].includes(status) ? (
            <button
              className="primary-button"
              disabled={!online || busy}
              onClick={() => void query()}
            >
              查询原任务
            </button>
          ) : null}
        </>
      }
    >
      <p>
        {targetLabel(task.request.target)}，{task.filename}
      </p>
      <div className="operation-progress dialog-progress">
        <progress max="100" value={progress} aria-label="上传进度" />
        <strong>{progress}%</strong>
      </div>
      {!online ? (
        <p className="inline-notice">
          当前显示上次记录。原任务已保留，重新连接后自动核对；不会重新提交上传。
        </p>
      ) : null}
      {active ? (
        <p>
          上传期间设备部分控制暂不可用。暂停会由 Runtime
          结束上传事务并重新核对键盘连接。
        </p>
      ) : null}
      {status === "paused" ? (
        <p className="inline-notice">
          {ready
            ? "键盘控制已恢复。继续时先核对目标，已成功的资源会跳过。"
            : "正在恢复并核对键盘控制状态；连接恢复后可以继续。"}
        </p>
      ) : null}
      {status === "paused" && operation?.effect === "unknown" ? (
        <p>目标画面的写入结果仍待核对，暂停不会回滚已写入内容。</p>
      ) : null}
      {completed ? <p>画面已写入并通过校验。</p> : null}
      {error || task.message ? (
        <p className="inline-error" role="alert">
          {error ?? task.message}
        </p>
      ) : null}
      <details className="secondary-details">
        <summary>任务标识</summary>
        <code className="operation-id">{id}</code>
      </details>
    </Dialog>
  );
}
