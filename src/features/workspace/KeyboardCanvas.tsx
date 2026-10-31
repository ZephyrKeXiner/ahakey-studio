import type { Device } from "../../runtime/types";
import type { Workspace } from "../keymap/model";
import { keyId, roleNames } from "../keymap/model";
import { actionLabel } from "../keymap/ActionEditor";
import { descriptionId } from "../settings/model";
import { StudioIcon, type IconName } from "../../components/StudioIcon";

export const modeNames = ["Claude", "Cursor", "Codex", "custom"] as const;
export type CanvasPart = "keymap" | "settings" | "oled";
export function leverLabel(value: string | null | undefined) {
  return value === "automatic"
    ? "自动批准"
    : value === "manual"
      ? "手动批准"
      : "状态未知";
}
const keyIcons: IconName[] = ["microphone", "check", "close", "backspace"];
export function KeyboardCanvas({
  device,
  workspace,
  mode,
  selectedKey,
  part,
  online,
  onMode,
  onSelect,
  onLever,
}: {
  device?: Device;
  workspace: Workspace;
  mode: number;
  selectedKey: number;
  part: CanvasPart;
  online: boolean;
  onMode: (mode: number) => void;
  onSelect: (part: CanvasPart, index?: number) => void;
  onLever: () => void;
}) {
  const deviceId = device?.deviceId ?? "";
  const draft = workspace.devices[deviceId];
  const fields = workspace.settingsDrafts[deviceId]?.fields;
  return (
    <section className="canvas-pane" aria-label="键盘配置画布">
      <div className="canvas-mode-row">
        <h1>键盘模式</h1>
        <div
          className="mode-segments"
          role="tablist"
          aria-label="键盘模式"
          onKeyDown={(event) => {
            const next =
              event.key === "ArrowRight"
                ? (mode + 1) % 4
                : event.key === "ArrowLeft"
                  ? (mode + 3) % 4
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? 3
                      : null;
            if (next === null) return;
            event.preventDefault();
            onMode(next);
            event.currentTarget
              .querySelectorAll<HTMLButtonElement>("button")
              [next]?.focus();
          }}
        >
          {modeNames.map((name, index) => (
            <button
              key={name}
              role="tab"
              aria-label={name}
              tabIndex={mode === index ? 0 : -1}
              aria-selected={mode === index}
              onClick={() => onMode(index)}
            >
              {name}
              {Object.entries(draft?.keys ?? {}).some(
                ([id, key]) => id.startsWith(`${index}:`) && key.dirty,
              ) ? (
                <i className="mode-dirty" aria-label="有未写入修改" />
              ) : null}
            </button>
          ))}
        </div>
      </div>
      <div className="keyboard-stage">
        <div className="keyboard-board" aria-label="AhaKey X1 配置示意图">
          <button
            className={`board-light ${part === "settings" ? "selected" : ""}`}
            aria-label="灯条与亮度"
            aria-pressed={part === "settings"}
            onClick={() => onSelect("settings")}
          >
            <span className="board-part-label">灯条</span>
            <span className="light-track">
              {Array.from({ length: 10 }, (_, i) => (
                <i key={i} />
              ))}
            </span>
          </button>
          <button
            className={`board-display ${part === "oled" ? "selected" : ""}`}
            aria-label="LCD 屏幕"
            aria-pressed={part === "oled"}
            onClick={() => onSelect("oled")}
          >
            <span className="board-screen">
              <StudioIcon name="screen" size={28} />
              <span>屏幕</span>
              <small>160 × 80</small>
            </span>
          </button>
          <div className="board-key-bed">
            {keyIcons.map((icon, index) => {
              const key = draft?.keys[keyId(mode, index)];
              const description = fields?.[descriptionId(mode, index)]?.value;
              return (
                <button
                  key={index}
                  className={`board-key key-button ${part === "keymap" && selectedKey === index ? "selected" : ""}`}
                  aria-label={`Key ${index + 1}，${roleNames[index]}`}
                  aria-pressed={part === "keymap" && selectedKey === index}
                  onClick={() => onSelect("keymap", index)}
                >
                  <span className="key-cap">
                    <StudioIcon name={icon} size={40} />
                  </span>
                  <span className="key-caption">
                    {typeof description === "string" && description
                      ? description
                      : `Key ${index + 1}`}
                  </span>
                  <span className="key-binding">
                    {actionLabel(key?.action ?? null)}
                  </span>
                  {key?.dirty ? (
                    <i className="key-dirty" aria-label="未写入修改" />
                  ) : null}
                </button>
              );
            })}
          </div>
          <button
            className="board-mode"
            aria-label="切换编辑模式"
            onClick={() => onMode((mode + 1) % 4)}
          >
            <span>
              <StudioIcon name="refresh" size={22} />
            </span>
            <small>模式</small>
          </button>
          <button
            className="board-lever"
            aria-label="查看拨杆状态"
            onClick={onLever}
          >
            <span
              className={`lever-track ${online && device?.lever === "automatic" ? "up" : ""}`}
            >
              <i />
            </span>
            <small>{leverLabel(online ? device?.lever : null)}</small>
          </button>
        </div>
      </div>
      <div className="canvas-tools" aria-label="配置面板">
        <button
          aria-pressed={part === "keymap"}
          onClick={() => onSelect("keymap")}
        >
          <StudioIcon name="keyboard" size={17} />
          键位编辑
        </button>
        <button
          aria-pressed={part === "settings"}
          onClick={() => onSelect("settings")}
        >
          <StudioIcon name="light" size={17} />
          亮度与描述
        </button>
        <button aria-pressed={part === "oled"} onClick={() => onSelect("oled")}>
          <StudioIcon name="screen" size={17} />
          屏幕画面
        </button>
      </div>
    </section>
  );
}
