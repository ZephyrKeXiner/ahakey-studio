import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { ConfirmDialog } from "./ConfirmDialog";
import { describeError } from "../runtime/client";
interface ServiceStatus {
  phase: string;
  restarts: number;
  childPid: number | null;
  updatedAtMs: number;
  message: string;
}
const phases: Record<string, string> = {
  running: "后台运行中",
  starting: "启动中",
  backoff: "等待恢复",
  stopping: "正在关闭",
  stopped: "已关闭",
  faulted: "需要恢复",
  external: "独立 Runtime",
  unmanaged: "尚未启动",
};
export function ServicePanel() {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const state = await invoke<ServiceStatus>("runtime_service_status");
        if (!stopped) {
          setStatus(state);
          setError(null);
        }
      } catch (cause) {
        if (!stopped) setError(describeError(cause));
      } finally {
        if (!stopped) timer = setTimeout(poll, 2000);
      }
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  async function change(start: boolean) {
    setConfirm(false);
    setBusy(true);
    setError(null);
    try {
      setStatus(
        await invoke<ServiceStatus>(
          start ? "runtime_service_start" : "runtime_service_stop",
        ),
      );
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }
  if (!isTauri()) return null;
  const managed =
    status && ["running", "starting", "backoff"].includes(status.phase);
  const canStart =
    (!status && !!error) ||
    ["stopped", "faulted", "unmanaged"].includes(status?.phase ?? "");
  return (
    <section className="service-panel">
      <div>
        <h2>
          后台 Runtime{" "}
          <span className="badge">
            {status ? (phases[status.phase] ?? status.phase) : "检查中"}
          </span>
        </h2>
        <p>
          {status?.message ?? "正在核对后台服务。"}
          {status && status.restarts > 0
            ? ` 已自动恢复 ${status.restarts} / 3 次。`
            : ""}
        </p>
        <p className="field-hint">
          关闭 Studio 后继续运行；电脑重启后，打开 Studio 才会再次启动。
        </p>
        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div>
        {managed ? (
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => setConfirm(true)}
          >
            {busy ? "处理中…" : "关闭 Runtime"}
          </button>
        ) : null}
        {canStart ? (
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void change(true)}
          >
            {busy
              ? "处理中…"
              : status?.phase === "faulted"
                ? "恢复 Runtime"
                : "启动 Runtime"}
          </button>
        ) : null}
      </div>
      {confirm ? (
        <ConfirmDialog
          title="关闭后台 Runtime？"
          confirmLabel="关闭 Runtime"
          onClose={() => setConfirm(false)}
          onConfirm={() => void change(false)}
        >
          <p>
            正在进行的任务会按 Runtime
            的关闭流程结束或暂停。设备后台功能将停止，本次 Studio
            会保持关闭状态；下次打开 Studio 时自动启动。
          </p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
