import { test, expect } from "@playwright/test";
import { installRuntime } from "./support/runtime-fixture";

test("opening device information starts on its title and Tab still highlights controls", async ({
  page,
}) => {
  await installRuntime(page);
  await page.addInitScript(() =>
    localStorage.setItem("ahakey.studio.setup.v1", "seen"),
  );
  await page.goto("/");
  const opener = page.getByRole("button", { name: "设备信息", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "设备信息", exact: true });
  await expect(
    dialog.getByRole("heading", { name: "设备信息", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  const identifier = dialog.locator("summary").filter({ hasText: "设备标识" });
  await expect(identifier).toBeFocused();
  await expect(identifier).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByRole("heading", { name: "设备信息", exact: true }),
  ).toBeFocused();
});

test("write confirmation keeps cancel as the initial action", async ({
  page,
}) => {
  await installRuntime(page);
  await page.addInitScript(() =>
    localStorage.setItem("ahakey.studio.setup.v1", "seen"),
  );
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "按键", exact: true })
    .selectOption("5");
  await page.getByRole("button", { name: "写入修改，1", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }),
  ).toBeFocused();
});
