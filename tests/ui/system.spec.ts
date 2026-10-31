import { test, expect } from "@playwright/test";
// Existing-user workspace fixture; first-install behavior is covered separately.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("ahakey.studio.setup.v1", "seen"),
  );
});

test("permission changes come from Runtime, settings navigation never grants permission", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as any;
    const listeners = new Map<string, any>();
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
          input: {
            status: "permissionDenied",
            permission: "denied",
            devices: [],
          },
        },
      },
    };
    w.settingsCalls = [];
    w.failSettings = false;
    w.updateInput = (input: any, status = "connected") => {
      view.status = status;
      view.inspection.snapshot.input = input;
      for (const channel of listeners.values())
        channel.onmessage(structuredClone(view));
    };
    let callback = 0;
    w.isTauri = true;
    w.__TAURI_INTERNALS__ = {
      transformCallback: () => ++callback,
      unregisterCallback: () => {},
      invoke: async (command: string, args: any) => {
        if (command === "runtime_input_settings")
          return {
            enabled: false,
            active: null,
            available: true,
            editable: false,
            mock: false,
          };
        if (command === "runtime_service_status")
          return {
            phase: "external",
            restarts: 0,
            childPid: null,
            updatedAtMs: 0,
            message: "独立 Runtime",
          };
        if (command === "runtime_watch") {
          listeners.set(args.listenerId, args.channel);
          args.channel.onmessage(structuredClone(view));
          return;
        }
        if (command === "runtime_unwatch") {
          listeners.delete(args.listenerId);
          return;
        }
        if (command === "system_open_settings") {
          w.settingsCalls.push(args.pane);
          if (w.failSettings)
            throw {
              code: "SETTINGS_UNAVAILABLE",
              message: "无法打开系统设置，请手动进入隐私与安全性。",
              outcomeUnknown: false,
            };
          return;
        }
        throw new Error(command);
      },
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "系统与权限", exact: true }).click();
  const panel = page.getByRole("region", { name: "输入监控状态" });
  await expect(panel).toContainText("权限未开启");
  await page
    .getByRole("button", { name: "打开输入监控权限", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("以后台更新的状态为准");
  await expect(panel).toContainText("未允许");
  await page.evaluate(() =>
    (window as any).updateInput({
      status: "listening",
      permission: "granted",
      devices: [{ inputDeviceId: "hid-a", name: "AhaKey X1" }],
    }),
  );
  await expect(panel).toContainText("已允许");
  await expect(panel).toContainText("已识别 1 个输入连接");
  await page.screenshot({
    path: "test-results/system-permissions.png",
    fullPage: true,
  });
  await page.evaluate(() =>
    (window as any).updateInput(
      { status: "listening", permission: "granted", devices: [] },
      "reconnecting",
    ),
  );
  await expect(panel).toContainText("状态未知");
  await expect(panel).not.toContainText("已允许");
  await page.evaluate(() => (window as any).updateInput(undefined));
  await expect(panel).toContainText("当前 Runtime 未提供输入状态");
  await page.evaluate(() => ((window as any).failSettings = true));
  await page.getByRole("button", { name: "打开蓝牙权限", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("无法打开系统设置");
  expect(await page.evaluate(() => (window as any).settingsCalls)).toEqual([
    "inputMonitoring",
    "bluetooth",
  ]);
});
