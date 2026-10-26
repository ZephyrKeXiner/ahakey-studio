import { useState } from "react";
import type { ClientView, HookPreferences } from "../../runtime/types";
import { describeError, hookConfig, hooksRequest } from "../../runtime/client";
import { leverLabel } from "../workspace/KeyboardCanvas";

const statuses: Record<string, string> = {
  working: "工作中",
  waiting: "等待确认",
  done: "已完成",
  idle: "空闲",
  error: "出错",
};
const decisions: Record<string, string> = {
  pending: "等待确认",
  allow: "已批准",
  deny: "已拒绝",
  defer: "交回工具确认",
};
export function HooksPanel({ runtime }: { runtime: ClientView }) {
  const view = runtime.inspection?.snapshot.hooks;
  const [draft, setDraft] = useState<HookPreferences>(
    () =>
      view?.preferences ?? {
        enabled: false,
        deviceId: null,
        allowAutomatic: false,
        inputDeviceId: null,
        approveUsage: null,
        rejectUsage: null,
      },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<"claude" | "cursor" | "codex">("claude");
  const [configuration, setConfiguration] = useState("");
  const ready =
    runtime.status === "connected" &&
    runtime.inspection?.methods.includes("hooks.configure");
  const devices = runtime.inspection?.snapshot.devices ?? [];
  const selected = devices.find(
    (d) => d.deviceId === view?.preferences.deviceId,
  );
  async function run(
    method: "hooks.get" | "hooks.configure" | "hooks.decide" | "hooks.select",
    params: unknown,
  ) {
    setBusy(true);
    setError(null);
    try {
      await hooksRequest(runtime.generation, method, params);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
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
    <section className="voice-panel">
      <p>
        接收 Claude Code、Cursor、Codex
        的工作状态与审批请求。批准只针对当前请求，不修改工具的全局权限设置。
      </p>
      {!ready ? (
        <p className="inline-notice">请连接支持 AI 联动的新版 Runtime。</p>
      ) : null}
      <h4>审批请求</h4>
      {!view?.approvals.length ? (
        <p>尚无审批请求。完成工具接入后，请求会显示在这里。</p>
      ) : null}
      {view?.approvals.map((request) => (
        <article className="system-card" key={request.requestId}>
          <strong>
            {request.context.tool} · {request.context.toolName} ·{" "}
            {decisions[request.decision] ?? request.decision}
          </strong>
          <p>{request.context.cwd}</p>
          <pre className="hook-summary">{request.context.summary}</pre>
          {request.decision === "pending" ? (
            <div className="voice-actions">
              <button
                disabled={!ready || busy}
                onClick={() =>
                  run("hooks.select", {
                    requestId: request.requestId,
                    learning: null,
                  })
                }
              >
                {view.selectedRequestId === request.requestId
                  ? "已选为按键目标"
                  : "设为按键目标"}
              </button>
              <button
                disabled={!ready || busy}
                onClick={() =>
                  run("hooks.decide", {
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
                  run("hooks.decide", {
                    requestId: request.requestId,
                    decision: "deny",
                  })
                }
              >
                拒绝本次
              </button>
              <button
                disabled={!ready || busy}
                onClick={() =>
                  run("hooks.decide", {
                    requestId: request.requestId,
                    decision: "defer",
                  })
                }
              >
                交回工具确认
              </button>
            </div>
          ) : null}
        </article>
      ))}
      <fieldset disabled={!ready || busy}>
        <legend>本次 Runtime 会话</legend>
        <label>
          关联键盘
          <select
            aria-label="关联键盘"
            value={draft.deviceId ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, deviceId: e.target.value || null })
            }
          >
            <option value="">选择设备</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          批准 / 拒绝按键来源
          <select
            aria-label="批准 / 拒绝按键来源"
            value={draft.inputDeviceId ?? ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                inputDeviceId: e.target.value || null,
                approveUsage: null,
                rejectUsage: null,
              })
            }
          >
            <option value="">仅在 Studio 确认</option>
            {(runtime.inspection?.snapshot.input?.devices ?? []).map((d) => (
              <option key={d.inputDeviceId} value={d.inputDeviceId}>
                {d.name} · {d.inputDeviceId}
              </option>
            ))}
          </select>
        </label>
        <label className="voice-check">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          />
          启用 AI 编程联动
        </label>
        <label className="voice-check">
          <input
            type="checkbox"
            checked={draft.allowAutomatic}
            onChange={(e) =>
              setDraft({ ...draft, allowAutomatic: e.target.checked })
            }
          />
          实体拨杆在自动档时，自动批准工具请求
        </label>
        <p className="field-hint">
          自动批准前重新查询键盘。手动档可在这里批准或拒绝；60
          秒未处理则交回工具自身的审批流程。设备断开、运行模式变化或 Runtime
          重启后需重新启用。
        </p>
        <button
          className="primary-button"
          onClick={() =>
            run("hooks.configure", {
              ...draft,
              approveUsage:
                draft.inputDeviceId === view?.preferences.inputDeviceId
                  ? (view?.preferences.approveUsage ?? null)
                  : null,
              rejectUsage:
                draft.inputDeviceId === view?.preferences.inputDeviceId
                  ? (view?.preferences.rejectUsage ?? null)
                  : null,
            })
          }
        >
          应用联动设置
        </button>
      </fieldset>
      <article className="system-card">
        <p role="status">
          联动{view?.preferences.enabled ? "已启用" : "未启用"} · 拨杆：
          {leverLabel(
            selected?.connectionState === "ready" ? selected.lever : null,
          )}
        </p>
        <div className="voice-actions">
          <button
            disabled={
              !ready ||
              busy ||
              !view?.preferences.enabled ||
              !view?.preferences.inputDeviceId
            }
            onClick={() =>
              run("hooks.select", { requestId: null, learning: "approve" })
            }
          >
            录入批准键
          </button>
          <button
            disabled={
              !ready ||
              busy ||
              !view?.preferences.enabled ||
              !view?.preferences.inputDeviceId
            }
            onClick={() =>
              run("hooks.select", { requestId: null, learning: "reject" })
            }
          >
            录入拒绝键
          </button>
          {view?.learning ? (
            <button
              disabled={busy || !ready}
              onClick={() =>
                run("hooks.select", { requestId: null, learning: null })
              }
            >
              取消录入
            </button>
          ) : null}
        </div>
        <p>
          {view?.learning
            ? `请按一次${view.learning === "approve" ? "批准" : "拒绝"}键`
            : `批准键${view?.preferences.approveUsage ? "已录入" : "未录入"} · 拒绝键${view?.preferences.rejectUsage ? "已录入" : "未录入"}`}
        </p>
        <p className="field-hint">
          请使用独立的单键绑定。输入监听不会拦截原按键；多条请求同时等待时，先选择要处理的请求。
        </p>
      </article>
      <h4>工具会话</h4>
      {view?.sessions.map((session) => (
        <article
          className="system-card"
          key={`${session.tool}:${session.sessionId}`}
        >
          <strong>
            {session.tool} · {statuses[session.status] ?? session.status}
          </strong>
          <p>{session.cwd}</p>
          <small>最近事件：{session.event}</small>
        </article>
      ))}
      <h4>接入配置</h4>
      <label>
        工具
        <select
          aria-label="工具"
          value={tool}
          onChange={(e) => {
            setTool(e.target.value as typeof tool);
            setConfiguration("");
          }}
        >
          <option value="claude">Claude Code</option>
          <option value="cursor">Cursor</option>
          <option value="codex">Codex</option>
        </select>
      </label>
      <button disabled={busy} onClick={configurationForTool}>
        生成接入配置
      </button>
      <p className="field-hint">
        将生成的 hooks 合并到项目的{" "}
        {tool === "claude"
          ? ".claude/settings.json"
          : tool === "cursor"
            ? ".cursor/hooks.json"
            : ".codex/hooks.json"}
        ，保留已有配置。应用移动或更新安装位置后需重新生成。Codex 还需在 /hooks
        中检查并信任该定义。
      </p>
      {configuration ? (
        <textarea
          aria-label="Hook 接入配置"
          rows={10}
          readOnly
          value={configuration}
        />
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
