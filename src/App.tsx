import { useEffect, useRef, useState } from "react";
import { SettingsPanel } from "./features/settings/SettingsPanel";
import { SystemPanel } from "./features/system/SystemPanel";
import { OperationDialog } from "./features/tasks/OperationDialog";
import { ServicePanel } from "./components/ServicePanel";
import { Dialog } from "./components/Dialog";
import { StudioIcon, type IconName } from "./components/StudioIcon";
import { OledPanel } from "./features/oled/OledPanel";
import { Tasks } from "./features/tasks/TaskList";
import {
  KeyboardCanvas,
  leverLabel,
  modeNames,
  type CanvasPart,
} from "./features/workspace/KeyboardCanvas";
import { HelpPanel } from "./features/workspace/HelpPanel";
import {
  describeError,
  initialView,
  reconnectRuntime,
  setDeviceConnection,
  watchRuntime,
} from "./runtime/client";
import type { ClientView, Device } from "./runtime/types";
import { KeymapPanel } from "./features/keymap/KeymapPanel";
import { useWorkspace } from "./features/keymap/useWorkspace";
import { VoicePanel, voiceStatus } from "./features/voice/VoicePanel";
import { HooksPanel } from "./features/hooks/HooksPanel";
import {
  SetupGuide,
  needsSetup,
  rememberSetup,
} from "./features/setup/SetupGuide";
import { watchWindowClose } from "./runtime/window";
import "./App.css";

type Sheet =
  | "device"
  | "tasks"
  | "system"
  | "help"
  | "welcome"
  | "voice"
  | "firmware"
  | "hooks"
  | "lever"
  | "about";
const sheetTitles: Record<Sheet, string> = {
  device: "设备信息",
  tasks: "任务记录",
  system: "权限诊断",
  help: "AhaKey Studio 帮助中心",
  welcome: "开始使用 AhaKey",
  voice: "语音输入",
  firmware: "固件升级",
  lever: "AI 编程联动",
  hooks: "AI 编程联动",
  about: "关于 AhaKey Studio",
};
const partIcons: Record<CanvasPart, IconName> = {
  keymap: "keyboard",
  settings: "light",
  oled: "screen",
};

function DeviceDetails({
  device,
  runtime,
}: {
  device?: Device;
  runtime: ClientView;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const online = runtime.status === "connected";
  const running = runtime.inspection?.snapshot.operations.some(
    (op) =>
      op.deviceId === device?.deviceId &&
      ["accepted", "running"].includes(op.status),
  );
  async function toggle() {
    if (!device) return;
    setBusy(true);
    setError(null);
    try {
      await setDeviceConnection(
        runtime.generation,
        device.deviceId,
        device.connectionState === "disconnected",
      );
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="system-card">
        <div className="section-heading">
          <h2>{device?.name ?? "等待键盘连接"}</h2>
          <span
            className={`badge ${online && device?.connectionState === "ready" ? "positive" : ""}`}
          >
            {online && device?.connectionState === "ready"
              ? "已连接"
              : "未就绪"}
          </span>
        </div>
        <dl className="device-details">
          <div>
            <dt>电量</dt>
            <dd>
              {online && device?.batteryPercent != null
                ? `${device.batteryPercent}%`
                : "未知"}
            </dd>
          </div>
          <div>
            <dt>键盘当前模式</dt>
            <dd>
              {online && device?.workMode != null
                ? `${modeNames[device.workMode] ?? "模式"}，Mode ${device.workMode + 1}`
                : "未知"}
            </dd>
          </div>
          <div>
            <dt>拨杆</dt>
            <dd>{leverLabel(online ? device?.lever : null)}</dd>
          </div>
          <div>
            <dt>Runtime</dt>
            <dd>{online ? runtime.inspection?.runtimeVersion : "未连接"}</dd>
          </div>
        </dl>
        {device ? (
          <details className="secondary-details">
            <summary>设备标识</summary>
            <p>{device.deviceId}</p>
          </details>
        ) : null}
        {device ? (
          <button
            className="secondary-button"
            disabled={!online || busy || running}
            onClick={() => void toggle()}
          >
            {busy
              ? "处理中…"
              : device.connectionState === "disconnected"
                ? "连接设备"
                : "断开设备"}
          </button>
        ) : (
          <p>请打开键盘并保持蓝牙可用，设备状态会自动更新。</p>
        )}
        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
      <ServicePanel />
    </>
  );
}

export default function App() {
  const [runtime, setRuntime] = useState<ClientView>(initialView);
  const [part, setPart] = useState<CanvasPart>("keymap");
  const [mode, setMode] = useState(0);
  const [selectedKey, setSelectedKey] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [sheet, setSheet] = useState<Sheet | null>(() =>
    needsSetup() ? "welcome" : null,
  );
  const [focusedOperation, setFocusedOperation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => watchRuntime(setRuntime), []);
  useEffect(watchWindowClose, []);
  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (menu.current && !menu.current.contains(event.target as Node))
        menu.current.open = false;
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  const controller = useWorkspace(runtime);
  const devices = runtime.inspection?.snapshot.devices ?? [];
  const operations = runtime.inspection?.snapshot.operations ?? [];
  const device =
    devices.find((item) => item.deviceId === selectedId) ?? devices[0];
  const online = runtime.status === "connected";
  const ready = online && device?.connectionState === "ready";
  const deviceId = device?.deviceId;
  const hardwareMode = device?.workMode;
  useEffect(() => {
    if (
      ready &&
      hardwareMode != null &&
      Number.isInteger(hardwareMode) &&
      hardwareMode >= 0 &&
      hardwareMode < modeNames.length
    ) {
      setMode(hardwareMode);
    }
    // Follow actual mode changes and reconnections, not battery/lever updates.
    // Manual tab selection remains available between hardware mode changes.
  }, [ready, deviceId, hardwareMode, runtime.generation]);

  const dirty =
    Object.values(
      controller.workspace.devices[device?.deviceId ?? ""]?.keys ?? {},
    ).filter((key) => key.dirty).length +
    Object.values(
      controller.workspace.settingsDrafts[device?.deviceId ?? ""]?.fields ?? {},
    ).filter((field) => field.dirty).length;
  const pending = operations.filter((op) =>
    ["accepted", "running"].includes(op.status),
  ).length;
  const title =
    part === "keymap"
      ? `Key ${selectedKey + 1}`
      : part === "settings"
        ? "灯条与按键描述"
        : "LCD 屏幕";
  function openSheet(next: Sheet) {
    if (menu.current) menu.current.open = false;
    setSheet(next);
  }
  function selectPart(next: CanvasPart, index?: number) {
    setPart(next);
    if (index !== undefined) setSelectedKey(index);
  }
  async function reconnect() {
    setReconnecting(true);
    setError(null);
    try {
      await reconnectRuntime();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setReconnecting(false);
    }
  }
  return (
    <div className="studio-shell">
      <header className="studio-toolbar">
        <button
          className="studio-brand"
          onClick={() => {
            if (sheet === "welcome") rememberSetup();
            setSheet(null);
          }}
          aria-label="AhaKey Studio 首页"
        >
          AhaKey Studio
        </button>
        <div className="toolbar-metrics">
          <button
            className="toolbar-metric connection-metric"
            onClick={() => openSheet("device")}
            aria-label="设备信息"
          >
            <small>{online ? "设备连接" : "Runtime"}</small>
            <strong>
              <i className={`status-dot ${ready ? "green" : "orange"}`} />
              {ready ? "已连接" : online ? "等待键盘" : "未连接"}
            </strong>
          </button>
          <div className="toolbar-metric">
            <small>电量</small>
            <strong>
              {online && device?.batteryPercent != null
                ? `${device.batteryPercent}%`
                : "—"}
            </strong>
          </div>
          <button
            className="toolbar-metric lever-metric"
            onClick={() => openSheet("lever")}
          >
            <small>拨杆</small>
            <strong>{leverLabel(online ? device?.lever : null)}</strong>
          </button>
        </div>
        <div className="toolbar-spacer" />
        <button className="toolbar-button" onClick={() => openSheet("hooks")}>
          AI 编程联动
        </button>
        <button className="voice-status" onClick={() => openSheet("voice")}>
          <i className="status-dot gray" />
          <span>
            <strong>语音输入</strong>
            <small>
              {online
                ? voiceStatus[
                    runtime.inspection?.snapshot.voice?.status ?? "unavailable"
                  ]
                : "未连接"}
            </small>
          </span>
        </button>
        <div className="runtime-indicator">
          <i className={`status-dot ${online ? "green" : "orange"}`} />
          <span>
            <strong>{pending ? "任务执行中" : "编辑配置"}</strong>
            <small>{online ? "Runtime 已连接" : "等待 Runtime"}</small>
          </span>
        </div>
        <nav className="toolbar-actions" aria-label="工作空间">
          <button
            className="icon-button"
            title="任务记录"
            aria-label={`任务记录${pending ? `，${pending}` : ""}`}
            onClick={() => openSheet("tasks")}
          >
            <StudioIcon name="tasks" />
            {pending ? <span className="task-dot" /> : null}
          </button>
          <button
            className="icon-button"
            title="系统与权限"
            aria-label="系统与权限"
            onClick={() => openSheet("system")}
          >
            <StudioIcon name="settings" />
          </button>
          <button
            className="icon-button"
            title="重新连接 Runtime"
            aria-label="重新连接"
            disabled={reconnecting}
            onClick={() => void reconnect()}
          >
            <StudioIcon name="refresh" />
          </button>
          <details
            className="more-menu"
            ref={menu}
            onKeyDown={(event) => {
              if (event.key === "Escape" && menu.current) {
                menu.current.open = false;
                menu.current.querySelector("summary")?.focus();
              }
            }}
          >
            <summary className="icon-button" aria-label="更多菜单" title="更多">
              <StudioIcon name="more" />
            </summary>
            <div className="menu-popover">
              <button onClick={() => openSheet("device")}>
                设备信息
                <StudioIcon name="info" size={16} />
              </button>
              <button onClick={() => openSheet("firmware")}>
                固件升级<span>未接入</span>
              </button>
              <hr />
              <button onClick={() => openSheet("voice")}>语音输入</button>
              <button onClick={() => openSheet("help")}>
                帮助中心
                <StudioIcon name="help" size={16} />
              </button>
              <button onClick={() => openSheet("about")}>
                关于 AhaKey Studio
              </button>
            </div>
          </details>
        </nav>
      </header>
      {error || controller.storageError ? (
        <div className="global-notice inline-error" role="alert">
          {error ?? controller.storageError}
        </div>
      ) : null}
      {!online && runtime.inspection ? (
        <p className="global-notice freshness">
          以下为上次连接的记录；设备恢复连接后自动更新。
        </p>
      ) : null}
      <main className="studio-workspace">
        <KeyboardCanvas
          device={device}
          workspace={controller.workspace}
          mode={mode}
          selectedKey={selectedKey}
          part={part}
          online={online}
          onMode={setMode}
          onSelect={selectPart}
          onLever={() => openSheet("lever")}
        />
        <aside className="studio-inspector" aria-label="配置检查器">
          <div className="inspector-title">
            <StudioIcon
              name={
                part === "keymap"
                  ? (
                      [
                        "microphone",
                        "check",
                        "close",
                        "backspace",
                      ] as IconName[]
                    )[selectedKey]
                  : partIcons[part]
              }
              size={25}
            />
            <div>
              <h2>{title}</h2>
              <p>
                {modeNames[mode]}，Mode {mode + 1}
              </p>
            </div>
            <button
              className="icon-button"
              aria-label="配置帮助"
              onClick={() => openSheet("help")}
            >
              <StudioIcon name="help" size={18} />
            </button>
          </div>
          <div className="inspector-scroll">
            {device ? (
              <>
                {devices.length > 1 ? (
                  <label className="device-picker">
                    目标设备
                    <select
                      value={device.deviceId}
                      onChange={(event) => setSelectedId(event.target.value)}
                    >
                      {devices.map((item) => (
                        <option key={item.deviceId} value={item.deviceId}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {part === "keymap" ? (
                  <KeymapPanel
                    key={device.deviceId}
                    device={device}
                    runtime={runtime}
                    controller={controller}
                    selection={{ mode, key: selectedKey }}
                  />
                ) : null}
                {part === "settings" ? (
                  <SettingsPanel
                    key={device.deviceId}
                    device={device}
                    runtime={runtime}
                    controller={controller}
                    selectedMode={mode}
                  />
                ) : null}
                {part === "oled" ? (
                  <OledPanel
                    key={`${device.deviceId}:${mode}`}
                    device={device}
                    runtime={runtime}
                    controller={controller}
                    initialMode={mode}
                    onSubmitted={setFocusedOperation}
                  />
                ) : null}
              </>
            ) : (
              <div className="inspector-empty">
                <span className="empty-icon">
                  <StudioIcon name="keyboard" size={36} />
                </span>
                <h3>连接你的 AhaKey</h3>
                <p>打开键盘，连接后即可读取配置、编辑按键和上传屏幕画面。</p>
                <button
                  className="primary-button"
                  onClick={() => openSheet("device")}
                >
                  查看连接与后台
                </button>
                <p className="field-hint">
                  {runtime.error?.message ??
                    (online
                      ? "Runtime 已就绪，正在等待键盘。"
                      : "正在查找本机 Runtime 服务…")}
                </p>
              </div>
            )}
          </div>
        </aside>
      </main>
      <footer className="studio-statusbar">
        <span className="selection-status">
          <StudioIcon name={partIcons[part]} size={16} />
          {title}，Mode {mode + 1}
        </span>
        <span className={dirty ? "unsaved-status" : ""}>
          未写入 <b>{dirty}</b>
        </span>
        <div className="statusbar-links">
          <button onClick={() => openSheet("system")}>权限诊断</button>
          <button onClick={() => openSheet("welcome")}>新手引导</button>
          <button onClick={() => openSheet("help")}>帮助中心</button>
        </div>
      </footer>
      {sheet ? (
        <Dialog
          key={sheet}
          title={sheetTitles[sheet]}
          className={`studio-sheet ${sheet === "help" ? "help-sheet" : sheet === "about" || sheet === "firmware" ? "compact-sheet" : ""}`}
          onClose={() => {
            if (sheet === "welcome") rememberSetup();
            setSheet(null);
          }}
          actions={
            <button
              className="secondary-button"
              onClick={() => {
                if (sheet === "welcome") rememberSetup();
                setSheet(null);
              }}
            >
              {sheet === "welcome" ? "关闭引导" : "完成"}
            </button>
          }
        >
          {sheet === "device" ? (
            <DeviceDetails device={device} runtime={runtime} />
          ) : null}
          {sheet === "system" ? <SystemPanel runtime={runtime} /> : null}
          {sheet === "tasks" ? (
            <>
              <Tasks runtime={runtime} controller={controller} />
            </>
          ) : null}
          {sheet === "help" ? <HelpPanel /> : null}
          {sheet === "welcome" ? (
            <SetupGuide runtime={runtime} onClose={() => setSheet(null)} />
          ) : null}
          {sheet === "voice" ? (
            <VoicePanel key={runtime.generation} runtime={runtime} />
          ) : null}
          {sheet === "firmware" ? (
            <div className="feature-placeholder">
              <h3>固件升级尚未接入</h3>
              <p>请使用配套烧录工具更新固件。</p>
            </div>
          ) : null}
          {sheet === "lever" || sheet === "hooks" ? (
            <HooksPanel key={runtime.generation} runtime={runtime} />
          ) : null}
          {sheet === "about" ? (
            <div className="feature-placeholder">
              <p>版本 0.1.0</p>
            </div>
          ) : null}
        </Dialog>
      ) : null}
      {focusedOperation ? (
        <OperationDialog
          id={focusedOperation}
          runtime={runtime}
          controller={controller}
          onClose={() => setFocusedOperation(null)}
        />
      ) : null}
    </div>
  );
}
