import { test, expect } from "@playwright/test";
import { installRuntime } from "./support/runtime-fixture";
import { auditLayout } from "./support/visual-audit";

test("all workspace pages use readable type and fit the desktop viewport", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("ahakey.studio.setup.v1", "seen"),
  );
  await installRuntime(page);
  await page.setViewportSize({ width: 1120, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "动作类型" })).toBeVisible();
  await auditLayout(page, "keymap");
  await page
    .getByRole("combobox", { name: "动作类型", exact: true })
    .selectOption("macro");
  await page.getByRole("button", { name: "＋ 添加步骤", exact: true }).click();
  await auditLayout(page, "macro");
  await page
    .getByRole("combobox", { name: "动作类型", exact: true })
    .selectOption("disabled");
  await auditLayout(page, "disabled-key");
  await page.getByRole("button", { name: "灯条与亮度", exact: true }).click();
  await auditLayout(page, "settings");
  await page
    .getByRole("textbox", { name: /提交键描述/ })
    .scrollIntoViewIfNeeded();
  await auditLayout(page, "settings-bottom");
  for (const [button, name] of [
    ["设备信息", "device"],
    ["系统与权限", "system"],
    ["任务记录", "tasks"],
  ]) {
    await page.getByRole("button", { name: button, exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await auditLayout(page, name);
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "帮助中心", exact: true }).click();
  for (const [index, topic] of [
    "总览",
    "键盘模式",
    "画布与按键",
    "LCD 屏幕",
    "任务与恢复",
    "权限诊断",
    "语音输入",
  ].entries()) {
    await page
      .getByRole("dialog")
      .getByRole("button", { name: topic, exact: true })
      .click();
    await auditLayout(page, `help-${index}`);
  }
  await page.keyboard.press("Escape");
  for (const [button, name] of [
    ["关于 AhaKey Studio", "about"],
    ["固件升级", "firmware"],
  ]) {
    await page.getByLabel("更多菜单", { exact: true }).click();
    await page.getByRole("button", { name: new RegExp(button) }).click();
    await auditLayout(page, name);
    await page.keyboard.press("Escape");
  }
  expect(
    await page.evaluate(() => (window as any).studioTest.requests),
  ).toHaveLength(0);
});
