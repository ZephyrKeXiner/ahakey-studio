import { test, expect, type Page } from "@playwright/test";
import type {
  ClientView,
  ConfigurationDocument,
  KeymapRequest,
  Operation,
} from "../../src/runtime/types";

type Harness = {
  requests: KeymapRequest[];
  complete(): void;
  disconnect(): void;
};
async function installRuntime(page: Page, partial = false) {
  await page.addInitScript(
    ({ partial }) => {
      const w = window as unknown as {
        isTauri: boolean;
        __TAURI_INTERNALS__: unknown;
        studioTest: Harness;
      };
      const saved = sessionStorage.getItem("runtime-fixture");
      const roles = ["voice", "approve", "reject", "submit"];
      const initial: ConfigurationDocument = {
        deviceId: "mock-x1",
        baseToken: "base-a",
        configuration: partial
          ? null
          : {
              device: { brightnessPercent: 75 },
              modes: [0, 1, 2, 3].map((mode) => ({
                mode,
                lights: [],
                keys: roles.map((role) => ({
                  role,
                  description: role,
                  action: { type: "shortcut", modifiers: [], keyCode: 4 },
                })),
              })),
            },
        ...(partial
          ? {
              readback: {
                modes: [0, 1, 2, 3].map((mode) => ({
                  mode,
                  keys: roles.map((role, index) => ({
                    role,
                    description: null,
                    action:
                      mode === 0 && index === 0
                        ? {
                            type: "shortcut" as const,
                            modifiers: [],
                            keyCode: 4,
                          }
                        : null,
                  })),
                })),
              },
            }
          : {}),
      };
      const state: {
        document: ConfigurationDocument;
        requests: KeymapRequest[];
        operations: Operation[];
      } = saved
        ? JSON.parse(saved)
        : { document: initial, requests: [], operations: [] };
      const view: ClientView = {
        status: "connected",
        generation: 1,
        error: null,
        configurationEpochs: {},
        inspection: {
          instanceId: "test-runtime",
          runtimeVersion: "0.1.0",
          protocol: { major: 1, minor: 0 },
          methods: ["configuration.get", "keymap.apply", "operation.get"],
          snapshot: {
            instanceId: "test-runtime",
            sequence: "0",
            devices: [
              {
                deviceId: "mock-x1",
                name: "AhaKey X1 (UI fixture)",
                connectionState: "ready",
                batteryPercent: 80,
                workMode: 0,
                lever: "up",
              },
            ],
            operations: state.operations,
          },
        },
      };
      const listeners = new Map<
        string,
        { onmessage: (view: ClientView) => void }
      >();
      function publish() {
        sessionStorage.setItem("runtime-fixture", JSON.stringify(state));
        for (const channel of listeners.values())
          channel.onmessage(structuredClone(view));
      }
      let callback = 0;
      w.isTauri = true;
      w.__TAURI_INTERNALS__ = {
        transformCallback: () => ++callback,
        unregisterCallback: () => {},
        invoke: async (command: string, args: any) => {
          if (command === "runtime_service_status")
            return {
              phase: "external",
              restarts: 0,
              childPid: null,
              updatedAtMs: 0,
              message: "已连接独立 Runtime。",
            };
          if (command === "runtime_watch") {
            listeners.set(args.listenerId, args.channel);
            publish();
            return;
          }
          if (command === "runtime_unwatch") {
            listeners.delete(args.listenerId);
            return;
          }
          if (command === "runtime_configuration")
            return structuredClone(state.document);
          if (command === "runtime_operation") {
            const operation = state.operations.find(
              (op) => op.operationId === args.operationId,
            );
            if (!operation)
              throw {
                code: "NOT_FOUND",
                message: "任务不存在",
                outcomeUnknown: false,
              };
            return structuredClone(operation);
          }
          if (command === "runtime_keymap") {
            state.requests.push(structuredClone(args.request));
            state.operations.push({
              operationId: args.request.operationId,
              deviceId: "mock-x1",
              status: "running",
              progress: 0.5,
              effect: "unknown",
              errorCode: null,
            });
            publish();
            return {
              operationId: args.request.operationId,
              status: "accepted",
            };
          }
          throw new Error(`Unexpected command ${command}`);
        },
      };
      w.studioTest = {
        requests: state.requests,
        complete() {
          const request = state.requests.at(-1)!;
          for (const key of request.keys) {
            const mode = state.document.configuration?.modes.find(
              (mode) => mode.mode === request.mode,
            );
            if (mode) mode.keys[key.index].action = structuredClone(key.action);
          }
          Object.assign(
            state.operations.find(
              (op) => op.operationId === request.operationId,
            )!,
            { status: "completed", progress: 1, effect: "complete" },
          );
          state.document.baseToken = "base-b";
          view.configurationEpochs["mock-x1"] = "1";
          publish();
        },
        disconnect() {
          view.status = "reconnecting";
          publish();
        },
      };
    },
    { partial },
  );
}
async function openEditor(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "编辑键位", exact: true }).click();
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
  await page.getByRole("button", { name: "编辑键位", exact: true }).click();
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
