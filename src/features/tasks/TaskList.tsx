import { useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  fieldLabel,
  submittedFields,
  type SettingsTask,
} from "../settings/model";
import { useOperationControl } from "./useOperationControl";
import type { ClientView, OledTask, Operation } from "../../runtime/types";
import { roleNames, type LocalTask } from "../keymap/model";
import type { WorkspaceController } from "../keymap/useWorkspace";
import { targetLabel } from "../oled/model";

const statuses: Record<string, string> = {
  pending: "准备提交",
  accepted: "已受理",
  running: "执行中",
  completed: "已完成",
  failed: "失败",
  paused: "已暂停",
  cancelled: "已取消",
  uncertain: "待确认",
  rejected: "未受理",
};
function TaskRow({
  operation,
  keymap,
  oled,
  settings,
  runtime,
  controller,
}: {
  operation?: Operation;
  keymap?: LocalTask;
  oled?: OledTask;
  settings?: SettingsTask;
  runtime: ClientView;
  controller: WorkspaceController;
}) {
  const [confirmResume, setConfirmResume] = useState(false);
  const configuration = operation?.configurationProgress;
  const local = keymap ?? oled ?? settings;
  const id = operation?.operationId ?? local!.request.operationId;
  const { busy, error, query, control } = useOperationControl(
    id,
    runtime,
    controller,
  );
  const status = operation?.status ?? local?.status ?? "uncertain";
  const online = runtime.status === "connected";
  const deviceId = operation?.deviceId ?? local!.request.deviceId;
  const ready = runtime.inspection?.snapshot.devices.some(
    (device) =>
      device.deviceId === deviceId && device.connectionState === "ready",
  );
  const percentage = operation
    ? Math.round(Math.max(0, Math.min(1, operation.progress)) * 100)
    : null;
  return (
    <li className="operation-row">
      <div className="operation-heading">
        <strong>{statuses[status] ?? status}</strong>
        <span className="operation-device">
          {keymap
            ? `模式 ${keymap.request.mode + 1} · ${keymap.request.keys.map((key) => roleNames[key.index]).join("、")}`
            : oled
              ? `屏幕 · ${targetLabel(oled.request.target)}`
              : settings
                ? Object.keys(submittedFields(settings.request))
                    .map(fieldLabel)
                    .join("、")
                : deviceId}
        </span>
        {local &&
        ["pending", "uncertain", "accepted", "running", "paused"].includes(
          status,
        ) ? (
          <button
            className="text-button"
            disabled={!online || busy}
            onClick={() => void query()}
          >
            查询结果
          </button>
        ) : null}
        {(oled || configuration) && ["accepted", "running"].includes(status) ? (
          <button
            className="secondary-button"
            disabled={!online || busy}
            onClick={() => void control(false)}
          >
            {busy ? "处理中…" : oled ? "暂停上传" : "暂停配置写入"}
          </button>
        ) : null}
        {(oled || configuration) && status === "paused" ? (
          <button
            className="secondary-button"
            disabled={!online || !ready || busy || !!controller.storageError}
            onClick={() =>
              configuration ? setConfirmResume(true) : void control(true)
            }
          >
            {busy ? "处理中…" : oled ? "继续上传" : "核验并继续配置"}
          </button>
        ) : null}
      </div>
      {percentage != null ? (
        <div className="operation-progress">
          <progress max="100" value={percentage} aria-label="任务进度" />
          <span>{percentage}%</span>
        </div>
      ) : null}
      <code>{id}</code>
      {configuration ? (
        <p className="field-hint">
          已获确认 {configuration.fieldsAcknowledged} /{" "}
          {configuration.fieldsTotal} 项 · 已读回核验{" "}
          {configuration.fieldsVerified} 项 ·{" "}
          {configuration.saveAcknowledged ? "保存命令已确认" : "保存命令待确认"}
          {configuration.phase === "verifying" ? " · 正在核验设备" : ""}
        </p>
      ) : null}
      {configuration && status === "paused" ? (
        <p className="field-hint">
          暂停保留原任务；继续前核对设备，已一致的字段会跳过。尚未确认保存的修改可能在设备断电后丢失。
        </p>
      ) : null}
      {configuration?.saveAcknowledged ? (
        <p className="field-hint">保存命令确认不等于已验证断电保留。</p>
      ) : null}
      {confirmResume ? (
        <ConfirmDialog
          title="继续本次配置写入？"
          confirmLabel="核验并继续"
          onClose={() => setConfirmResume(false)}
          onConfirm={() => {
            setConfirmResume(false);
            void control(true);
          }}
        >
          <p>
            继续原任务中已确认的修改。Runtime
            会先读回全部目标字段，跳过已经一致的项目，只续写剩余项目。
          </p>
          <p>
            发现外部修改或无法读取的字段时会停下来；编辑区的新草稿不会加入本次任务。
          </p>
        </ConfirmDialog>
      ) : null}
      {oled ? (
        <p className="field-hint">
          {oled.filename} · {oled.resource.frameCount} 帧
        </p>
      ) : null}
      {operation?.effect === "unknown" &&
      !["accepted", "running"].includes(status) ? (
        <p className="warning-text">
          {oled
            ? "设备写入结果尚未确定。继续上传时，Runtime 会先核对目标位置再决定是否重传。"
            : "设备写入结果尚未确定，请保留原任务并核对设备当前结果。"}
        </p>
      ) : null}
      {local?.message || operation?.errorCode ? (
        <p className="warning-text">
          {(
            {
              CONFIGURATION_PAUSED: "已在完整字段写入后暂停。",
              CONFIGURATION_CONFLICT:
                "设备中有其他修改。请先读取并核对，再创建新的修改任务。",
              CONFIGURATION_UNVERIFIABLE:
                "设备无法提供续写所需的读回结果，本次未继续写入。",
              CONFIGURATION_VERIFY_FAILED:
                "设备读回值与本次修改不一致，保存尚未完成。",
            } as Record<string, string>
          )[operation?.errorCode ?? local?.message ?? ""] ??
            local?.message ??
            operation?.errorCode}
        </p>
      ) : null}
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}
export function Tasks({
  runtime,
  controller,
}: {
  runtime: ClientView;
  controller: WorkspaceController;
}) {
  const operations = runtime.inspection?.snapshot.operations ?? [];
  const orphanKeys = controller.workspace.tasks.filter(
    (task) =>
      !operations.some((op) => op.operationId === task.request.operationId),
  );
  const orphanOled = controller.workspace.oledTasks.filter(
    (task) =>
      !operations.some((op) => op.operationId === task.request.operationId),
  );
  const orphanSettings = controller.workspace.settingsTasks.filter(
    (task) =>
      !operations.some(
        (operation) => operation.operationId === task.request.operationId,
      ),
  );
  const count =
    operations.length +
    orphanKeys.length +
    orphanOled.length +
    orphanSettings.length;
  return (
    <section id="tasks" className="section">
      <div className="section-heading">
        <h2>
          任务记录 <span>{count.toString().padStart(2, "0")}</span>
        </h2>
        <span>受理后由 Runtime 持续执行</span>
      </div>
      {count ? (
        <ul className="operations">
          {orphanKeys.map((task) => (
            <TaskRow
              key={task.request.operationId}
              keymap={task}
              runtime={runtime}
              controller={controller}
            />
          ))}
          {orphanOled.map((task) => (
            <TaskRow
              key={task.request.operationId}
              oled={task}
              runtime={runtime}
              controller={controller}
            />
          ))}
          {orphanSettings.map((task) => (
            <TaskRow
              key={task.request.operationId}
              settings={task}
              runtime={runtime}
              controller={controller}
            />
          ))}
          {operations.map((op) => (
            <TaskRow
              key={op.operationId}
              operation={op}
              settings={controller.workspace.settingsTasks.find(
                (task) => task.request.operationId === op.operationId,
              )}
              keymap={controller.workspace.tasks.find(
                (task) => task.request.operationId === op.operationId,
              )}
              oled={controller.workspace.oledTasks.find(
                (task) => task.request.operationId === op.operationId,
              )}
              runtime={runtime}
              controller={controller}
            />
          ))}
        </ul>
      ) : (
        <div className="empty-tasks">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>
              {runtime.status === "connected"
                ? "暂无任务记录"
                : "等待连接 Runtime"}
            </strong>
            <p>写入前保存任务 ID，重连后核对原任务结果。</p>
          </div>
        </div>
      )}
    </section>
  );
}
