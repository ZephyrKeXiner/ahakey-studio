import { useState } from "react";
import type { ClientView } from "../../runtime/types";
import { SystemPanel } from "../system/SystemPanel";
import { VoicePanel } from "../voice/VoicePanel";
import { ToolConnection } from "../hooks/ToolConnection";
import { ServicePanel } from "../../components/ServicePanel";

export const SETUP_KEY = "ahakey.studio.setup.v1";
export function needsSetup(): boolean {
  try {
    return localStorage.getItem(SETUP_KEY) !== "seen";
  } catch {
    return true;
  }
}
export function rememberSetup(): void {
  try {
    localStorage.setItem(SETUP_KEY, "seen");
  } catch {
    /* The guide stays available from the toolbar. */
  }
}
export function SetupGuide({
  runtime,
  onClose,
}: {
  runtime: ClientView;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const snapshot = runtime.inspection?.snapshot;
  const connected = runtime.status === "connected";
  const keyboard =
    connected && snapshot?.devices.some((d) => d.connectionState === "ready");
  const voice = connected && snapshot?.voice?.preferences.enabled;
  function finish() {
    rememberSetup();
    onClose();
  }
  return (
    <div className="setup-guide">
      <nav className="setup-steps" aria-label="设置步骤">
        {["连接键盘", "语音与权限", "连接开发工具", "完成"].map(
          (name, index) => (
            <button
              key={name}
              aria-current={step === index ? "step" : undefined}
              className={step === index ? "primary-button" : "secondary-button"}
              onClick={() => setStep(index)}
            >
              {name}
            </button>
          ),
        )}
      </nav>
      {step === 0 ? (
        <section className="system-card">
          <h3>{keyboard ? "键盘已连接" : "打开 AhaKey 键盘"}</h3>
          {!keyboard ? <p>开启键盘与蓝牙，等待连接。</p> : null}
          <ServicePanel />
        </section>
      ) : null}
      {step === 1 ? (
        <>
          <SystemPanel runtime={runtime} />
          <VoicePanel key={runtime.generation} runtime={runtime} />
        </>
      ) : null}
      {step === 2 ? <ToolConnection runtime={runtime} /> : null}
      {step === 3 ? (
        <section className="system-card">
          <h3>设置进度</h3>
          <ul>
            <li>键盘：{keyboard ? "已连接" : "等待连接"}</li>
            <li>语音键：{voice ? "已启用" : "尚未启用"}</li>
          </ul>
          <button className="primary-button" onClick={finish}>
            进入 Studio
          </button>
        </section>
      ) : null}
      <div className="voice-actions">
        {step > 0 ? (
          <button onClick={() => setStep(step - 1)}>上一步</button>
        ) : null}
        {step < 3 ? (
          <button className="primary-button" onClick={() => setStep(step + 1)}>
            下一步
          </button>
        ) : null}
        <button className="text-button" onClick={finish}>
          稍后设置
        </button>
      </div>
    </div>
  );
}
