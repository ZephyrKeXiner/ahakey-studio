import { ConfigurationReadControl } from "../../components/ConfigurationReadControl";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  describeError,
  normalizeError,
  patchConfiguration,
  readConfiguration,
} from "../../runtime/client";
import type {
  ClientView,
  ConfigurationDocument,
  Device,
} from "../../runtime/types";
import type { WorkspaceController } from "../keymap/useWorkspace";
import { roleNames } from "../keymap/model";
import {
  descriptionId,
  editField,
  fieldIds,
  fieldLabel,
  formatField,
  hasPendingWrites,
  markSettings,
  observedFields,
  prepareSettings,
  restoreSettings,
  submittedFields,
  syncSettings,
  validateField,
  type FieldValue,
  type SettingsTask,
} from "./model";
export function SettingsPanel({
  device,
  runtime,
  controller,
}: {
  device: Device;
  runtime: ClientView;
  controller: WorkspaceController;
}) {
  const [mode, setMode] = useState(0);
  const [document, setDocument] = useState<{
    data: ConfigurationDocument;
    generation: number;
    epoch: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [prepared, setPrepared] = useState<{
    task: SettingsTask;
    document: ConfigurationDocument;
    generation: number;
  } | null>(null);
  const request = useRef(0);
  const live = useRef(runtime);
  live.current = runtime;
  const epoch = runtime.configurationEpochs[device.deviceId] ?? "0";
  const ready =
    runtime.status === "connected" && device.connectionState === "ready";
  const readingDevice = document?.data.read?.status === "reading";
  const running =
    runtime.inspection?.snapshot.operations.some(
      (op) =>
        op.deviceId === device.deviceId &&
        ["accepted", "running"].includes(op.status),
    ) ?? false;
  const pending = hasPendingWrites(controller.workspace, device.deviceId);
  const supported =
    runtime.inspection?.methods.includes("configuration.patch") ?? false;
  const draft = controller.workspace.settingsDrafts[device.deviceId];
  const dirty = Object.values(draft?.fields ?? {}).filter(
    (field) => field.dirty,
  ).length;
  const current =
    ready &&
    !running &&
    !loading &&
    !readingDevice &&
    document?.generation === runtime.generation &&
    document.epoch === epoch;
  const observed = document ? observedFields(document.data) : {};
  const known = current
    ? Object.values(observed).filter((value) => value !== null).length
    : 0;
  const read = useCallback(async () => {
    if (live.current.status !== "connected") return;
    const id = ++request.current,
      generation = live.current.generation;
    const readEpoch = live.current.configurationEpochs[device.deviceId] ?? "0";
    setLoading(true);
    setError(null);
    setDocument(null);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const data = await readConfiguration(generation, device.deviceId);
          if (
            id !== request.current ||
            generation !== live.current.generation ||
            live.current.status !== "connected"
          )
            return;
          if (data.deviceId !== device.deviceId)
            throw new Error("返回的配置与所选设备不一致。");
          setDocument({ data, generation, epoch: readEpoch });
          return;
        } catch (cause) {
          if (id !== request.current || generation !== live.current.generation)
            return;
          if (attempt === 2) throw cause;
          await new Promise((resolve) =>
            setTimeout(resolve, 300 * (attempt + 1)),
          );
        }
      }
    } catch (cause) {
      if (id === request.current) setError(describeError(cause));
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [device.deviceId]);
  useEffect(() => {
    if (runtime.status === "connected" && (ready || readingDevice) && !running)
      void read();
    else setLoading(false);
    return () => {
      request.current++;
    };
  }, [ready, running, runtime.status, epoch, runtime.generation, read]);
  function update(fn: Parameters<WorkspaceController["commit"]>[0]) {
    try {
      controller.commit(fn);
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    }
  }
  async function prepare() {
    setPreparing(true);
    setError(null);
    const generation = runtime.generation;
    try {
      const data = await readConfiguration(generation, device.deviceId);
      if (
        data.deviceId !== device.deviceId ||
        generation !== live.current.generation ||
        live.current.status !== "connected"
      )
        throw new Error("连接已变化，请重新核对本次设置。");
      const task = prepareSettings(
        controller.current.current,
        data,
        crypto.randomUUID(),
        new Date().toISOString(),
      );
      setPrepared({ task, document: data, generation });
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setPreparing(false);
    }
  }
  async function submit() {
    if (!prepared) return;
    const { task, generation } = prepared;
    setPrepared(null);
    if (
      live.current.generation !== generation ||
      live.current.status !== "connected"
    ) {
      setError("连接已变化，请重新核对本次设置。");
      return;
    }
    try {
      controller.commit((state) => ({
        ...state,
        settingsTasks: [task, ...state.settingsTasks],
      }));
    } catch (cause) {
      setError(`${describeError(cause)} 本次请求未发送。`);
      return;
    }
    try {
      const result = await patchConfiguration(generation, task.request);
      controller.commit((state) =>
        markSettings(state, task.request.operationId, result.status),
      );
      await controller.queryTask(task.request.operationId);
    } catch (cause) {
      const problem = normalizeError(cause);
      try {
        controller.commit((state) =>
          markSettings(
            state,
            task.request.operationId,
            problem.outcomeUnknown ? "uncertain" : "rejected",
            problem.message,
          ),
        );
      } catch {}
      setError(problem.message);
    }
  }
  function field(id: string) {
    const state = draft?.fields[id];
    const value = state?.value ?? null;
    const validation = state?.dirty ? validateField(id, value) : null;
    return (
      <div className="settings-field" key={id}>
        <label htmlFor={`field-${id}`}>
          {fieldLabel(id)}
          <span className="badge">
            {state?.dirty ? "未写入" : value === null ? "未知" : "已同步"}
          </span>
        </label>
        <input
          id={`field-${id}`}
          aria-label={fieldLabel(id)}
          type={id === "brightness" ? "number" : "text"}
          min={id === "brightness" ? 1 : undefined}
          max={id === "brightness" ? 100 : undefined}
          step={id === "brightness" ? 1 : undefined}
          value={value ?? ""}
          placeholder={
            id === "brightness"
              ? "1–100"
              : value === null
                ? "未知，可输入新描述"
                : "空描述"
          }
          aria-invalid={!!validation}
          aria-describedby={`hint-${id}`}
          onChange={(event) => {
            const value: FieldValue =
              id === "brightness"
                ? event.target.value === ""
                  ? null
                  : Number(event.target.value)
                : event.target.value;
            update((state) => editField(state, device.deviceId, id, value));
          }}
        />
        <p
          id={`hint-${id}`}
          className={validation ? "inline-error" : "field-hint"}
        >
          {validation ??
            `设备当前值：${current ? formatField(observed[id] ?? null, id) : "待更新"}`}
        </p>
        {id !== "brightness" ? (
          <button
            className="text-button"
            onClick={() =>
              update((state) => editField(state, device.deviceId, id, ""))
            }
          >
            清空{roleNames[Number(id.split(":")[2])]}描述
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <section className="settings-panel">
      <div className="page-heading">
        <div>
          <div className="eyebrow">DEVICE SETTINGS</div>
          <h1>亮度与描述</h1>
          <p>{device.name} · 只提交明确修改的项目。</p>
        </div>
        <button
          className="primary-button"
          disabled={
            !ready ||
            !supported ||
            !dirty ||
            running ||
            pending ||
            readingDevice ||
            preparing ||
            !!controller.storageError
          }
          onClick={() => void prepare()}
        >
          {preparing ? "正在核对…" : `写入设置${dirty ? ` · ${dirty}` : ""}`}
        </button>
      </div>
      <ConfigurationReadControl
        runtime={runtime}
        deviceId={device.deviceId}
        document={
          document?.generation === runtime.generation ? document.data : null
        }
        disabled={!ready || loading || running || pending || preparing}
        onRefresh={read}
      />
      <div className="readback-banner">
        <div>
          <strong>
            {loading
              ? "正在读取设置…"
              : current
                ? `已知 ${known} / ${fieldIds.length} 项设置`
                : error
                  ? "读取失败，可手动重试"
                  : "设置尚未更新"}
          </strong>
          <p>读取结果经确认后进入编辑区，未知项目保持未知。</p>
        </div>
        <div className="readback-actions">
          <button
            className="text-button"
            disabled={!ready || loading || running}
            onClick={() => void read()}
          >
            刷新已知设置
          </button>
          <button
            className="secondary-button"
            disabled={!current || pending || !!controller.storageError}
            onClick={() => setSyncing(true)}
          >
            同步设置到编辑区
          </button>
        </div>
      </div>
      {!ready ? (
        <p className="inline-notice">设备尚未就绪，可以继续编辑本地草稿。</p>
      ) : null}
      {!supported && runtime.status === "connected" ? (
        <p className="inline-notice">
          当前 Runtime 不支持字段级设置，请更新配套 Runtime 后写入。
        </p>
      ) : null}
      {pending ? (
        <p className="inline-notice">
          写入任务处理中或等待确认。可以继续编辑，新修改保留为未写入。
        </p>
      ) : null}
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {controller.storageError ? (
        <p className="inline-error" role="alert">
          {controller.storageError}
        </p>
      ) : null}
      <article className="system-card brightness-card">
        <h2>全局亮度</h2>
        {field("brightness")}
      </article>
      <div className="mode-tabs" role="tablist" aria-label="描述所属模式">
        {[0, 1, 2, 3].map((item) => (
          <button
            key={item}
            role="tab"
            aria-selected={mode === item}
            onClick={() => setMode(item)}
          >
            模式 {item + 1}
            {Object.entries(draft?.fields ?? {}).some(
              ([id, field]) =>
                id.startsWith(`description:${item}:`) && field.dirty,
            ) ? (
              <span className="unsaved-dot" aria-label="有未写入修改" />
            ) : null}
          </button>
        ))}
      </div>
      <article className="system-card">
        <h2>按键描述</h2>
        <p>
          描述最多 20 个 ASCII 字符。空描述会清除对应文字，键位动作保持不变。
        </p>
        <div className="settings-grid">
          {[0, 1, 2, 3].map((index) => field(descriptionId(mode, index)))}
        </div>
      </article>
      {draft?.history.length ? (
        <button
          className="text-button"
          onClick={() =>
            update((state) => restoreSettings(state, device.deviceId))
          }
        >
          恢复上次同步前的设置草稿
        </button>
      ) : null}
      <p className="field-hint">写入结果可在“任务记录”中查看。</p>
      {syncing && document ? (
        <ConfirmDialog
          title="同步设置到编辑区？"
          confirmLabel="保存草稿并同步设置"
          onClose={() => setSyncing(false)}
          onConfirm={() => {
            if (current && !pending && !running)
              update((state) =>
                syncSettings(state, document.data, new Date().toISOString()),
              );
            setSyncing(false);
          }}
        >
          <p>
            同步当前已知的 {known}{" "}
            项设置。未写入草稿会保存为可恢复版本；这一步不写入键盘。
          </p>
        </ConfirmDialog>
      ) : null}
      {prepared ? (
        <ConfirmDialog
          title={`写入 ${Object.keys(prepared.task.revisions).length} 项设置？`}
          confirmLabel="确认写入设置"
          onClose={() => setPrepared(null)}
          onConfirm={() => void submit()}
        >
          <p>目标设备：{device.name}。只写入以下项目。</p>
          <ul className="patch-list">
            {Object.entries(submittedFields(prepared.task.request)).map(
              ([id, value]) => (
                <li key={id}>
                  <strong>{fieldLabel(id)}</strong>
                  <span>
                    {formatField(
                      observedFields(prepared.document)[id] ?? null,
                      id,
                    )}
                  </span>
                  <span aria-hidden="true">→</span>
                  <b>{formatField(value, id)}</b>
                </li>
              ),
            )}
          </ul>
          {Object.keys(prepared.task.revisions).some(
            (id) => observedFields(prepared.document)[id] === null,
          ) ? (
            <p className="inline-notice">
              部分设备当前值尚未读取，确认后仅覆盖以上列出的项目。
            </p>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
