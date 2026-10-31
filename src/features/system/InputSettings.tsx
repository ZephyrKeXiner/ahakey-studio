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
        <p>当前后台独立运行，请在启动来源更改设置。</p>
      ) : (
        <>
          {!settings.available ? (
            <p className="inline-error">
              缺少配套输入组件，请准备原生组件或安装完整应用。
            </p>
          ) : null}
          {settings.active !== null && settings.active !== settings.enabled ? (
            <p className="inline-notice">已保存，等待下次后台启动。</p>
          ) : null}
          {settings.mock ? (
            <p className="field-hint">模拟模式，不启用输入监听。</p>
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
