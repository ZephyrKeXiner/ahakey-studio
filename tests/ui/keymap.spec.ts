import { test, expect, type Page } from "@playwright/test";
// Existing-user workspace fixture; first-install behavior is covered separately.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("ahakey.studio.setup.v1", "seen"),
  );
});

import { installRuntime, type Harness } from "./support/runtime-fixture";

async function openEditor(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "键位编辑", exact: true }).click();
}
function fixture(page: Page, action: "complete" | "disconnect") {
  return page.evaluate(
    (action) =>
      (window as unknown as { studioTest: Harness }).studioTest[action](),
    action,
  );
}

test("read keys appear immediately and refresh preserves unsaved edits", async ({
  page,
}) => {
  await installRuntime(page, true);
  await openEditor(page);
  await expect(
    page.getByText("已知 1 / 16 个键位", { exact: true }),
  ).toBeVisible();
  const key = page.getByRole("combobox", { name: "按键", exact: true });
  await expect(key).toHaveValue("4");
  await expect(
    page.getByRole("button", { name: "同步到编辑区", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Key 2 · 批准键", exact: true })
    .click();
  await expect(page.getByLabel("动作类型")).toHaveValue("unknown");
  await page
    .getByRole("button", { name: "Key 1 · Voice 键", exact: true })
    .click();
  await key.selectOption("5");
  await page.getByRole("button", { name: "刷新已知键位", exact: true }).click();
  await expect(key).toHaveValue("5");
  await expect(page.locator(".inspector-heading")).toContainText("未写入");
  await page.reload();
  await expect(key).toHaveValue("5");
  expect(
    await page.evaluate(
      () => (window as unknown as { studioTest: Harness }).studioTest.requests,
    ),
  ).toEqual([]);
});

test("one-key write preserves newer edits and recovers the original task after reload", async ({
  page,
}) => {
  await installRuntime(page);
  await openEditor(page);
  await expect(
    page.getByText("已知 16 / 16 个键位", { exact: true }),
  ).toBeVisible();
  const key = page.getByRole("combobox", { name: "按键", exact: true });
  await key.selectOption("5");
  await page.getByRole("button", { name: "写入修改，1", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("写入模式 1 的 1 个键位？");
  await dialog.getByRole("button", { name: "确认写入", exact: true }).click();
  await expect(page.getByText(/写入任务处理中或等待确认/)).toBeVisible();
  await key.selectOption("6");
  await page.reload();
  await page.getByRole("button", { name: "键位编辑", exact: true }).click();
  await expect(key).toHaveValue("6");
  await fixture(page, "complete");
  await expect(page.getByText(/写入任务处理中或等待确认/)).not.toBeVisible();
  await expect(key).toHaveValue("6");
  await expect(page.locator(".inspector-heading")).toContainText("未写入");
  const requests = await page.evaluate(
    () => (window as unknown as { studioTest: Harness }).studioTest.requests,
  );
  expect(requests).toHaveLength(1);
  expect(requests[0].keys).toEqual([
    { index: 0, action: { type: "shortcut", modifiers: [], keyCode: 5 } },
  ]);
});

test("disconnect preserves local editing and disables submission", async ({
  page,
}) => {
  await installRuntime(page);
  await openEditor(page);
  await expect(
    page.getByText("已知 16 / 16 个键位", { exact: true }),
  ).toBeVisible();
  await fixture(page, "disconnect");
  await page
    .getByRole("combobox", { name: "按键", exact: true })
    .selectOption("6");
  await expect(
    page.getByRole("button", { name: "写入修改，1", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("以下为上次连接的记录；设备恢复连接后自动更新。"),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { studioTest: Harness }).studioTest.requests,
    ),
  ).toEqual([]);
});

test("hardware read updates clean keys automatically and preserves edits made during the read", async ({
  page,
}) => {
  await installRuntime(page);
  await openEditor(page);
  const key = page.getByRole("combobox", { name: "按键", exact: true });
  await expect(key).toHaveValue("4");
  await page
    .getByRole("button", { name: "从设备完整读取", exact: true })
    .click();
  await expect(page.getByText("正在从设备读取，第 1 / 3 次")).toBeVisible();
  await expect(key).toHaveValue("4");
  await key.selectOption("5");
  await page.evaluate(() =>
    (window as unknown as { studioTest: Harness }).studioTest.finishRead(),
  );
  await expect(
    page.getByRole("button", { name: "从设备完整读取", exact: true }),
  ).toBeEnabled();
  await expect(key).toHaveValue("5");
  await page
    .getByRole("button", { name: "Key 2 · 批准键", exact: true })
    .click();
  await expect(key).toHaveValue("7");
  await expect(page.locator(".inspector-heading")).toContainText("设备当前值");
  await page.getByRole("tab", { name: "Codex", exact: true }).click();
  await expect(key).toHaveValue("7");
  await page.reload();
  await expect(key).toHaveValue("5");
  expect(
    await page.evaluate(
      () => (window as unknown as { studioTest: Harness }).studioTest.requests,
    ),
  ).toEqual([]);
});
