import type { Action, MacroStep, Modifier } from "../../runtime/types";
import { validateAction } from "./model";

const keyNames = new Map<number, string>([
  [0, "仅修饰键"],
  ...Array.from(
    { length: 26 },
    (_, index) =>
      [index + 4, String.fromCharCode(65 + index)] as [number, string],
  ),
  ...Array.from(
    { length: 9 },
    (_, index) => [index + 30, String(index + 1)] as [number, string],
  ),
  [39, "0"],
  [40, "Enter"],
  [41, "Esc"],
  [42, "Backspace"],
  [43, "Tab"],
  [44, "Space"],
  ...Array.from(
    { length: 12 },
    (_, index) => [index + 58, `F${index + 1}`] as [number, string],
  ),
  [79, "→"],
  [80, "←"],
  [81, "↓"],
  [82, "↑"],
  ...Array.from(
    { length: 12 },
    (_, index) => [index + 104, `F${index + 13}`] as [number, string],
  ),
]);
const modifierNames: Record<Modifier, string> = {
  control: "Ctrl",
  shift: "Shift",
  alt: "Option / Alt",
  gui: "Command / Win",
};
export function actionLabel(action: Action | null): string {
  if (!action) return "未读取";
  if (action.type === "disabled") return "禁用";
  if (action.type === "macro") return `宏，${action.steps.length} 步`;
  return [
    ...action.modifiers.map((modifier) => modifierNames[modifier]),
    keyNames.get(action.keyCode) ?? `HID ${action.keyCode}`,
  ].join(" + ");
}
function KeyCode({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
}) {
  return (
    <label className="field-label">
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {[...keyNames].map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
        {!keyNames.has(value) ? (
          <option value={value}>HID {value}</option>
        ) : null}
      </select>
      <span className="numeric-code">
        HID{" "}
        <input
          aria-label={`${label} HID 键码`}
          type="number"
          min={0}
          max={255}
          step={1}
          value={Number.isFinite(value) ? value : ""}
          onChange={(event) =>
            onChange(
              event.target.value === "" ? NaN : Number(event.target.value),
            )
          }
        />
      </span>
    </label>
  );
}
const stepNames = {
  keyDown: "按下",
  keyUp: "松开",
  delay: "等待",
  releaseAll: "释放全部",
  noOp: "空步骤",
};
function newStep(type: MacroStep["type"]): MacroStep {
  if (type === "keyDown" || type === "keyUp") return { type, keyCode: 4 };
  if (type === "delay") return { type, delayMs: 30 };
  return { type };
}
export function ActionEditor({
  action,
  onChange,
}: {
  action: Action | null;
  onChange: (action: Action) => void;
}) {
  const error = action ? validateAction(action) : null;
  function changeType(type: string) {
    if (type === "disabled") onChange({ type: "disabled" });
    if (type === "shortcut")
      onChange({ type: "shortcut", modifiers: [], keyCode: 4 });
    if (type === "macro")
      onChange({
        type: "macro",
        steps: [
          { type: "keyDown", keyCode: 4 },
          { type: "keyUp", keyCode: 4 },
        ],
      });
  }
  function replaceStep(index: number, step: MacroStep) {
    if (action?.type === "macro")
      onChange({
        ...action,
        steps: action.steps.map((old, i) => (i === index ? step : old)),
      });
  }
  function moveStep(index: number, direction: number) {
    if (action?.type !== "macro") return;
    const steps = [...action.steps];
    [steps[index], steps[index + direction]] = [
      steps[index + direction],
      steps[index],
    ];
    onChange({ ...action, steps });
  }
  return (
    <div className="action-editor">
      <label className="field-label">
        动作类型
        <select
          aria-label="动作类型"
          value={action?.type ?? "unknown"}
          onChange={(event) => changeType(event.target.value)}
        >
          <option value="unknown" disabled>
            选择动作
          </option>
          <option value="shortcut">快捷键</option>
          <option value="macro">宏</option>
          <option value="disabled">禁用</option>
        </select>
      </label>
      {action?.type === "shortcut" ? (
        <>
          <KeyCode
            label="按键"
            value={action.keyCode}
            onChange={(keyCode) => onChange({ ...action, keyCode })}
          />
          <fieldset className="modifiers">
            <legend>修饰键</legend>
            {(Object.keys(modifierNames) as Modifier[]).map((modifier) => (
              <label key={modifier}>
                <input
                  type="checkbox"
                  checked={action.modifiers.includes(modifier)}
                  onChange={(event) =>
                    onChange({
                      ...action,
                      modifiers: event.target.checked
                        ? [...action.modifiers, modifier]
                        : action.modifiers.filter((item) => item !== modifier),
                    })
                  }
                />
                {modifierNames[modifier]}
              </label>
            ))}
          </fieldset>
        </>
      ) : null}
      {action?.type === "macro" ? (
        <div className="macro-editor">
          <div className="macro-heading">
            宏步骤 <span>{action.steps.length} / 49</span>
          </div>
          {action.steps.map((step, index) => (
            <div className="macro-step" key={index}>
              <span className="step-index">{index + 1}</span>
              <select
                aria-label={`步骤 ${index + 1} 类型`}
                value={step.type}
                onChange={(event) =>
                  replaceStep(
                    index,
                    newStep(event.target.value as MacroStep["type"]),
                  )
                }
              >
                {Object.entries(stepNames).map(([type, label]) => (
                  <option key={type} value={type}>
                    {label}
                  </option>
                ))}
              </select>
              {step.type === "keyDown" || step.type === "keyUp" ? (
                <input
                  aria-label={`步骤 ${index + 1} HID 键码`}
                  type="number"
                  min={0}
                  max={255}
                  value={Number.isFinite(step.keyCode) ? step.keyCode : ""}
                  onChange={(event) =>
                    replaceStep(index, {
                      ...step,
                      keyCode:
                        event.target.value === ""
                          ? NaN
                          : Number(event.target.value),
                    })
                  }
                />
              ) : null}
              {step.type === "delay" ? (
                <label>
                  <input
                    aria-label={`步骤 ${index + 1} 延时`}
                    type="number"
                    min={0}
                    max={765}
                    step={3}
                    value={Number.isFinite(step.delayMs) ? step.delayMs : ""}
                    onChange={(event) =>
                      replaceStep(index, {
                        ...step,
                        delayMs:
                          event.target.value === ""
                            ? NaN
                            : Number(event.target.value),
                      })
                    }
                  />{" "}
                  ms
                </label>
              ) : null}
              <div className="step-actions">
                <button
                  type="button"
                  aria-label={`上移步骤 ${index + 1}`}
                  disabled={index === 0}
                  onClick={() => moveStep(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`下移步骤 ${index + 1}`}
                  disabled={index === action.steps.length - 1}
                  onClick={() => moveStep(index, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`删除步骤 ${index + 1}`}
                  onClick={() =>
                    onChange({
                      ...action,
                      steps: action.steps.filter((_, i) => i !== index),
                    })
                  }
                >
                  ×
                </button>
              </div>
            </div>
          ))}
          <button
            className="secondary-button"
            type="button"
            disabled={action.steps.length >= 49}
            onClick={() =>
              onChange({
                ...action,
                steps: [...action.steps, { type: "releaseAll" }],
              })
            }
          >
            ＋ 添加步骤
          </button>
          <p className="field-hint">
            按下与松开使用 HID 键码；延时为 3 毫秒的倍数。
          </p>
        </div>
      ) : null}
      {action?.type === "disabled" ? (
        <p className="field-hint">写入后，这个键位在当前模式下不执行动作。</p>
      ) : null}
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
