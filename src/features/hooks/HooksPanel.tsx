import { CodexConnection } from "./CodexConnection";
import { useState } from "react";
import type { ClientView, HookPreferences } from "../../runtime/types";
import { describeError, hookConfig, hooksRequest } from "../../runtime/client";

const statuses: Record<string, string> = {
  working: "工作中",
  waiting: "等待确认",
  done: "已完成",
  idle: "空闲",
  error: "出错",
};
const decisions: Record<string, string> = {
  allow: "已批准",
  deny: "已拒绝",
  defer: "交回工具确认",
};
const defaults: HookPreferences = {
  enabled: false,
  deviceId: null,
  allowAutomatic: false,
  inputDeviceId: null,
  approveUsage: null,
  rejectUsage: null,
};
export function HooksPanel({ runtime }: { runtime: ClientView }) {
  const view = runtime.inspection?.snapshot.hooks;
  const preferences = view?.preferences ?? defaults;
  const [binding, setBinding] = useState<Pick<
    HookPreferences,
    "deviceId" | "inputDeviceId"
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<"claude" | "cursor" | "codex">("codex");
  const [configuration, setConfiguration] = useState("");
  const ready =
    runtime.status === "connected" &&
    !!view &&
    runtime.inspection?.methods.includes("hooks.configure");
  const devices = runtime.inspection?.snapshot.devices ?? [];
  const available = devices.filter(
    (device) => device.connectionState === "ready",
  );
  const selected =
    devices.find((device) => device.deviceId === preferences.deviceId) ??
    (available.length === 1 ? available[0] : undefined);
  const draft = binding ?? {
    deviceId: selected?.deviceId ?? null,
    inputDeviceId: preferences.inputDeviceId,
  };
  const approvalMode = !preferences.enabled
    ? "off"
    : preferences.allowAutomatic
      ? "lever"
      : "manual";
  const pending =
    view?.approvals.filter((request) => request.decision === "pending") ?? [];
  const history =
    view?.approvals.filter((request) => request.decision !== "pending") ?? [];
  const lever =
    ready && selected?.connectionState === "ready" ? selected.lever : null;
  const modeHint =
    lever === "automatic"
      ? "自动档：收到的工具审批请求会自动批准。"
      : lever === "manual"
        ? "手动档：等待你批准或拒绝。"
        : "等待键盘连接并确认拨杆档位。";

  async function run(
    method: "hooks.get" | "hooks.configure" | "hooks.decide" | "hooks.select",
    params: unknown,
  ) {
    setBusy(true);
    setError(null);
    try {
      await hooksRequest(runtime.generation, method, params);
      return true;
    } catch (cause) {
      setError(describeError(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function changeMode(mode: string) {
    if (mode !== "off" && selected?.connectionState !== "ready") {
      setError("请在高级设置中选择一把在线键盘。");
      return;
    }
    await run("hooks.configure", {
      ...preferences,
      deviceId: mode === "off" ? preferences.deviceId : selected!.deviceId,
      enabled: mode !== "off",
      allowAutomatic: mode === "lever",
    });
  }
  async function saveBinding() {
    const changedSource = draft.inputDeviceId !== preferences.inputDeviceId;
    if (
      await run("hooks.configure", {
        ...preferences,
        ...draft,
        allowAutomatic:
          draft.deviceId === preferences.deviceId && preferences.allowAutomatic,
        approveUsage: changedSource ? null : preferences.approveUsage,
        rejectUsage: changedSource ? null : preferences.rejectUsage,
      })
    )
      setBinding(null);
  }
  async function configurationForTool() {
    setBusy(true);
    setError(null);
    try {
      setConfiguration(JSON.stringify(await hookConfig(tool), null, 2));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="voice-panel hooks-panel">
      {!ready ? (
        <p className="inline-notice">请连接支持 AI 联动的新版 Runtime。</p>
      ) : null}
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      <section className="system-card hooks-mode" aria-label="审批方式">
        <div className="section-heading">
          <h3>审批方式</h3>
          <span className="badge">
            拨杆：
            {lever === "automatic"
              ? "自动档"
              : lever === "manual"
                ? "手动档"
                : "未连接"}
          </span>
        </div>
        <div
          className="approval-options"
          role="radiogroup"
          aria-label="审批方式"
        >
          {(
            [
              ["off", "关闭"],
              ["manual", "手动确认"],
              ["lever", "跟随拨杆"],
            ] as const
          ).map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name="approval-mode"
                value={value}
                checked={approvalMode === value}
                disabled={!ready || busy}
                onChange={() => void changeMode(value)}
              />
              {label}
            </label>
          ))}
        </div>
        {approvalMode === "lever" ? (
          <p className="field-hint" role="status">
            {modeHint}
          </p>
        ) : null}
      </section>
      <CodexConnection runtime={runtime} compact />
      <section aria-label="待处理请求" className="hooks-pending">
        <h3>待处理请求{pending.length ? `，${pending.length}` : ""}</h3>
        {!pending.length ? <p className="hooks-empty">暂无请求</p> : null}
        {pending.map((request) => (
          <article className="system-card" key={request.requestId}>
            <strong>
              {request.context.tool}，{request.context.toolName}
            </strong>
            <pre className="hook-summary">{request.context.summary}</pre>
            <div className="voice-actions">
              <button
                className="primary-button"
                disabled={!ready || busy}
                onClick={() =>
                  void run("hooks.decide", {
                    requestId: request.requestId,
                    decision: "allow",
                  })
                }
              >
                批准本次
              </button>
              <button
                disabled={!ready || busy}
                onClick={() =>
                  void run("hooks.decide", {
                    requestId: request.requestId,
                    decision: "deny",
                  })
                }
              >
                拒绝本次
              </button>
              {pending.length > 1 && preferences.inputDeviceId ? (
                <button
                  disabled={!ready || busy}
                  onClick={() =>
                    void run("hooks.select", {
                      requestId: request.requestId,
                      learning: null,
                    })
                  }
                >
                  {view?.selectedRequestId === request.requestId
                    ? "已选为按键目标"
                    : "设为按键目标"}
                </button>
              ) : null}
              <button
                className="text-button"
                disabled={!ready || busy}
                onClick={() =>
                  void run("hooks.decide", {
                    requestId: request.requestId,
                    decision: "defer",
                  })
                }
              >
                交回工具确认
              </button>
            </div>
          </article>
        ))}
      </section>
      <details className="hooks-advanced">
        <summary>高级设置与记录</summary>
        <div className="hooks-advanced-content">
          <fieldset disabled={!ready || busy}>
            <legend>设备与按键</legend>
            <label>
              关联键盘
              <select
                aria-label="关联键盘"
                value={draft.deviceId ?? ""}
                onChange={(event) =>
                  setBinding({ ...draft, deviceId: event.target.value || null })
                }
              >
                <option value="">选择设备</option>
                {devices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              批准 / 拒绝按键来源
              <select
                aria-label="批准 / 拒绝按键来源"
                value={draft.inputDeviceId ?? ""}
                onChange={(event) =>
                  setBinding({
                    ...draft,
                    inputDeviceId: event.target.value || null,
                  })
                }
              >
                <option value="">仅在 Studio 确认</option>
                {(runtime.inspection?.snapshot.input?.devices ?? []).map(
                  (device) => (
                    <option
                      key={device.inputDeviceId}
                      value={device.inputDeviceId}
                    >
                      {device.name}
                    </option>
                  ),
                )}
              </select>
            </label>
            <button
              className="secondary-button"
              onClick={() => void saveBinding()}
            >
              保存设备设置
            </button>
            <div className="voice-actions">
              <button
                disabled={
                  !preferences.enabled ||
                  !preferences.inputDeviceId ||
                  !!binding
                }
                onClick={() =>
                  void run("hooks.select", {
                    requestId: null,
                    learning: "approve",
                  })
                }
              >
                录入批准键
              </button>
              <button
                disabled={
                  !preferences.enabled ||
                  !preferences.inputDeviceId ||
                  !!binding
                }
                onClick={() =>
                  void run("hooks.select", {
                    requestId: null,
                    learning: "reject",
                  })
                }
              >
                录入拒绝键
              </button>
              {view?.learning ? (
                <button
                  onClick={() =>
                    void run("hooks.select", {
                      requestId: null,
                      learning: null,
                    })
                  }
                >
                  取消录入
                </button>
              ) : null}
            </div>
            <p className="field-hint">
              {view?.learning
                ? `请按一次${view.learning === "approve" ? "批准" : "拒绝"}键`
                : `批准键${preferences.approveUsage ? "已录入" : "未录入"}，拒绝键${preferences.rejectUsage ? "已录入" : "未录入"}`}
            </p>
            <p className="field-hint">
              请使用独立单键；原按键仍会发送给当前应用。
            </p>
          </fieldset>
          <section>
            <h4>手动接入其他工具</h4>
            <label>
              工具
              <select
                aria-label="工具"
                value={tool}
                onChange={(event) => {
                  setTool(event.target.value as typeof tool);
                  setConfiguration("");
                }}
              >
                <option value="codex">Codex</option>
                <option value="claude">Claude Code</option>
                <option value="cursor">Cursor</option>
              </select>
            </label>
            <div className="voice-actions">
              <button
                disabled={busy}
                onClick={() => void configurationForTool()}
              >
                生成接入配置
              </button>
            </div>
            <p className="field-hint">
              将生成内容合并到{" "}
              {tool === "claude"
                ? ".claude/settings.json"
                : tool === "cursor"
                  ? ".cursor/hooks.json"
                  : ".codex/hooks.json"}
              ，保留已有配置。Codex 需在 /hooks 中信任定义。
            </p>
            {configuration ? (
              <textarea
                aria-label="Hook 接入配置"
                rows={8}
                readOnly
                value={configuration}
              />
            ) : null}
          </section>
          <section>
            <h4>最近记录</h4>
            {!history.length && !view?.sessions.length ? (
              <p className="field-hint">暂无记录</p>
            ) : null}
            {history.map((request) => (
              <article className="system-card" key={request.requestId}>
                <strong>
                  {request.context.tool}，{" "}
                  {decisions[request.decision] ?? request.decision}
                </strong>
                <pre className="hook-summary">{request.context.summary}</pre>
              </article>
            ))}
            {view?.sessions.map((session) => (
              <article
                className="system-card"
                key={`${session.tool}:${session.sessionId}`}
              >
                <strong>
                  {session.tool}，{statuses[session.status] ?? session.status}
                </strong>
                <p>{session.cwd}</p>
                <small>最近事件：{session.event}</small>
              </article>
            ))}
          </section>
          <p className="field-hint">
            自动批准前会核对实体拨杆。设备断开、切换模式或后台重启后，需要重新开启自动批准。
          </p>
        </div>
      </details>
    </section>
  );
}
