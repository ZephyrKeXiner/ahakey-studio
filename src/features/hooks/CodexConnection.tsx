import { useEffect, useState } from "react";
import {
  codexIntegration,
  describeError,
  hooksRequest,
  type CodexIntegrationStatus,
} from "../../runtime/client";
import type { ClientView } from "../../runtime/types";

export function CodexConnection({
  runtime,
  compact = false,
}: {
  runtime: ClientView;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<CodexIntegrationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  useEffect(() => {
    let alive = true;
    codexIntegration("status")
      .then((s) => {
        if (alive) setStatus(s);
      })
      .catch((e) => {
        if (alive) setError(describeError(e));
      });
    return () => {
      alive = false;
    };
  }, []);
  const snapshot = runtime.inspection?.snapshot;
  const devices =
    snapshot?.devices.filter((d) => d.connectionState === "ready") ?? [];
  const target = deviceId || (devices.length === 1 ? devices[0].deviceId : "");
  const enabled =
    runtime.status === "connected" && snapshot?.hooks?.preferences.enabled;
  const event = snapshot?.hooks?.sessions.find(
    (s) =>
      s.tool === "codex" &&
      s.updatedAtMs >= (status?.installedAtMs ?? Infinity),
  );
  const label = !status
    ? "正在检查接入"
    : !status.installed
      ? "尚未连接 Codex"
      : status.needsRepair
        ? "接入需要修复"
        : !enabled
          ? "已接入，联动关闭"
          : event
            ? "已收到事件"
            : "已接入，等待事件";
  async function manage(action: "status" | "install" | "remove") {
    setBusy(true);
    setError(null);
    try {
      setStatus(await codexIntegration(action));
      setReview(false);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }
  async function enable() {
    if (!target || !snapshot?.hooks) return;
    setBusy(true);
    setError(null);
    try {
      await hooksRequest(runtime.generation, "hooks.configure", {
        ...snapshot.hooks.preferences,
        enabled: true,
        deviceId: target,
        allowAutomatic: false,
      });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="system-card codex-connection" aria-label="Codex 接入">
      <div className="section-heading">
        <h3>{compact ? "Codex" : "连接 Codex"}</h3>
        <span
          className={`badge ${enabled && event && status?.installed && !status.needsRepair ? "positive" : ""}`}
        >
          {label}
        </span>
      </div>
      {compact && status?.installed && !status.needsRepair ? (
        <button
          className="text-button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "收起接入管理" : "管理接入"}
        </button>
      ) : null}
      {!compact || expanded || !status?.installed || status.needsRepair ? (
        <>
          {!compact ? (
            <p>连接后，Studio 显示 Codex 的工作状态和单次审批请求。</p>
          ) : null}
          {status && !status.detected ? (
            <p className="field-hint">
              尚未检测到 Codex 用户配置。请先安装并启动 Codex，再刷新检测。
            </p>
          ) : null}
          {status?.installed ? (
            <>
              <ol>
                <li>
                  在 Codex CLI 输入 <code>/hooks</code>，检查并信任 AhaKey
                  的定义。
                </li>
                <li>开始一个新会话并执行任务，此处会显示收到的事件。</li>
              </ol>
              {enabled && event ? (
                <p role="status">
                  最近事件：{event.event}，{" "}
                  {new Date(event.updatedAtMs).toLocaleTimeString()}
                </p>
              ) : null}
              {!compact && !enabled ? (
                <div className="voice-actions">
                  <label>
                    联动键盘
                    <select
                      aria-label="Codex 联动键盘"
                      value={target}
                      onChange={(e) => setDeviceId(e.target.value)}
                    >
                      <option value="">选择在线键盘</option>
                      {devices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    disabled={
                      busy ||
                      !target ||
                      runtime.status !== "connected" ||
                      !snapshot?.hooks
                    }
                    onClick={() => void enable()}
                  >
                    启用手动联动
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
          {review ? (
            <div className="inline-notice">
              <p>
                将接入当前用户的所有 Codex 项目，写入{" "}
                <code>{status?.configPath}</code>
                。接收会话、工具调用、审批及任务完成事件。
              </p>
              <p>
                事件、项目路径和工具参数仅发送给本机后台。原配置会备份，自动批准保持关闭。
              </p>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void manage("install")}
              >
                确认连接 Codex
              </button>{" "}
              <button disabled={busy} onClick={() => setReview(false)}>
                取消
              </button>
            </div>
          ) : (
            <div className="voice-actions">
              <button
                className="primary-button"
                disabled={busy || !status}
                onClick={() => setReview(true)}
              >
                {status?.installed ? "修复接入" : "连接 Codex"}
              </button>
              <button disabled={busy} onClick={() => void manage("status")}>
                刷新接入状态
              </button>
              {status?.installed || status?.needsRepair ? (
                <button disabled={busy} onClick={() => void manage("remove")}>
                  移除 Codex 接入
                </button>
              ) : null}
            </div>
          )}
        </>
      ) : null}
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
