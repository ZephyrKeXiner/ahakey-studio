import { test, expect } from "@playwright/test";
import { installRuntime } from "./support/runtime-fixture";
import { installWindowLifecycle } from "./support/window-fixture";

test("close releases the WebView and a recreated page restores drafts without writes", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("ahakey.studio.setup.v1", "seen"),
  );
  await installRuntime(page);
  await installWindowLifecycle(page);
  await page.goto("/");
  const key = page.getByRole("combobox", { name: "按键", exact: true });
  await key.selectOption("5");
  await expect
    .poll(() => page.evaluate(() => (window as any).windowTest.listeners()))
    .toBe(1);
  await page.evaluate(() => (window as any).windowTest.close());
  expect(await page.evaluate(() => (window as any).windowTest.calls)).toEqual([
    "plugin:window|destroy",
  ]);
  await page.reload();
  await expect(key).toHaveValue("5");
  expect(
    await page.evaluate(() => (window as any).studioTest.requests),
  ).toEqual([]);
  await expect
    .poll(() => page.evaluate(() => (window as any).windowTest.listeners()))
    .toBe(1);
});
