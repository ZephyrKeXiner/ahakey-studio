import { installWindowLifecycle } from "./support/window-fixture";
import { auditLayout } from "./support/visual-audit";
import { test, expect } from "@playwright/test";
// Existing-user workspace fixture; first-install behavior is covered separately.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("ahakey.studio.setup.v1", "seen"),
  );
});

import type {
  ClientView,
  OledRequest,
  Operation,
  PreparedResource,
} from "../../src/runtime/types";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any;
    const saved = sessionStorage.getItem("oled-runtime-fixture");
    const state: {
      requests: OledRequest[];
      controls: { id: string; resume: boolean }[];
      operations: Operation[];
    } = saved
      ? JSON.parse(saved)
      : { requests: [], controls: [], operations: [] };
    const resource: PreparedResource = {
      resourceId: "a".repeat(64),
      width: 160,
      height: 80,
      frameCount: 1,
      intervalMs: 100,
      byteLength: 28672,
      crc32: 1,
    };
    const view: ClientView = {
      status: "connected",
      generation: 1,
      error: null,
      configurationEpochs: {},
      inspection: {
        instanceId: "test-runtime",
        runtimeVersion: "0.1.0",
        protocol: { major: 1, minor: 0 },
        methods: [
          "oled.upload",
          "oled.get",
          "configuration.get",
          "operation.get",
        ],
        snapshot: {
          instanceId: "test-runtime",
          sequence: "0",
          devices: [
            {
              deviceId: "mock-x1",
              name: "AhaKey X1 (UI fixture)",
              connectionState: "ready",
              workMode: 0,
              batteryPercent: 80,
              lever: "up",
            },
          ],
          operations: state.operations,
        },
      },
    };
    const listeners = new Map<string, any>();
    function publish() {
      sessionStorage.setItem("oled-runtime-fixture", JSON.stringify(state));
      for (const channel of listeners.values())
        channel.onmessage(structuredClone(view));
    }
    let callback = 0;
    w.isTauri = true;
    w.oledTest = state;
    w.preparedImages = [];
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      transformCallback: () => ++callback,
      unregisterCallback: () => {},
      invoke: async (command: string, args: any) => {
        if (command.startsWith("plugin:event|")) return 0;
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
        if (command === "runtime_prepare_resource") {
          if (!args.bytes.length) throw new Error("empty file");
          w.preparedImages.push(args.bytes);
          return resource;
        }
        if (command === "runtime_oled")
          return {
            profile: "x1-cp2-resource-v1",
            width: 160,
            height: 80,
            intervalMs: 100,
            entries: [
              ...[0, 1, 2, 3].map((mode) => ({
                target: { kind: "modeDefault", mode },
                valid: false,
                writeState: "empty",
                frameCount: 0,
                byteLength: 0,
                crc32: 0,
                maxFrames: 8,
              })),
              {
                target: { kind: "multiState", state: "done" },
                valid: false,
                writeState: "empty",
                frameCount: 0,
                byteLength: 0,
                crc32: 0,
                maxFrames: 12,
              },
            ],
          };
        if (command === "runtime_configuration")
          return {
            deviceId: "mock-x1",
            baseToken: "base-a",
            configuration: null,
          };
        if (command === "runtime_operation")
          return structuredClone(
            state.operations.find((op) => op.operationId === args.operationId),
          );
        if (command === "runtime_upload_oled") {
          state.requests.push(structuredClone(args.request));
          state.operations.push({
            operationId: args.request.operationId,
            deviceId: "mock-x1",
            status: "running",
            progress: 0.4,
            effect: "unknown",
            errorCode: null,
          });
          publish();
          return { operationId: args.request.operationId, status: "accepted" };
        }
        if (command === "runtime_control_operation") {
          state.controls.push({ id: args.operationId, resume: args.resume });
          const op = state.operations.find(
            (op) => op.operationId === args.operationId,
          )!;
          Object.assign(op, { status: args.resume ? "running" : "paused" });
          publish();
          return structuredClone(op);
        }
        throw new Error(`Unexpected command ${command}`);
      },
    };
  });
});

test("prepares locally, confirms one target, and resumes the same task after reload", async ({
  page,
}) => {
  await installWindowLifecycle(page);
  await page.goto("/");
  await page.getByRole("button", { name: "屏幕画面", exact: true }).click();
  await page
    .getByLabel("选择图片或动图")
    .setInputFiles("tests/fixtures/oled.png");
  await expect(
    page.getByRole("heading", { name: "oled.png", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "目标位置", exact: true })
    .selectOption({ label: "多任务，已完成" });
  expect(
    await page.evaluate(() => (window as any).oledTest.requests.length),
  ).toBe(0);
  await auditLayout(page, "oled");
  await page.getByRole("button", { name: "上传到键盘", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("多任务，已完成");
  await auditLayout(page, "confirm-upload");
  await page.getByRole("button", { name: "确认上传", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("正在上传画面");
  await expect(
    page.getByRole("progressbar", { name: "上传进度" }),
  ).toHaveAttribute("value", "40");
  await auditLayout(page, "upload");
  await page
    .getByRole("button", { name: "暂停写入并恢复键盘", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("键盘控制已恢复");
  await page.getByRole("button", { name: "返回编辑", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /任务记录/ })
    .click();
  await expect(
    page.getByRole("button", { name: "继续上传", exact: true }),
  ).toBeEnabled();
  await expect(page.locator('[data-retain-webview="true"]')).toHaveCount(0);
  await page.evaluate(() => (window as any).windowTest.close());
  expect(await page.evaluate(() => (window as any).windowTest.calls)).toEqual([
    "plugin:window|destroy",
  ]);
  await page.reload();
  await page.getByRole("button", { name: /^任务记录/ }).click();
  await page.getByRole("button", { name: "继续上传", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "暂停上传", exact: true }),
  ).toBeEnabled();
  const state = await page.evaluate(() => (window as any).oledTest);
  expect(state.requests).toHaveLength(1);
  expect(state.requests[0].target).toEqual({
    kind: "multiState",
    state: "done",
  });
  expect(state.controls).toEqual([
    { id: state.requests[0].operationId, resume: false },
    { id: state.requests[0].operationId, resume: true },
  ]);
});

test("crops a static image only after confirmation, without writing the device", async ({
  page,
}) => {
  await installWindowLifecycle(page);
  await page.goto("/");
  await page.getByRole("button", { name: "屏幕画面", exact: true }).click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#233c30";
    ctx.fillRect(0, 0, 320, 240);
    ctx.fillStyle = "#c0e7a2";
    ctx.fillRect(90, 40, 140, 160);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const file = {
    name: "portrait.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  };
  await page.getByLabel("选择图片或动图").setInputFiles(file);
  await expect(page.getByRole("dialog")).toContainText("调整屏幕画面");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  expect(await page.evaluate(() => (window as any).preparedImages.length)).toBe(
    0,
  );
  await page.getByLabel("选择图片或动图").setInputFiles(file);
  await page.getByRole("slider", { name: "缩放", exact: true }).fill("2");
  await page.getByRole("slider", { name: "垂直位置", exact: true }).fill("0.8");
  await expect
    .poll(() => page.evaluate(() => (window as any).windowTest.listeners()))
    .toBe(1);
  await page.evaluate(() => (window as any).windowTest.close());
  expect(await page.evaluate(() => (window as any).windowTest.calls)).toEqual([
    "plugin:window|hide",
  ]);
  await expect(
    page.getByRole("slider", { name: "缩放", exact: true }),
  ).toHaveValue("2");
  await expect(
    page.getByRole("slider", { name: "垂直位置", exact: true }),
  ).toHaveValue("0.8");
  await auditLayout(page, "crop");
  await page.getByRole("button", { name: "使用此画面", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "portrait-160x80.png", exact: true }),
  ).toBeVisible();
  const result = await page.evaluate(() => {
    const w = window as any;
    const data = new DataView(Uint8Array.from(w.preparedImages[0]).buffer);
    return {
      width: data.getUint32(16),
      height: data.getUint32(20),
      prepared: w.preparedImages.length,
      writes: w.oledTest.requests.length,
    };
  });
  expect(result).toEqual({ width: 160, height: 80, prepared: 1, writes: 0 });
});

test("canvas mode selects the matching OLED target without submitting on navigation", async ({
  page,
}) => {
  await installWindowLifecycle(page);
  await page.goto("/");
  await page.getByRole("tab", { name: "Codex", exact: true }).click();
  await page.getByRole("button", { name: "LCD 屏幕", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "目标位置", exact: true }),
  ).toHaveValue(JSON.stringify({ kind: "modeDefault", mode: 2 }));
  expect(
    await page.evaluate(() => (window as any).oledTest.requests),
  ).toHaveLength(0);
  await page
    .getByLabel("选择图片或动图")
    .setInputFiles("tests/fixtures/oled.png");
  await page.getByRole("button", { name: "上传到键盘", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("模式 3");
  await page.getByRole("button", { name: "确认上传", exact: true }).click();
  expect(
    await page.evaluate(() => (window as any).oledTest.requests[0].target),
  ).toEqual({ kind: "modeDefault", mode: 2 });
});
