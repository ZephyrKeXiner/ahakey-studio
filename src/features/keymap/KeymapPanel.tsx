import { ConfigurationReadControl } from "../../components/ConfigurationReadControl";
import { hasPendingWrites } from "../settings/model";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyKeymap,
  describeError,
  normalizeError,
  readConfiguration,
} from "../../runtime/client";
import type {
  ClientView,
  ConfigurationDocument,
  Device,
} from "../../runtime/types";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ActionEditor, actionLabel } from "./ActionEditor";
import {
  editAction,
  keyId,
  markTask,
  observedAction,
  prepareTask,
  restoreDraft,
  retainTask,
  roleNames,
  syncDevice,
  type LocalTask,
} from "./model";
import type { WorkspaceController } from "./useWorkspace";

export function KeymapPanel({
  device,
  runtime,
  controller,
  selection,
}: {
  device: Device;
  runtime: ClientView;
  controller: WorkspaceController;
  selection?: { mode: number; key: number };
}) {
  const [localMode, setMode] = useState(0);
  const [localKey, setSelected] = useState(0);
  const mode = selection?.mode ?? localMode;
  const selected = selection?.key ?? localKey;
  const [document, setDocument] = useState<{
    data: ConfigurationDocument;
    generation: number;
    epoch: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState<{
    task: LocalTask;
    document: ConfigurationDocument;
    generation: number;
  } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const requestId = useRef(0);
  const live = useRef(runtime);
  live.current = runtime;
  const epoch = runtime.configurationEpochs[device.deviceId] ?? "0";
  const online = runtime.status === "connected";
  const ready = online && device.connectionState === "ready";
  const readingDevice = document?.data.read?.status === "reading";
  const running = (runtime.inspection?.snapshot.operations ?? []).some(
    (operation) =>
      operation.deviceId === device.deviceId &&
      ["accepted", "running"].includes(operation.status),
  );
  const unsettled = hasPendingWrites(controller.workspace, device.deviceId);
  const deviceDraft = controller.workspace.devices[device.deviceId];
  const selectedDraft = deviceDraft?.keys[keyId(mode, selected)];
  const dirty = Array.from(
    { length: 4 },
    (_, index) => deviceDraft?.keys[keyId(mode, index)],
  ).filter((key) => key?.dirty && key.action).length;
  const validDocument =
    document?.generation === runtime.generation &&
    document.epoch === epoch &&
    !loading &&
    !readingDevice;
  const supportsWrite =
    runtime.inspection?.methods.includes("keymap.apply") ?? false;

  const read = useCallback(async () => {
    if (live.current.status !== "connected") return;
    const id = ++requestId.current;
    const generation = live.current.generation;
    const currentEpoch =
      live.current.configurationEpochs[device.deviceId] ?? "0";
    setLoading(true);
    setError(null);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await readConfiguration(generation, device.deviceId);
        if (
          id !== requestId.current ||
          generation !== live.current.generation ||
          live.current.status !== "connected"
        )
          return;
        if (result.deviceId !== device.deviceId)
          throw new Error("返回的配置与所选设备不一致。");
        setDocument({ data: result, generation, epoch: currentEpoch });
        setLoading(false);
        return;
      } catch (cause) {
        if (id !== requestId.current || generation !== live.current.generation)
          return;
        if (attempt === 2) {
          setError(describeError(cause));
          setLoading(false);
          return;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, 300 * (attempt + 1)),
        );
      }
    }
  }, [device.deviceId]);

  useEffect(() => {
    if (runtime.status === "connected" && (ready || readingDevice) && !running)
      void read();
    else setLoading(false);
    return () => {
      requestId.current += 1;
    };
  }, [ready, running, runtime.status, runtime.generation, epoch, read]);

  function edit(update: Parameters<WorkspaceController["commit"]>[0]) {
    try {
      controller.commit(update);
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
      const current = await readConfiguration(generation, device.deviceId);
      if (current.deviceId !== device.deviceId)
        throw new Error("返回的配置与所选设备不一致。");
      if (
        live.current.status !== "connected" ||
        live.current.generation !== generation
      )
        throw new Error("连接已变化，请重新核对后写入。");
      const task = prepareTask(
        controller.current.current,
        current,
        mode,
        crypto.randomUUID(),
        new Date().toISOString(),
      );
      setPrepared({ task, document: current, generation });
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setPreparing(false);
    }
  }
  async function submit() {
    if (!prepared) return;
    const { task, generation } = prepared;
    if (
      live.current.status !== "connected" ||
      live.current.generation !== generation
    ) {
      setPrepared(null);
      setError("连接已变化，请重新核对后写入。");
      return;
    }
    try {
      controller.commit((current) => retainTask(current, task));
    } catch (cause) {
      setError(`${describeError(cause)} 本次请求未发送。`);
      setPrepared(null);
      return;
    }
    setPrepared(null);
    try {
      const result = await applyKeymap(generation, task.request);
      controller.commit((current) =>
        markTask(current, task.request.operationId, result.status),
      );
      await controller.queryTask(task.request.operationId);
    } catch (cause) {
      const problem = normalizeError(cause);
      try {
        controller.commit((current) =>
          markTask(
            current,
            task.request.operationId,
            problem.outcomeUnknown ? "uncertain" : "rejected",
            problem.message,
          ),
        );
      } catch {}
      setError(problem.message);
    }
  }

  const known = document
    ? Array.from({ length: 16 }, (_, index) =>
        observedAction(document.data, Math.floor(index / 4), index % 4),
      ).filter(Boolean).length
    : 0;
  return (
    <section className={`keymap-panel ${selection ? "embedded-panel" : ""}`}>
      <div className="page-heading">
        <div>
          <div className="eyebrow">KEY CONFIGURATION</div>
          <h1>键位编辑</h1>
          <p>{device.name} · 修改当前模式中的指定键位。</p>
        </div>
        <button
          className="primary-button"
          disabled={
            !ready ||
            !dirty ||
            running ||
            unsettled ||
            readingDevice ||
            preparing ||
            !supportsWrite ||
            !!controller.storageError
          }
          onClick={prepare}
        >
          {preparing ? "正在核对…" : `写入修改${dirty ? ` · ${dirty}` : ""}`}
        </button>
      </div>
      <ConfigurationReadControl
        runtime={runtime}
        deviceId={device.deviceId}
        document={
          document?.generation === runtime.generation ? document.data : null
        }
        disabled={!ready || loading || running || unsettled || preparing}
        onRefresh={read}
      />
      <div className="readback-banner">
        <div>
          <strong>
            {loading
              ? "正在读取键位…"
              : document
                ? `已知 ${known} / 16 个键位`
                : "尚未读取键位"}
          </strong>
          <p>
            读取结果经你确认后同步到编辑区；未写入草稿会保留一个可恢复版本。
          </p>
        </div>
        <div className="readback-actions">
          <button
            className="text-button"
            disabled={!ready || loading || running}
            onClick={() => void read()}
          >
            刷新已知键位
          </button>
          <button
            className="secondary-button"
            disabled={!ready || !validDocument || running || unsettled}
            onClick={() => setSyncing(true)}
          >
            同步到编辑区
          </button>
        </div>
      </div>
      {!ready ? (
        <p className="inline-notice">
          {online
            ? "键盘尚未就绪，可以继续编辑本地草稿。"
            : "Runtime 正在连接，可以继续编辑本地草稿。"}
        </p>
      ) : null}
      {!supportsWrite && online ? (
        <p className="inline-notice">
          当前 Runtime 不支持独立改键，请更新 Runtime。
        </p>
      ) : null}
      {unsettled ? (
        <p className="inline-notice">
          写入任务处理中或等待确认。新修改会保留为未写入，请在任务记录中查看结果。
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
      {!selection ? (
        <div className="mode-tabs" role="tablist" aria-label="键盘模式">
          {[0, 1, 2, 3].map((item) => (
            <button
              key={item}
              role="tab"
              aria-selected={mode === item}
              onClick={() => setMode(item)}
            >
              模式 {item + 1}
              {Object.entries(deviceDraft?.keys ?? {}).some(
                ([id, key]) => id.startsWith(`${item}:`) && key.dirty,
              ) ? (
                <span className="unsaved-dot" aria-label="有未写入修改" />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      <div className="keymap-layout">
        <div className="key-selection">
          {!selection ? (
            <>
              <div className="key-selection-heading">
                选择键位 <span>模式 {mode + 1}</span>
              </div>
              <div className="key-buttons">
                {roleNames.map((name, index) => {
                  const draft = deviceDraft?.keys[keyId(mode, index)];
                  return (
                    <button
                      key={name}
                      className={`key-button ${selected === index ? "active" : ""}`}
                      aria-pressed={selected === index}
                      onClick={() => setSelected(index)}
                    >
                      <span className="physical-key">
                        {["◉", "✓", "×", "↵"][index]}
                      </span>
                      <strong>{name}</strong>
                      <span>{actionLabel(draft?.action ?? null)}</span>
                      {draft?.dirty ? <small>未写入</small> : null}
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}
          {selected === 0 ? (
            <p className="field-hint">
              Voice 键的语音行为取决于固件路由。AhaType 尚未接入。
            </p>
          ) : null}
          {deviceDraft?.history.length ? (
            <button
              className="text-button"
              onClick={() =>
                edit((current) => restoreDraft(current, device.deviceId))
              }
            >
              恢复上次同步前的草稿
            </button>
          ) : null}
          {deviceDraft?.synchronizedAt ? (
            <p className="field-hint">
              上次同步到编辑区：
              {new Date(deviceDraft.synchronizedAt).toLocaleString("zh-CN")}
            </p>
          ) : null}
        </div>
        <article className="key-inspector">
          <div className="inspector-heading">
            <h2>{roleNames[selected]}</h2>
            <span className="badge">
              {selectedDraft?.dirty
                ? "未写入"
                : selectedDraft?.action
                  ? "已同步"
                  : "未知"}
            </span>
          </div>
          <ActionEditor
            action={selectedDraft?.action ?? null}
            onChange={(action) =>
              edit((current) =>
                editAction(current, device.deviceId, mode, selected, action),
              )
            }
          />
        </article>
      </div>
      {syncing && document ? (
        <ConfirmDialog
          title="同步键位到编辑区？"
          confirmLabel="保存草稿并同步"
          onClose={() => setSyncing(false)}
          onConfirm={() => {
            if (ready && validDocument && !unsettled && !running)
              edit((current) =>
                syncDevice(current, document.data, new Date().toISOString()),
              );
            setSyncing(false);
          }}
        >
          <p>
            将 Runtime 当前已知的 {known} 个键位同步到编辑区。未知键位保持未知。
          </p>
          <p>当前未写入草稿会保存为可恢复版本；这一步不写入键盘。</p>
        </ConfirmDialog>
      ) : null}
      {prepared ? (
        <ConfirmDialog
          title={`写入模式 ${prepared.task.request.mode + 1} 的 ${prepared.task.request.keys.length} 个键位？`}
          confirmLabel="确认写入"
          onClose={() => setPrepared(null)}
          onConfirm={() => void submit()}
        >
          <p>
            目标设备：{device.name}
            。本次只写入下列键位动作，描述、灯效和亮度保持不变。
          </p>
          <ul className="patch-list">
            {prepared.task.request.keys.map((key) => (
              <li key={key.index}>
                <strong>{roleNames[key.index]}</strong>
                <span>
                  {actionLabel(
                    observedAction(
                      prepared.document,
                      prepared.task.request.mode,
                      key.index,
                    ),
                  )}
                </span>
                <span aria-hidden="true">→</span>
                <b>{actionLabel(key.action)}</b>
              </li>
            ))}
          </ul>
          {prepared.task.request.keys.some(
            (key) =>
              !observedAction(
                prepared.document,
                prepared.task.request.mode,
                key.index,
              ),
          ) ? (
            <p className="inline-notice">
              部分键位的设备当前值尚未读取，确认后将以列出的新动作覆盖这些键位。
            </p>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
