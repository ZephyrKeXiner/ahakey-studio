import { hasPendingWrites } from "../settings/model";
import { ImageComposer, inspectImage, type ImageSource } from "./ImageComposer";
import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  describeError,
  normalizeError,
  prepareResource,
  readConfiguration,
  readOled,
  uploadOled,
} from "../../runtime/client";
import type {
  ClientView,
  Device,
  OledDocument,
  OledTarget,
  OledTask,
} from "../../runtime/types";
import type { WorkspaceController } from "../keymap/useWorkspace";
import { markOled, targetLabel } from "./model";

export function OledPanel({
  device,
  runtime,
  controller,
  onSubmitted,
  initialMode = 0,
}: {
  device: Device;
  runtime: ClientView;
  controller: WorkspaceController;
  onSubmitted: (id: string) => void;
  initialMode?: number;
}) {
  const [document, setDocument] = useState<{
    value: OledDocument;
    generation: number;
    epoch: string;
  } | null>(null);
  const [targetId, setTargetId] = useState(() =>
    JSON.stringify({ kind: "modeDefault", mode: initialMode }),
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [confirm, setConfirm] = useState<{
    task: OledTask;
    generation: number;
  } | null>(null);
  const [composer, setComposer] = useState<ImageSource | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const live = useRef(runtime);
  live.current = runtime;
  const selection = useRef(0);
  const request = useRef(0);
  const draft = controller.workspace.oledDrafts[device.deviceId];
  const epoch = runtime.configurationEpochs[device.deviceId] ?? "0";
  const ready =
    runtime.status === "connected" && device.connectionState === "ready";
  const running =
    runtime.inspection?.snapshot.operations.some(
      (operation) =>
        operation.deviceId === device.deviceId &&
        ["accepted", "running"].includes(operation.status),
    ) ?? false;
  const unsettled = hasPendingWrites(controller.workspace, device.deviceId);
  const supported =
    runtime.inspection?.methods.includes("oled.upload") ?? false;
  const currentDocument =
    document?.generation === runtime.generation && document.epoch === epoch;
  const entries = document?.value.entries ?? [];
  const entry =
    entries.find((item) => JSON.stringify(item.target) === targetId) ??
    entries[0];
  const target: OledTarget | undefined = entry?.target;
  const tooManyFrames =
    !!draft && !!entry && draft.resource.frameCount > entry.maxFrames;

  async function refresh() {
    if (live.current.status !== "connected") return;
    const id = ++request.current;
    const generation = live.current.generation;
    const currentEpoch =
      live.current.configurationEpochs[device.deviceId] ?? "0";
    setLoading(true);
    setError(null);
    try {
      const value = await readOled(generation, device.deviceId);
      if (id === request.current && generation === live.current.generation)
        setDocument({ value, generation, epoch: currentEpoch });
    } catch (cause) {
      if (id === request.current) setError(describeError(cause));
    } finally {
      if (id === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (ready && !running) void refresh();
    return () => {
      request.current += 1;
    };
    // refresh deliberately captures the current device; the panel remounts on a device change.
  }, [ready, running, runtime.generation, epoch]);
  useEffect(
    () => () => {
      selection.current += 1;
    },
    [],
  );
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  useEffect(
    () => () => {
      if (composer) URL.revokeObjectURL(composer.url);
    },
    [composer],
  );
  async function storeFile(file: File, bytes: Uint8Array, id: number) {
    const resource = await prepareResource(bytes);
    if (id !== selection.current) return;
    controller.commit((current) => ({
      ...current,
      oledDrafts: {
        ...current.oledDrafts,
        [device.deviceId]: { resource, filename: file.name },
      },
    }));
    setPreview(URL.createObjectURL(file));
  }
  async function applyCrop(file: File) {
    setComposer(null);
    const id = ++selection.current;
    setPreparing(true);
    setError(null);
    try {
      await storeFile(file, new Uint8Array(await file.arrayBuffer()), id);
    } catch (cause) {
      if (id === selection.current) setError(describeError(cause));
    } finally {
      if (id === selection.current) setPreparing(false);
    }
  }
  async function selectFile(file: File | undefined) {
    if (!file) return;
    const id = ++selection.current;
    setError(null);
    setPreparing(true);
    try {
      if (!file.size || file.size > 2 * 1024 * 1024)
        throw new Error("请选择不超过 2 MiB 的 PNG、JPEG 或 GIF 图片。");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const source = await inspectImage(file, bytes);
      if (id !== selection.current) {
        if (source) URL.revokeObjectURL(source.url);
        return;
      }
      if (source) {
        setComposer(source);
        return;
      }
      await storeFile(file, bytes, id);
    } catch (cause) {
      if (id === selection.current) setError(describeError(cause));
    } finally {
      if (id === selection.current) setPreparing(false);
    }
  }
  async function prepareUpload() {
    if (!draft || !target || tooManyFrames) return;
    setPreparing(true);
    setError(null);
    const generation = runtime.generation;
    try {
      const configuration = await readConfiguration(
        generation,
        device.deviceId,
      );
      if (
        configuration.deviceId !== device.deviceId ||
        generation !== live.current.generation ||
        live.current.status !== "connected"
      )
        throw new Error("连接已变化，请重新核对上传。");
      const task: OledTask = {
        request: {
          operationId: crypto.randomUUID(),
          deviceId: device.deviceId,
          baseToken: configuration.baseToken,
          resourceId: draft.resource.resourceId,
          target: structuredClone(target),
        },
        resource: draft.resource,
        filename: draft.filename,
        status: "pending",
        message: null,
        createdAt: new Date().toISOString(),
      };
      setConfirm({ task, generation });
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setPreparing(false);
    }
  }
  async function submit() {
    if (!confirm) return;
    const { task, generation } = confirm;
    setConfirm(null);
    if (
      live.current.generation !== generation ||
      live.current.status !== "connected"
    ) {
      setError("连接已变化，请重新核对上传。");
      return;
    }
    try {
      controller.commit((current) => ({
        ...current,
        oledTasks: [task, ...current.oledTasks],
      }));
    } catch (cause) {
      setError(`${describeError(cause)} 本次请求未发送。`);
      return;
    }
    onSubmitted(task.request.operationId);
    try {
      const accepted = await uploadOled(generation, task.request);
      controller.commit((current) =>
        markOled(current, task.request.operationId, accepted.status),
      );
      await controller.queryTask(task.request.operationId);
    } catch (cause) {
      const problem = normalizeError(cause);
      try {
        controller.commit((current) =>
          markOled(
            current,
            task.request.operationId,
            problem.outcomeUnknown ? "uncertain" : "rejected",
            problem.message,
          ),
        );
      } catch {
        /* Storage error is shown by the workspace. */
      }
      setError(problem.message);
    }
  }
  return (
    <section className="oled-panel">
      <div className="page-heading">
        <div>
          <div className="eyebrow">OLED DISPLAY</div>
          <h1>屏幕画面</h1>
          <p>为键盘挑选一张专属画面。</p>
        </div>
        <button
          className="primary-button"
          disabled={
            !ready ||
            !supported ||
            !draft ||
            !target ||
            !currentDocument ||
            running ||
            unsettled ||
            tooManyFrames ||
            preparing ||
            !!controller.storageError
          }
          onClick={() => void prepareUpload()}
        >
          上传到键盘
        </button>
      </div>
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
      {unsettled ? (
        <p className="inline-notice">
          设备任务处理中或等待核对。可在任务记录中查看进度、暂停或继续上传。
        </p>
      ) : null}
      {!ready ? (
        <p className="inline-notice">
          等待 Runtime 与键盘连接，已准备的素材会保留。
        </p>
      ) : null}
      <div className="oled-layout">
        <article className="oled-source">
          <div className="oled-preview">
            {preview ? (
              <img src={preview} alt={`待上传素材：${draft?.filename ?? ""}`} />
            ) : (
              <span>
                {draft ? "素材已准备" : "160 × 80"}
                <small>
                  {draft ? "重新选择文件可查看本地预览" : "YOUR LITTLE CANVAS"}
                </small>
              </span>
            )}
          </div>
          <h2>{draft?.filename ?? "选择屏幕素材"}</h2>
          <p>
            {draft
              ? `${draft.resource.frameCount} 帧 · 100 毫秒 / 帧 · 160 × 80 像素`
              : "PNG、JPEG 或 GIF，最大 2 MiB。"}
          </p>
          <label
            className={`secondary-button file-picker ${preparing ? "disabled" : ""}`}
          >
            {preparing ? "正在准备素材…" : "选择图片或动图"}
            <input
              aria-label="选择图片或动图"
              type="file"
              accept="image/png,image/jpeg,image/gif"
              disabled={preparing || !ready || !supported}
              onChange={(event) => {
                void selectFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
          <p className="field-hint">
            静态图片可预览并裁剪到 160 × 80。动图需符合该尺寸，使用固定 100
            毫秒帧间隔、无限循环；透明部分显示为黑色。选择文件只准备素材，确认上传后才修改键盘。
          </p>
        </article>
        <article className="oled-target">
          <div className="inspector-heading">
            <h2>显示位置</h2>
            <button
              className="text-button"
              disabled={!ready || running || loading}
              onClick={() => void refresh()}
            >
              {loading ? "读取中…" : "读取设备"}
            </button>
          </div>
          <label className="field-label">
            目标位置
            <select
              aria-label="目标位置"
              value={entry ? JSON.stringify(entry.target) : ""}
              disabled={!entries.length}
              onChange={(event) => setTargetId(event.target.value)}
            >
              {entries.length ? (
                entries.map((item) => (
                  <option
                    key={JSON.stringify(item.target)}
                    value={JSON.stringify(item.target)}
                  >
                    {targetLabel(item.target)}
                  </option>
                ))
              ) : (
                <option value="">等待读取设备位置</option>
              )}
            </select>
          </label>
          {entry ? (
            <dl className="oled-facts">
              <div>
                <dt>设备当前资源</dt>
                <dd>
                  {!currentDocument
                    ? "等待重新读取"
                    : entry.valid
                      ? `${entry.frameCount} 帧 · 已保存`
                      : ({
                          empty: "未上传",
                          writing: "写入未完成",
                          invalid: "资源不完整",
                        }[entry.writeState] ?? entry.writeState)}
                </dd>
              </div>
              <div>
                <dt>允许帧数</dt>
                <dd>最多 {entry.maxFrames} 帧</dd>
              </div>
              <div>
                <dt>播放速度</dt>
                <dd>100 毫秒 / 帧</dd>
              </div>
            </dl>
          ) : null}
          {tooManyFrames ? (
            <p className="inline-error" role="alert">
              这份素材有 {draft.resource.frameCount} 帧，此位置最多支持{" "}
              {entry!.maxFrames} 帧。
            </p>
          ) : null}
          <p className="field-hint">
            设备提供资源状态与帧数，当前不导出原图。素材预览来自本地文件；未上传的位置可能显示固件内置画面。
          </p>
        </article>
      </div>
      {composer ? (
        <ImageComposer
          source={composer}
          onClose={() => setComposer(null)}
          onApply={(file) => void applyCrop(file)}
        />
      ) : null}
      {confirm ? (
        <ConfirmDialog
          title="上传画面到键盘？"
          confirmLabel="确认上传"
          onClose={() => setConfirm(null)}
          onConfirm={() => void submit()}
        >
          <p>
            {device.name} · {targetLabel(confirm.task.request.target)}
          </p>
          <p>
            {confirm.task.filename} · {confirm.task.resource.frameCount} 帧
          </p>
          <p>
            将覆盖此位置的画面，上传期间设备的部分控制暂不可用。退出 Studio
            后，Runtime
            会继续已受理的上传；需要暂停时请使用任务记录中的暂停按钮。
          </p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
