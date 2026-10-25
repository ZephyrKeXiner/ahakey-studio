import { SettingsPanel } from "./features/settings/SettingsPanel";
import { SystemPanel } from "./features/system/SystemPanel";
import { OperationDialog } from "./features/tasks/OperationDialog";
import { ServicePanel } from "./components/ServicePanel";
import { OledPanel } from "./features/oled/OledPanel";
import { Tasks } from "./features/tasks/TaskList";
import { useEffect, useState } from "react";
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
import "./App.css";

const deviceStates: Record<string, string> = {
  ready: "已就绪",
  connecting: "连接中",
  disconnected: "未连接",
};
function KeyboardIllustration() {
  return (
    <div className="keyboard" aria-hidden="true">
      <div className="keyboard-top">
        <div className="keyboard-screen">
          AhaKey<span>MAKE IT YOURS</span>
        </div>
        <div className="keyboard-lever">
          <i />
        </div>
      </div>
      <div className="keyboard-keys">
        <i>◉</i>
        <i>✓</i>
        <i>×</i>
        <i>↵</i>
      </div>
      <div className="keyboard-light" />
    </div>
  );
}

function DeviceCard({
  device,
  runtime,
  onEdit,
}: {
  device: Device;
  runtime: ClientView;
  onEdit: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = runtime.status === "connected";
  const active = (runtime.inspection?.snapshot.operations ?? []).some(
    (operation) =>
      operation.deviceId === device.deviceId &&
      ["accepted", "running"].includes(operation.status),
  );
  async function toggle() {
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
    <article className="device-card">
      <div className="device-visual">
        <KeyboardIllustration />
      </div>
      <div className="device-copy">
        <div className="eyebrow">YOUR DEVICE</div>
        <h3>{device.name}</h3>
        <span
          className={`badge ${connected && device.connectionState === "ready" ? "positive" : ""}`}
        >
          <span className="dot" />
          {connected
            ? (deviceStates[device.connectionState] ?? device.connectionState)
            : "状态待更新"}
        </span>
        <dl className="device-facts">
          <div>
            <dt>电量</dt>
            <dd>
              {connected && device.batteryPercent != null
                ? `${device.batteryPercent}%`
                : "未知"}
            </dd>
          </div>
          <div>
            <dt>当前模式</dt>
            <dd>
              {connected && device.workMode != null
                ? `模式 ${device.workMode + 1}`
                : "未知"}
            </dd>
          </div>
        </dl>
        <p className="device-id">{device.deviceId}</p>
        <div className="device-actions">
          <button className="secondary-button" onClick={onEdit}>
            编辑键位
          </button>
          <button
            className="text-button"
            disabled={!connected || busy || active}
            onClick={() => void toggle()}
          >
            {busy
              ? "处理中…"
              : device.connectionState === "disconnected"
                ? "连接设备"
                : "断开设备"}
          </button>
        </div>
        {error ? <p className="inline-error">{error}</p> : null}
      </div>
    </article>
  );
}

export default function App() {
  const [runtime, setRuntime] = useState<ClientView>(initialView);
  const [page, setPage] = useState<
    "overview" | "keymap" | "oled" | "tasks" | "system" | "settings"
  >("overview");
  const [focusedOperation, setFocusedOperation] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => watchRuntime(setRuntime), []);
  const controller = useWorkspace(runtime);
  const devices = runtime.inspection?.snapshot.devices ?? [];
  const operations = runtime.inspection?.snapshot.operations ?? [];
  const selected =
    devices.find((device) => device.deviceId === selectedId) ?? devices[0];
  const online = runtime.status === "connected";
  const names = {
    overview: "概览",
    keymap: "键位编辑",
    settings: "亮度与描述",
    oled: "屏幕画面",
    tasks: "任务记录",
    system: "系统与权限",
  };
  async function reconnect() {
    try {
      await reconnectRuntime();
      setError(null);
    } catch (cause) {
      setError(describeError(cause));
    }
  }
  function edit(deviceId: string) {
    setSelectedId(deviceId);
    setPage("keymap");
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => setPage("overview")}
          aria-label="AhaKey Studio 首页"
        >
          <span className="brand-mark">a</span>
          <span>
            AhaKey<small>STUDIO</small>
          </span>
        </button>
        <div className="nav-caption">工作空间</div>
        <nav aria-label="工作空间">
          {(
            [
              "overview",
              "keymap",
              "settings",
              "oled",
              "tasks",
              "system",
            ] as const
          ).map((name, index) => (
            <button
              key={name}
              className={`nav-item ${page === name ? "selected" : ""}`}
              aria-current={page === name ? "page" : undefined}
              onClick={() => setPage(name)}
            >
              <span aria-hidden="true">
                {["▦", "⌘", "☼", "▣", "≡", "⚙"][index]}
              </span>
              {names[name]}
              {name === "tasks" ? (
                <span className="nav-count">{operations.length}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="dot" /> AhaKey Studio <span>0.1.0</span>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            工作空间 <b>/</b>
            {names[page]}
          </span>
          <span className="edition">DESKTOP STUDIO</span>
        </header>
        <div className="workspace">
          {page === "overview" ? (
            <div className="page-heading">
              <div>
                <div className="eyebrow">WORKSPACE OVERVIEW</div>
                <h1>设备与 Runtime</h1>
                <p>设备连接与任务进度，实时同步。</p>
              </div>
              <button
                className="primary-button"
                onClick={() => void reconnect()}
              >
                <span aria-hidden="true">↻</span>重新连接
              </button>
            </div>
          ) : null}
          <section
            className="runtime-banner"
            aria-label="Runtime 状态"
            aria-live="polite"
          >
            <div className="runtime-symbol" aria-hidden="true">
              ⌁
            </div>
            <div className="runtime-status">
              <h2>
                {online
                  ? "Runtime 已连接"
                  : runtime.status === "unavailable"
                    ? "需要桌面应用"
                    : runtime.inspection
                      ? "正在恢复 Runtime 连接"
                      : "正在连接 Runtime"}
              </h2>
              <p>
                {online
                  ? `Runtime ${runtime.inspection!.runtimeVersion} · ${devices.length} 台设备 · ${operations.length} 项任务`
                  : (runtime.error?.message ?? "正在查找本机 Runtime 服务…")}
              </p>
            </div>
            <span className={`badge ${online ? "positive" : ""}`}>
              <span className="dot" />
              {online ? "实时同步" : "等待连接"}
            </span>
          </section>
          {!online && runtime.inspection ? (
            <p className="freshness">
              以下为上次连接的记录；设备恢复连接后自动更新。
            </p>
          ) : null}
          {error ? (
            <p className="inline-error" role="alert">
              {error}
            </p>
          ) : null}
          {controller.storageError && page !== "keymap" && page !== "oled" ? (
            <p className="inline-error" role="alert">
              {controller.storageError}
            </p>
          ) : null}
          {page === "overview" ? (
            <>
              <ServicePanel />
              <section id="devices" className="section">
                <div className="section-heading">
                  <h2>
                    我的设备{" "}
                    <span>{devices.length.toString().padStart(2, "0")}</span>
                  </h2>
                  <span>由 Runtime 管理设备连接</span>
                </div>
                {devices.length ? (
                  <div className="device-grid">
                    {devices.map((device) => (
                      <DeviceCard
                        key={device.deviceId}
                        device={device}
                        runtime={runtime}
                        onEdit={() => edit(device.deviceId)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="empty-device">
                    <KeyboardIllustration />
                    <h3>
                      {online ? "尚未发现键盘" : "你的 AhaKey，从这里开始"}
                    </h3>
                    <p>
                      {online
                        ? "请打开键盘并保持蓝牙可用，Studio 会自动更新设备状态。"
                        : "启动 AhaKey Runtime 后，Studio 会自动连接。"}
                    </p>
                  </div>
                )}
              </section>
              <Tasks runtime={runtime} controller={controller} />
            </>
          ) : null}
          {page === "keymap" || page === "oled" || page === "settings" ? (
            selected ? (
              <>
                <label className="device-picker">
                  目标设备
                  <select
                    value={selected.deviceId}
                    onChange={(event) => setSelectedId(event.target.value)}
                  >
                    {devices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.name}
                      </option>
                    ))}
                  </select>
                </label>
                {page === "keymap" ? (
                  <KeymapPanel
                    key={selected.deviceId}
                    device={selected}
                    runtime={runtime}
                    controller={controller}
                  />
                ) : page === "settings" ? (
                  <SettingsPanel
                    key={selected.deviceId}
                    device={selected}
                    runtime={runtime}
                    controller={controller}
                  />
                ) : (
                  <OledPanel
                    key={selected.deviceId}
                    device={selected}
                    runtime={runtime}
                    controller={controller}
                    onSubmitted={setFocusedOperation}
                  />
                )}
              </>
            ) : (
              <div className="empty-device section">
                <KeyboardIllustration />
                <h3>等待设备连接</h3>
                <p>Runtime 发现键盘后，可以在这里调整键位和屏幕。</p>
              </div>
            )
          ) : null}
          {page === "tasks" ? (
            <>
              <div className="page-heading section">
                <div>
                  <div className="eyebrow">OPERATION HISTORY</div>
                  <h1>任务记录</h1>
                  <p>断线不会重发写入；保留原任务，核对实际结果。</p>
                </div>
              </div>
              <Tasks runtime={runtime} controller={controller} />
            </>
          ) : null}
          {page === "system" ? <SystemPanel runtime={runtime} /> : null}
          {focusedOperation ? (
            <OperationDialog
              id={focusedOperation}
              runtime={runtime}
              controller={controller}
              onClose={() => setFocusedOperation(null)}
            />
          ) : null}
          <footer>
            <span>你的设备，由你掌控。</span>
            <span>AhaKey Studio</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
