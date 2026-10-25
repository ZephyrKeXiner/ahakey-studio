import { InputSettings } from "./InputSettings";
import { ServicePanel } from "../../components/ServicePanel";
import { useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  describeError,
  openSystemSettings,
  type SettingsPane,
} from "../../runtime/client";
import type { ClientView } from "../../runtime/types";

const inputStatuses: Record<string, string> = {
  disabled: "未启用输入观察",
  starting: "正在启动",
  permissionRequired: "等待授权",
  permissionDenied: "权限未开启",
  deviceUnavailable: "等待键盘输入连接",
  listening: "正在观察键盘输入",
  error: "输入观察异常",
};
const permissionLabels: Record<string, string> = {
  unknown: "尚未核对",
  notDetermined: "尚未授权",
  denied: "未允许",
  granted: "已允许",
};
export function SystemPanel({ runtime }: { runtime: ClientView }) {
  const [busy, setBusy] = useState<SettingsPane | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const online = runtime.status === "connected";
  const input = online ? runtime.inspection?.snapshot.input : undefined;
  const desktop = isTauri();
  async function open(pane: SettingsPane) {
    setBusy(pane);
    setError(null);
    setOpened(false);
    try {
      await openSystemSettings(pane);
      setOpened(true);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="system-panel">
      <div className="page-heading">
        <div>
          <div className="eyebrow">SYSTEM INTEGRATION</div>
          <h1>系统与权限</h1>
          <p>查看后台上报的状态，处理 macOS 的连接权限。</p>
        </div>
      </div>
      <div className="system-card">
        <div className="section-heading">
          <h2>蓝牙连接</h2>
          <span className="badge">在系统设置中查看权限</span>
        </div>
        <p>
          蓝牙用于发现键盘、读取配置和执行写入。请在“隐私与安全性 → 蓝牙”中允许
          AhaKey 的后台组件。
        </p>
        <p className="field-hint">
          当前 Runtime
          未提供蓝牙授权状态；设备未连接也可能是关机、距离或配对问题。
        </p>
        <button
          className="secondary-button"
          disabled={!desktop || busy !== null}
          onClick={() => void open("bluetooth")}
        >
          {busy === "bluetooth" ? "正在打开…" : "打开蓝牙权限"}
        </button>
      </div>
      <div className="system-card" role="region" aria-label="输入监控状态">
        <div className="section-heading">
          <h2>输入监控</h2>
          <span
            className={`badge ${input?.permission === "granted" ? "positive" : ""}`}
          >
            {input
              ? (permissionLabels[input.permission] ?? "尚未核对")
              : "状态未知"}
          </span>
        </div>
        <InputSettings />
        <h3>
          {!online
            ? "等待 Runtime 连接"
            : input
              ? (inputStatuses[input.status] ?? "暂不识别此状态")
              : "当前 Runtime 未提供输入状态"}
        </h3>
        <p>
          用于观察 AhaKey 的按键输入。授权结果由实际运行的后台组件上报；退出
          Studio 后由 Runtime 继续管理。
        </p>
        {input?.status === "disabled" ? (
          <p className="inline-notice">
            当前后台未启用输入观察。只编辑键位或上传画面无需开启这项权限。
          </p>
        ) : null}
        {input?.status === "permissionRequired" ||
        input?.status === "permissionDenied" ? (
          <p className="inline-notice">
            请在“隐私与安全性 → 输入监控”中开启系统列出的 AhaKey
            组件，然后返回这里核对。若系统要求退出并重新打开，请先等待设备写入结束。
          </p>
        ) : null}
        {input?.status === "error" ? (
          <p className="inline-error">
            后台输入组件启动或运行失败。可先核对权限，再在概览中关闭并重新启动
            Runtime。
          </p>
        ) : null}
        {input?.status === "listening" && input.permission === "granted" ? (
          <p>已识别 {input.devices.length} 个输入连接。</p>
        ) : null}
        <button
          className="secondary-button"
          disabled={!desktop || busy !== null}
          onClick={() => void open("inputMonitoring")}
        >
          {busy === "inputMonitoring" ? "正在打开…" : "打开输入监控权限"}
        </button>
      </div>
      <ServicePanel />
      {opened ? (
        <p className="inline-notice" role="status">
          已打开系统设置。权限是否生效，以后台更新的状态为准。
        </p>
      ) : null}
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {!desktop ? (
        <p className="field-hint">请在桌面应用中打开系统设置。</p>
      ) : null}
    </section>
  );
}
