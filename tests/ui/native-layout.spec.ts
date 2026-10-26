import { test, expect } from "@playwright/test";
import { installRuntime } from "./support/runtime-fixture";

test("canvas selection shares the mode and key with the editor without writing on navigation", async ({
  page,
}) => {
  await installRuntime(page);
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");
  await expect(
    page.getByRole("tab", { name: "Claude", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "同步到编辑区", exact: true }).click();
  await page
    .getByRole("button", { name: "保存草稿并同步", exact: true })
    .click();
  await page.screenshot({ path: "test-results/native-workspace.png" });
  await page.getByRole("tab", { name: "Claude", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Cursor", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Key 3 · 拒绝键", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "配置检查器" }),
  ).toContainText("Key 3");
  await page
    .getByRole("combobox", { name: "按键", exact: true })
    .selectOption("5");
  await page.getByRole("tab", { name: "Codex", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "按键", exact: true }),
  ).toHaveValue("4");
  await page.getByRole("tab", { name: "Cursor", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "按键", exact: true }),
  ).toHaveValue("5");
  expect(
    await page.evaluate(() => (window as any).studioTest.requests),
  ).toHaveLength(0);
  await page.getByRole("button", { name: "写入修改 · 1", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "写入模式 2 的 1 个键位",
  );
  await page.getByRole("button", { name: "确认写入", exact: true }).click();
  const requests = await page.evaluate(
    () => (window as any).studioTest.requests,
  );
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    mode: 1,
    keys: [{ index: 2, action: { keyCode: 5 } }],
  });
});

test("help, capability notices and keyboard access work without a Runtime", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "连接你的 AhaKey" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "帮助中心", exact: true }).click();
  const help = page.getByRole("dialog", {
    name: "AhaKey Studio 帮助中心",
    exact: true,
  });
  await expect(help).toBeVisible();
  await help.getByRole("button", { name: "LCD 屏幕", exact: true }).click();
  await expect(help).toContainText("160 × 80");
  await page.screenshot({ path: "test-results/native-help.png" });
  await page.keyboard.press("Escape");
  await expect(help).not.toBeVisible();
  await page.getByRole("button", { name: /^语音输入/ }).click();
  await expect(page.getByRole("dialog")).toContainText("请连接支持语音输入的新版 Runtime");
  await expect(page.getByRole("textbox", { name: "语音转写结果" })).toHaveValue("");
  await page.keyboard.press("Escape");
  await page.getByLabel("更多菜单", { exact: true }).click();
  await page.getByRole("button", { name: /固件升级/ }).click();
  await expect(page.getByRole("dialog")).toContainText("固件升级尚未接入");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "test-results/native-disconnected.png" });
});

test("canvas and inspector fit the minimum desktop width", async ({ page }) => {
  await installRuntime(page);
  await page.setViewportSize({ width: 900, height: 640 });
  await page.goto("/");
  const canvas = page.getByRole("region", { name: "键盘配置画布" });
  for (const name of [
    "Key 1 · Voice 键",
    "Key 4 · 提交键",
    "LCD 屏幕",
    "灯条与亮度",
  ]) {
    const bounds = await canvas
      .getByRole("button", { name, exact: true })
      .boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(900);
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(900);
  await page.screenshot({ path: "test-results/native-compact.png" });
});
