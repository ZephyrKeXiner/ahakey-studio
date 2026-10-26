import { test, expect, type Page } from "@playwright/test";
import { installRuntime, type Harness } from "./support/runtime-fixture";

async function openEditor(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "键位编辑", exact: true }).click();
}
async function sync(page: Page) {
  await page.getByRole("button", { name: "同步到编辑区", exact: true }).click();
  await page
    .getByRole("button", { name: "保存草稿并同步", exact: true })
    .click();
}
function fixture(page: Page, action: "complete" | "disconnect") {
  return page.evaluate(
    (action) =>
      (window as unknown as { studioTest: Harness }).studioTest[action](),
    action,
  );
}

test("explicit sync retains unknown keys and lets the user restore a previous draft", async ({
  page,
}) => {
  await installRuntime(page, true);
  await openEditor(page);
  await expect(
    page.getByText("已知 1 / 16 个键位", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("动作类型")).toHaveValue("unknown");
  await sync(page);
  await expect(
    page.getByRole("combobox", { name: "按键", exact: true }),
  ).toHaveValue("4");
  await expect(page.locator(".key-button").nth(1)).toContainText("未读取");
  await page
    .getByRole("combobox", { name: "按键", exact: true })
    .selectOption("5");
  await sync(page);
  await expect(
    page.getByRole("combobox", { name: "按键", exact: true }),
  ).toHaveValue("4");
  await page.getByRole("button", { name: "恢复上次同步前的草稿" }).click();
  await expect(
    page.getByRole("combobox", { name: "按键", exact: true }),
  ).toHaveValue("5");
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
  await sync(page);
  const key = page.getByRole("combobox", { name: "按键", exact: true });
  await key.selectOption("5");
  await page.getByRole("button", { name: "写入修改 · 1", exact: true }).click();
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
  await page.screenshot({
    path: "test-results/keymap-editor.png",
    fullPage: true,
  });
});

test("disconnect preserves local editing and disables submission", async ({
  page,
}) => {
  await installRuntime(page);
  await openEditor(page);
  await expect(
    page.getByText("已知 16 / 16 个键位", { exact: true }),
  ).toBeVisible();
  await sync(page);
  await fixture(page, "disconnect");
  await page
    .getByRole("combobox", { name: "按键", exact: true })
    .selectOption("6");
  await expect(
    page.getByRole("button", { name: "写入修改 · 1", exact: true }),
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
