import { test, expect } from "@playwright/test";
// Existing-user workspace fixture; first-install behavior is covered separately.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("ahakey.studio.setup.v1", "seen"),
  );
});

test("saves the next-launch preference and applies it only after explicit stop and start", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as any;
    const listeners = new Map<string, any>();
    const state = {
      enabled: false,
      active: false as boolean | null,
      available: true,
      editable: true,
      mock: false,
    };
    let phase = "running";
    let callback = 0;
    const view: any = {
      status: "connected",
      generation: 1,
      error: null,
      configurationEpochs: {},
      inspection: {
        instanceId: "a",
        runtimeVersion: "0.1.0",
        protocol: { major: 1, minor: 0 },
        methods: [],
        snapshot: {
          instanceId: "a",
          sequence: "0",
          devices: [],
          operations: [],
          input: { status: "disabled", permission: "unknown", devices: [] },
        },
      },
    };
    w.inputCalls = [];
    function publish() {
      for (const channel of listeners.values())
        channel.onmessage(structuredClone(view));
    }
    w.isTauri = true;
    w.__TAURI_INTERNALS__ = {
      transformCallback: () => ++callback,
      unregisterCallback: () => {},
      invoke: async (command: string, args: any) => {
        if (command === "runtime_watch") {
          listeners.set(args.listenerId, args.channel);
          publish();
          return;
        }
        if (command === "runtime_unwatch") {
          listeners.delete(args.listenerId);
          return;
        }
        if (command === "runtime_input_settings") return structuredClone(state);
        if (command === "runtime_set_input_monitor") {
          w.inputCalls.push({ command, enabled: args.enabled });
          state.enabled = args.enabled;
          return structuredClone(state);
        }
        if (command === "runtime_service_stop") {
          w.inputCalls.push({ command });
          phase = "stopped";
          state.active = null;
          view.status = "reconnecting";
          publish();
        }
        if (command === "runtime_service_start") {
          w.inputCalls.push({ command });
          phase = "running";
          state.active = state.enabled;
          view.status = "connected";
          view.generation++;
          view.inspection.snapshot.input = {
            status: "permissionRequired",
            permission: "notDetermined",
            devices: [],
          };
          publish();
        }
        if (
          [
            "runtime_service_status",
            "runtime_service_stop",
            "runtime_service_start",
          ].includes(command)
        )
          return {
            phase,
            restarts: 0,
            childPid: phase === "running" ? 1 : null,
            updatedAtMs: 0,
            message: "后台状态",
          };
        throw new Error(command);
      },
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "系统与权限", exact: true }).click();
  const toggle = page.getByRole("checkbox", {
    name: "后台输入观察",
    exact: true,
  });
  await expect(toggle).toBeEnabled();
  await toggle.check();
  await expect(toggle).toBeChecked();
  await expect(
    page.getByRole("region", { name: "后台输入观察设置" }),
  ).toContainText("已保存，等待下次后台启动");
  expect(await page.evaluate(() => (window as any).inputCalls)).toEqual([
    { command: "runtime_set_input_monitor", enabled: true },
  ]);
  await expect(
    page.getByRole("region", { name: "输入监控状态" }),
  ).toContainText("未启用输入观察");
  await page.getByRole("button", { name: "关闭 Runtime", exact: true }).click();
  await page
    .getByRole("dialog", { name: "关闭后台 Runtime？", exact: true })
    .getByRole("button", { name: "关闭 Runtime", exact: true })
    .click();
  await page.getByRole("button", { name: "启动 Runtime", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "输入监控状态" }),
  ).toContainText("等待授权");
  await expect(
    page.getByRole("region", { name: "后台输入观察设置" }),
  ).not.toContainText("已保存，等待下次后台启动");
  await expect(toggle).toBeChecked();
  expect(await page.evaluate(() => (window as any).inputCalls)).toEqual([
    { command: "runtime_set_input_monitor", enabled: true },
    { command: "runtime_service_stop" },
    { command: "runtime_service_start" },
  ]);
  await page.screenshot({
    path: "test-results/input-settings.png",
    fullPage: true,
  });
});
