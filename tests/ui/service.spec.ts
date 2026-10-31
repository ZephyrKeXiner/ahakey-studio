import { auditLayout } from "./support/visual-audit";
import { test, expect } from "@playwright/test";
// Existing-user workspace fixture; first-install behavior is covered separately.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("ahakey.studio.setup.v1", "seen"),
  );
});

test("closing the managed Runtime requires confirmation and does not automatically restart", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.isTauri = true;
    const state = {
      phase: "running",
      restarts: 1,
      childPid: 123,
      updatedAtMs: 0,
      message: "Runtime 后台进程正在运行。",
    };
    w.serviceTest = { starts: 0, stops: 0 };
    let callback = 0;
    w.__TAURI_INTERNALS__ = {
      transformCallback: () => ++callback,
      unregisterCallback: () => {},
      invoke: async (command: string, args: any) => {
        if (command === "runtime_watch") {
          args.channel.onmessage({
            status: "connected",
            generation: 1,
            error: null,
            configurationEpochs: {},
            inspection: {
              protocol: { major: 1, minor: 0 },
              instanceId: "test",
              runtimeVersion: "0.1.0",
              methods: [],
              snapshot: {
                instanceId: "test",
                sequence: "0",
                devices: [],
                operations: [],
              },
            },
          });
          return;
        }
        if (command === "runtime_unwatch") return;
        if (command === "runtime_service_status") return structuredClone(state);
        if (command === "runtime_service_stop") {
          w.serviceTest.stops++;
          state.phase = "stopped";
          state.message = "Runtime 已关闭。";
          return structuredClone(state);
        }
        if (command === "runtime_service_start") {
          w.serviceTest.starts++;
          state.phase = "running";
          state.message = "Runtime 后台进程正在运行。";
          return structuredClone(state);
        }
        throw new Error(`Unexpected command ${command}`);
      },
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "设备信息", exact: true }).click();
  await page.getByRole("button", { name: "关闭 Runtime", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "关闭后台 Runtime？", exact: true }),
  ).toContainText("语音和审批联动停止");
  expect(await page.evaluate(() => (window as any).serviceTest.stops)).toBe(0);
  await auditLayout(page, "confirm-service");
  await page
    .getByRole("dialog", { name: "关闭后台 Runtime？", exact: true })
    .getByRole("button", { name: "关闭 Runtime", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "启动 Runtime", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => page.evaluate(() => (window as any).serviceTest.stops))
    .toBe(1);
  await page.waitForTimeout(2300);
  expect(await page.evaluate(() => (window as any).serviceTest.starts)).toBe(0);
  await page.getByRole("button", { name: "启动 Runtime", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "关闭 Runtime", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).serviceTest.starts)).toBe(1);
});
