import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  describeError,
  readInputSettings,
  saveInputSettings,
  type InputSettingsState,
} from "../../runtime/client";
export function InputSettings() {
  const [settings, setSettings] = useState<InputSettingsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  const saving = useRef(false);
  useEffect(() => {
    if (!isTauri()) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const version = revision.current;
      try {
        const result = await readInputSettings();
        if (!stopped && !saving.current && version === revision.current)
          setSettings(result);
      } catch (cause) {
        if (!stopped && !saving.current && version === revision.current)
          setError(describeError(cause));
      } finally {
        if (!stopped) timer = setTimeout(poll, 2000);
      }
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  async function change(enabled: boolean) {
    revision.current += 1;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      setSettings(await saveInputSettings(enabled));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  if (!isTauri()) return null;
  return (
    <div className="input-settings" role="region" aria-label="后台输入观察设置">
      <label className="input-toggle">
        <input
          type="checkbox"
          checked={settings?.enabled ?? false}
          disabled={
            busy ||
            !settings ||
            !settings.editable ||
            (!settings.available && !settings.enabled)
          }
          onChange={(event) => void change(event.target.checked)}
        />
        后台输入观察
      </label>
      {!settings ? (
        <p>{error ? "设置暂不可用" : "正在读取后台设置…"}</p>
      ) : !settings.editable ? (
        <p>
          当前是独立启动的
          Runtime，请在它的启动来源设置。这里仍会显示它上报的权限状态。
        </p>
      ) : (
        <>
          <p>
            设置在下次启动后台时生效。开启后由 Runtime
            启动原生输入组件，首次使用时 macOS 可能请求输入监控权限。
          </p>
          {!settings.available ? (
            <p className="inline-error">
              缺少配套输入组件，请准备原生组件或安装完整应用。
            </p>
          ) : null}
          {settings.active !== null && settings.active !== settings.enabled ? (
            <p className="inline-notice">
              已保存，等待下次后台启动。待任务结束后，可在下方关闭并重新启动
              Runtime；当前任务会继续。
            </p>
          ) : null}
          {settings.mock ? (
            <p className="field-hint">
              当前为模拟设备模式，不会启动真实输入监听。
            </p>
          ) : null}
        </>
      )}
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
