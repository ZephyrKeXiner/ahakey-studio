import { useState } from "react";
import type { ClientView, VoicePreferences } from "../../runtime/types";
import {
  describeError,
  voiceRequest,
  openSystemSettings,
  type SettingsPane,
} from "../../runtime/client";

export const voiceStatus: Record<string, string> = {
  unavailable: "语音组件未就绪",
  idle: "就绪",
  recording: "正在录音",
  finalizing: "正在完成转写",
  inserting: "正在输出",
  completed: "转写完成",
  failed: "未完成",
};
const permissions: Record<string, string> = {
  unknown: "未知",
  notDetermined: "待授权",
  granted: "已授权",
  denied: "未授权",
};
const errors: Record<string, string> = {
  VOICE_UNAVAILABLE: "语音组件未就绪，请更新并重启 Runtime。",
  VOICE_PERMISSION_REQUIRED: "请先授予麦克风与语音识别权限。",
  VOICE_INPUT_REQUIRED: "请启用后台输入监听，并选择当前 AhaKey 输入设备。",
  VOICE_INPUT_NOT_READY: "请先松开键盘按键，确认输入监听正常后再启用。",
  VOICE_INPUT_LOST:
    "输入设备断开或监听停止，等待已绑定设备恢复；没有稳定身份时请重新选择。",
  VOICE_BUSY: "当前语音会话尚未结束。",
  VOICE_SESSION_CHANGED: "语音会话已变化，请查看当前状态。",
  VOICE_OFFLINE_UNAVAILABLE: "当前语言没有可用的本机识别能力。",
  VOICE_RECOGNIZER_UNAVAILABLE: "当前语言的语音识别暂不可用。",
  VOICE_MICROPHONE_UNAVAILABLE: "没有可用的麦克风输入。",
  VOICE_RECORDING_FAILED: "无法启动麦克风录音。",
  VOICE_RECOGNITION_FAILED: "语音识别失败，请检查权限与网络后重试。",
  VOICE_FINALIZATION_TIMEOUT: "等待最终转写超时，结果没有自动输出。",
  VOICE_NO_SPEECH: "没有识别到语音。",
};
const outputs: Record<string, string> = {
  pasteSent: "已向原输入框发送粘贴",
  copied: "已复制",
  targetChanged: "输入位置已变化，请复制结果",
  permissionRequired: "自动输入需要辅助功能权限",
  secureField: "密码输入框不自动填入，请手动处理",
  copyFailed: "复制失败",
  insertFailed: "无法发送粘贴",
};

export function VoicePanel({ runtime }: { runtime: ClientView }) {
  const view = runtime.inspection?.snapshot.voice;
  const [draft, setDraft] = useState<VoicePreferences>(
    () =>
      view?.preferences ?? {
        enabled: false,
        inputDeviceId: null,
        trigger: "hold",
        locale: "zh-CN",
        autoInsert: false,
        onDeviceOnly: false,
      },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = runtime.status === "connected";
  const supported = runtime.inspection?.methods.includes("voice.control");
  const active = ["recording", "finalizing", "inserting"].includes(
    view?.status ?? "",
  );
  const ready = connected && supported && view?.available;
  async function run(
    method: "voice.configure" | "voice.control",
    params: unknown,
  ) {
    setBusy(true);
    setError(null);
    try {
      const updated = await voiceRequest(runtime.generation, method, params);
      if (method === "voice.configure") setDraft(updated.preferences);
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      setError((code && errors[code]) || describeError(cause));
    } finally {
      setBusy(false);
    }
  }
  async function openPermission(pane: SettingsPane) {
    setBusy(true);
    setError(null);
    try {
      await openSystemSettings(pane);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }
  const control = (action: string) =>
    run("voice.control", { action, sessionId: view?.sessionId ?? null });
  return (
    <section
      className="voice-panel"
      data-retain-webview={
        busy ||
        (!!view &&
          (Object.keys(draft) as (keyof VoicePreferences)[]).some(
            (key) => draft[key] !== view.preferences[key],
          ))
      }
    >
      {!supported ? (
        <p className="inline-notice">请连接支持语音输入的新版 Runtime。</p>
      ) : null}
      {supported && !view?.available ? (
        <p className="inline-notice">
          语音组件未就绪；模拟 Runtime 不启动真实麦克风。
        </p>
      ) : null}
      <div className="system-card">
        <h3>权限</h3>
        <dl className="permission-list">
          <div>
            <dt>麦克风</dt>
            <dd>{permissions[view?.microphone ?? "unknown"]}</dd>
          </div>
          <div>
            <dt>语音识别</dt>
            <dd>{permissions[view?.speech ?? "unknown"]}</dd>
          </div>
          <div>
            <dt>辅助功能</dt>
            <dd>{view?.accessibility ? "已授权" : "未授权"}</dd>
          </div>
        </dl>
        <div className="voice-actions">
          <button
            disabled={!ready || busy || active}
            onClick={() => control("permissions")}
          >
            请求语音权限
          </button>
          <button disabled={!ready || busy} onClick={() => control("refresh")}>
            刷新权限
          </button>
        </div>
        <details className="secondary-details">
          <summary>打开系统权限设置</summary>
          <div className="voice-actions">
            <button
              disabled={busy}
              onClick={() => openPermission("microphone")}
            >
              麦克风设置
            </button>
            <button
              disabled={busy}
              onClick={() => openPermission("speechRecognition")}
            >
              语音识别设置
            </button>
            <button
              disabled={busy}
              onClick={() => openPermission("accessibility")}
            >
              辅助功能设置
            </button>
          </div>
        </details>
      </div>
      <div className="system-card">
        <h3>试录</h3>
        <p role="status">
          {voiceStatus[view?.status ?? "unavailable"] ?? view?.status}，
          按键录音{view?.preferences.enabled ? "已启用" : "未启用"}
        </p>
        <div className="voice-actions">
          <button
            disabled={!ready || busy || active}
            onClick={() => control("start")}
          >
            开始试录
          </button>
          <button
            disabled={!ready || busy || view?.status !== "recording"}
            onClick={() => control("stop")}
          >
            结束录音
          </button>
          <button
            disabled={!connected || busy || !view?.sessionId}
            onClick={() => control("cancel")}
          >
            取消 / 清除
          </button>
          <button
            disabled={
              !ready || busy || view?.status !== "completed" || !view?.text
            }
            onClick={() => control("copy")}
          >
            复制结果
          </button>
        </div>
        <p className="field-hint">仅预览，最长 120 秒。</p>
        <textarea
          aria-label="语音转写结果"
          readOnly
          value={view?.text ?? ""}
          rows={4}
        />
        {view?.output ? <p>{outputs[view.output] ?? view.output}</p> : null}
      </div>
      <fieldset disabled={!ready || busy || active}>
        <legend>按键录音设置</legend>
        <label>
          输入设备
          <select
            aria-label="输入设备"
            value={draft.inputDeviceId ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, inputDeviceId: e.target.value || null })
            }
          >
            <option value="">请选择 AhaKey 输入设备</option>
            {(runtime.inspection?.snapshot.input?.devices ?? []).map(
              (device) => (
                <option key={device.inputDeviceId} value={device.inputDeviceId}>
                  {device.name}
                </option>
              ),
            )}
          </select>
        </label>
        <p className="field-hint">Voice 键需设为 F18。</p>
        <label>
          录音方式
          <select
            aria-label="录音方式"
            value={draft.trigger}
            onChange={(e) =>
              setDraft({
                ...draft,
                trigger: e.target.value as "hold" | "toggle",
              })
            }
          >
            <option value="hold">按住录音，松开结束</option>
            <option value="toggle">点击开始，再次点击结束</option>
          </select>
        </label>
        <label>
          识别语言
          <select
            aria-label="识别语言"
            value={draft.locale}
            onChange={(e) => setDraft({ ...draft, locale: e.target.value })}
          >
            <option value="zh-CN">普通话</option>
            <option value="en-US">English</option>
            <option value="zh-TW">中文（台湾）</option>
            <option value="ja-JP">日本語</option>
          </select>
        </label>
        <label className="voice-check">
          <input
            type="checkbox"
            checked={draft.onDeviceOnly}
            onChange={(e) =>
              setDraft({ ...draft, onDeviceOnly: e.target.checked })
            }
          />
          仅本机识别
        </label>
        <p className="field-hint">关闭后，Apple Speech 可能联网处理音频。</p>
        <label className="voice-check">
          <input
            type="checkbox"
            checked={draft.autoInsert}
            onChange={(e) =>
              setDraft({ ...draft, autoInsert: e.target.checked })
            }
          />
          按键录音结束后输入到原文本框
        </label>
        <label className="voice-check">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          />
          启用 Voice 键录音
        </label>
        <button
          className="primary-button"
          onClick={() => run("voice.configure", draft)}
        >
          保存录音设置
        </button>
      </fieldset>
      {error || view?.error ? (
        <p role="alert" className="inline-notice">
          {error ?? errors[view!.error!] ?? view?.error}
        </p>
      ) : null}
    </section>
  );
}
