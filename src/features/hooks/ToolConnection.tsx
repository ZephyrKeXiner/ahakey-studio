import { useEffect, useState } from "react";
import {
  toolIntegration,
  describeError,
  hooksRequest,
  type DeveloperTool,
  type ToolIntegrationStatus,
} from "../../runtime/client";
import type { ClientView } from "../../runtime/types";

const names: Record<DeveloperTool, string> = {
  codex: "Codex",
  claude: "Claude Code",
  cursor: "Cursor",
  kimi: "Kimi Code",
};

export function ToolConnection({ runtime }: { runtime: ClientView }) {
  const [tool, setTool] = useState<DeveloperTool>("codex");
  return (
    <>
      <label className="field-label">
        开发工具
        <select
          aria-label="开发工具"
          value={tool}
          onChange={(event) => setTool(event.target.value as DeveloperTool)}
        >
          {Object.entries(names).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <Connection key={tool} tool={tool} runtime={runtime} />
    </>
  );
}

function Connection({
  tool,
  runtime,
}: {
  tool: DeveloperTool;
  runtime: ClientView;
}) {
  const name = names[tool];
  const [status, setStatus] = useState<ToolIntegrationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  useEffect(() => {
    let alive = true;
    toolIntegration(tool, "status")
      .then((value) => {
        if (alive) setStatus(value);
      })
      .catch((e) => {
        if (alive) setError(describeError(e));
      });
    return () => {
      alive = false;
    };
  }, [tool]);
  const snapshot = runtime.inspection?.snapshot;
  const devices =
    snapshot?.devices.filter((d) => d.connectionState === "ready") ?? [];
  const target = deviceId || (devices.length === 1 ? devices[0].deviceId : "");
  const enabled =
    runtime.status === "connected" && snapshot?.hooks?.preferences.enabled;
  const event = snapshot?.hooks?.sessions.find(
    (s) =>
      s.tool === tool && s.updatedAtMs >= (status?.installedAtMs ?? Infinity),
  );
  const label = !status
    ? "正在检查接入"
    : status.needsRepair
      ? "接入需要修复"
      : !status.installed
        ? `尚未连接 ${name}`
        : !enabled
          ? "已接入，联动关闭"
          : event
            ? "已收到事件"
            : "已接入，等待事件";
  async function manage(action: "status" | "install" | "remove") {
    setBusy(true);
    setError(null);
    try {
      setStatus(await toolIntegration(tool, action));
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
    <section
      className="system-card codex-connection"
      aria-label={`${name} 接入`}
    >
      <div className="section-heading">
        <h3>连接 {name}</h3>
        <span>{label}</span>
      </div>
      <p>
        {tool === "kimi"
          ? "Kimi Code 2.x 支持任务和审批状态同步，批准操作仍在 Kimi 中完成。"
          : tool === "cursor"
            ? "同步任务状态，接收 Shell 和 MCP 审批请求。"
            : "同步任务状态和审批请求。"}
      </p>
      {status && !status.detected ? (
        <p className="field-hint">
          尚未检测到 {name} 用户配置，请先启动该工具。
        </p>
      ) : null}
      {status?.installed ? (
        <>
          <p>
            {tool === "codex"
              ? "在 Codex CLI 输入 /hooks，检查并信任 AhaKey 的定义，然后开始新会话。"
              : tool === "claude"
                ? "在 Claude Code 输入 /hooks 检查接入，然后开始新会话。"
                : tool === "cursor"
                  ? "在 Cursor 设置的 Hooks 中检查接入，然后开始新会话。"
                  : "开始一个新的 Kimi Code 会话使配置生效。"}
          </p>
          {enabled && event ? (
            <p role="status">
              最近事件：{event.event}，
              {new Date(event.updatedAtMs).toLocaleTimeString()}
            </p>
          ) : null}
          {!enabled ? (
            <div className="voice-actions">
              <label>
                联动键盘
                <select
                  aria-label={`${name} 联动键盘`}
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
                {tool === "kimi" ? "启用状态同步" : "启用手动联动"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      {review ? (
        <div className="inline-notice">
          <p>
            接入当前用户的所有 {name} 项目，写入 {status?.configPath}
            。原配置会备份。
          </p>
          <p>项目路径和工具参数仅发送给本机后台。</p>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void manage("install")}
          >
            确认连接 {name}
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
            {status?.installed || status?.needsRepair
              ? "修复接入"
              : `连接 ${name}`}
          </button>
          <button disabled={busy} onClick={() => void manage("status")}>
            刷新接入状态
          </button>
          {status?.installed || status?.needsRepair ? (
            <button disabled={busy} onClick={() => void manage("remove")}>
              移除 {name} 接入
            </button>
          ) : null}
        </div>
      )}
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
