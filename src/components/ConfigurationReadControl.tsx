import { useRef, useState } from "react";
import { startConfigurationRead, describeError } from "../runtime/client";
import type { ClientView, ConfigurationDocument } from "../runtime/types";

export function ConfigurationReadControl({
  runtime,
  deviceId,
  document,
  disabled,
  onRefresh,
  readbackMessage = "读回完成，请同步到编辑区。",
}: {
  runtime: ClientView;
  deviceId: string;
  document: ConfigurationDocument | null;
  disabled: boolean;
  onRefresh: () => Promise<void>;
  readbackMessage?: string;
}) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(runtime);
  live.current = runtime;
  const supported =
    runtime.inspection?.methods.includes("configuration.read") ?? false;
  const read = document?.read;
  const reading = read?.status === "reading";
  async function start() {
    const generation = runtime.generation;
    setStarting(true);
    setError(null);
    try {
      await startConfigurationRead(generation, deviceId);
      if (
        live.current.generation === generation &&
        live.current.status === "connected"
      )
        await onRefresh();
    } catch (cause) {
      if (live.current.generation === generation)
        setError(describeError(cause));
    } finally {
      setStarting(false);
    }
  }
  const failure =
    read?.errorCode === "UNSUPPORTED_CONFIGURATION" ||
    read?.errorCode === "UNSUPPORTED_CAPABILITY"
      ? "当前设备固件不支持完整配置读回。"
      : `设备读取失败（${read?.errorCode ?? "未知原因"}），可以手动重试。`;
  return (
    <div className="configuration-read-control">
      <div>
        <strong>
          {reading
            ? `正在从设备读取，第 ${Math.max(1, read.attempt)} / ${read.maxAttempts} 次`
            : "设备配置"}
        </strong>
        {!document?.readback || reading || readbackMessage ? (
          <p>
            {reading
              ? "正在读取四个模式…"
              : document?.readback
                ? readbackMessage
                : "尚未读取完整配置。"}
          </p>
        ) : null}
        {!supported ? (
          <p>当前 Runtime 未提供设备读取入口，请更新配套 Runtime。</p>
        ) : null}
        {read?.status === "failed" ? <p role="alert">{failure}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
      </div>
      <button
        className="secondary-button"
        disabled={disabled || starting || reading || !supported}
        onClick={() => void start()}
      >
        {starting || reading
          ? "正在读取设备…"
          : read?.status === "failed"
            ? "重试设备读取"
            : "从设备完整读取"}
      </button>
    </div>
  );
}
