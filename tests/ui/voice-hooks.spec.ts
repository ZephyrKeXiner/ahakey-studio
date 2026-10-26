import { test, expect, type Page } from "@playwright/test";

async function install(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    const saved = sessionStorage.getItem("voice-hooks-fixture");
    const view = saved
      ? JSON.parse(saved)
      : {
          status: "connected",
          generation: 1,
          error: null,
          configurationEpochs: {},
          inspection: {
            instanceId: "r",
            runtimeVersion: "0.1.0",
            protocol: { major: 1, minor: 0 },
            methods: [
              "voice.get",
              "voice.configure",
              "voice.control",
              "hooks.get",
              "hooks.configure",
              "hooks.decide",
              "hooks.select",
            ],
            snapshot: {
              instanceId: "r",
              sequence: "0",
              operations: [],
              devices: [
                {
                  deviceId: "x1",
                  name: "AhaKey",
                  connectionState: "ready",
                  batteryPercent: 80,
                  workMode: 0,
                  lever: "manual",
                },
              ],
              input: {
                status: "listening",
                permission: "granted",
                devices: [{ inputDeviceId: "hid-1", name: "AhaKey" }],
              },
              voice: {
                available: true,
                status: "idle",
                sessionId: null,
                text: "",
                error: null,
                microphone: "granted",
                speech: "granted",
                accessibility: true,
                output: null,
                preferences: {
                  enabled: false,
                  inputDeviceId: null,
                  trigger: "hold",
                  locale: "zh-CN",
                  autoInsert: false,
                  onDeviceOnly: false,
                },
              },
              hooks: {
                revision: 0,
                preferences: {
                  enabled: false,
                  deviceId: null,
                  allowAutomatic: false,
                  inputDeviceId: null,
                  approveUsage: null,
                  rejectUsage: null,
                },
                selectedRequestId: null,
                learning: null,
                sessions: [],
                approvals: [],
              },
            },
          },
        };
    const calls: any[] = [];
    const listeners = new Map();
    function publish() {
      sessionStorage.setItem("voice-hooks-fixture", JSON.stringify(view));
      for (const channel of listeners.values())
        channel.onmessage(structuredClone(view));
    }
    w.featuresTest = {
      calls,
      final(text: string) {
        view.inspection.snapshot.voice.text = text;
        view.inspection.snapshot.voice.status = "completed";
        publish();
      },
      approval() {
        view.inspection.snapshot.hooks.approvals = [
          {
            requestId: "approval-123",
            decision: "pending",
            expiresAtMs: Date.now() + 60000,
            context: {
              tool: "codex",
              sessionId: "thread-1",
              event: "PermissionRequest",
              cwd: "/project",
              toolName: "Bash",
              summary: "echo hello",
            },
          },
        ];
        publish();
      },
      disconnect() {
        view.status = "reconnecting";
        publish();
      },
    };
    w.isTauri = true;
    w.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
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
        if (command === "runtime_service_status")
          return {
            phase: "external",
            restarts: 0,
            childPid: null,
            updatedAtMs: 0,
            message: "已连接",
          };
        if (command === "runtime_configuration")
          return { deviceId: "x1", baseToken: "base", configuration: null };
        if (command === "runtime_voice") {
          calls.push({ command, ...args });
          const voice = view.inspection.snapshot.voice;
          if (args.method === "voice.configure")
            voice.preferences = args.params;
          if (args.method === "voice.control") {
            if (args.params.action === "start") {
              voice.sessionId = "voice-123";
              voice.status = "recording";
            }
            if (args.params.action === "stop") voice.status = "finalizing";
            if (args.params.action === "copy") voice.output = "copied";
            if (args.params.action === "cancel") {
              voice.sessionId = null;
              voice.status = "idle";
              voice.text = "";
            }
          }
          publish();
          return structuredClone(voice);
        }
        if (command === "runtime_hooks") {
          calls.push({ command, ...args });
          const hooks = view.inspection.snapshot.hooks;
          if (args.method === "hooks.configure")
            hooks.preferences = args.params;
          if (args.method === "hooks.decide")
            hooks.approvals.find(
              (r: any) => r.requestId === args.params.requestId,
            ).decision = args.params.decision;
          publish();
          return structuredClone(hooks);
        }
        if (command === "runtime_hook_config") {
          calls.push({ command, ...args });
          return {
            hooks: {
              PermissionRequest: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: "ahakey-hook --tool " + args.tool,
                    },
                  ],
                },
              ],
            },
          };
        }
        throw new Error(command);
      },
    };
  });
}
test("voice recording is explicit, stop targets the original session, and reload restores the result", async ({
  page,
}) => {
  await install(page);
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");
  await page.getByRole("button", { name: /^语音输入/ }).click();
  await expect(page.getByRole("textbox", { name: "语音转写结果" })).toHaveValue(
    "",
  );
  expect(
    await page.evaluate(() => (window as any).featuresTest.calls),
  ).toHaveLength(0);
  await page.getByLabel("输入设备", { exact: true }).selectOption("hid-1");
  await page.getByLabel("录音方式", { exact: true }).selectOption("toggle");
  await page.getByLabel("启用 Voice 键录音").check();
  await page.getByRole("button", { name: "保存录音设置" }).click();
  expect(
    await page.evaluate(() => (window as any).featuresTest.calls[0]),
  ).toMatchObject({
    method: "voice.configure",
    params: { enabled: true, inputDeviceId: "hid-1", trigger: "toggle" },
  });
  await page.getByRole("button", { name: "开始试录" }).click();
  await page.getByRole("button", { name: "结束录音" }).click();
  expect(
    await page.evaluate(() => (window as any).featuresTest.calls.at(-1)),
  ).toMatchObject({
    method: "voice.control",
    params: { action: "stop", sessionId: "voice-123" },
  });
  await page.evaluate(() =>
    (window as any).featuresTest.final("这是一段转写结果"),
  );
  await page.screenshot({ path: "test-results/voice-input.png" });
  await page.reload();
  await page.getByRole("button", { name: /^语音输入/ }).click();
  await expect(page.getByRole("textbox", { name: "语音转写结果" })).toHaveValue(
    "这是一段转写结果",
  );
  await page.getByRole("button", { name: "复制结果", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("已复制");
  await page.evaluate(() => (window as any).featuresTest.disconnect());
  await expect(page.getByRole("button", { name: "开始试录" })).toBeDisabled();
});
test("AI integration requires explicit enable and approval targets the displayed request", async ({
  page,
}) => {
  await install(page);
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto("/");
  await page.getByRole("button", { name: "AI 编程联动", exact: true }).click();
  expect(
    await page.evaluate(() => (window as any).featuresTest.calls),
  ).toHaveLength(0);
  await page.getByLabel("关联键盘").selectOption("x1");
  await page.getByLabel("启用 AI 编程联动", { exact: true }).check();
  await page.getByRole("button", { name: "应用联动设置" }).click();
  expect(
    await page.evaluate(() => (window as any).featuresTest.calls[0]),
  ).toMatchObject({
    method: "hooks.configure",
    params: { enabled: true, deviceId: "x1", allowAutomatic: false },
  });
  await page.evaluate(() => (window as any).featuresTest.approval());
  await expect(page.getByRole("dialog")).toContainText("echo hello");
  await page.screenshot({ path: "test-results/ai-integration.png" });
  await page.getByRole("button", { name: "拒绝本次" }).click();
  expect(
    await page.evaluate(() => (window as any).featuresTest.calls.at(-1)),
  ).toMatchObject({
    method: "hooks.decide",
    params: { requestId: "approval-123", decision: "deny" },
  });
  await page.getByLabel("工具", { exact: true }).selectOption("codex");
  await page.getByRole("button", { name: "生成接入配置" }).click();
  await expect(
    page.getByRole("textbox", { name: "Hook 接入配置" }),
  ).toContainText("--tool codex");
  await page.evaluate(() => (window as any).featuresTest.disconnect());
  await expect(
    page.getByRole("button", { name: "应用联动设置" }),
  ).toBeDisabled();
});
