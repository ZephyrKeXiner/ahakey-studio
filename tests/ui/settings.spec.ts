import { test, expect, type Page } from "@playwright/test";
async function install(
  page: Page,
  options: {
    partial?: boolean;
    supported?: boolean;
    transaction?: boolean;
    readable?: boolean;
  } = {},
) {
  await page.addInitScript(
    ({
      partial = false,
      supported = true,
      readable = false,
      transaction = false,
    }) => {
      const w = window as any;
      const saved = sessionStorage.getItem("settings-fixture");
      const roles = ["voice", "approve", "reject", "submit"];
      const state = saved
        ? JSON.parse(saved)
        : {
            requests: [],
            operations: [],
            document: {
              deviceId: "x1",
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
                        action: { type: "disabled" },
                      })),
                    })),
                  },
              ...(partial
                ? { readback: { device: { brightnessPercent: 75 }, modes: [] } }
                : {}),
            },
          };
      const view: any = {
        status: "connected",
        generation: 1,
        error: null,
        configurationEpochs: {},
        inspection: {
          instanceId: "a",
          runtimeVersion: "0.1.0",
          protocol: { major: 1, minor: 0 },
          methods: [
            "configuration.get",
            ...(readable ? ["configuration.read"] : []),
            "keymap.apply",
            "operation.get",
            "operation.pause",
            "operation.resume",
            ...(supported ? ["configuration.patch"] : []),
          ],
          snapshot: {
            instanceId: "a",
            sequence: "0",
            devices: [
              {
                deviceId: "x1",
                name: "AhaKey X1",
                connectionState: "ready",
                workMode: 0,
                batteryPercent: 80,
                lever: null,
              },
            ],
            operations: state.operations,
          },
        },
      };
      const listeners = new Map<string, any>();
      function publish() {
        sessionStorage.setItem("settings-fixture", JSON.stringify(state));
        for (const channel of listeners.values())
          channel.onmessage(structuredClone(view));
      }
      let callback = 0;
      w.isTauri = true;
      w.fieldsTest = {
        state,
        retryRead() {
          state.document.read.attempt = 2;
          view.inspection.snapshot.devices[0].connectionState = "disconnected";
          view.configurationEpochs.x1 = String(
            Number(view.configurationEpochs.x1 ?? 0) + 1,
          );
          publish();
        },
        finishRead(failed = false) {
          view.inspection.snapshot.devices[0].connectionState = "ready";
          state.document.read = {
            status: failed ? "failed" : "completed",
            attempt: failed ? 3 : 1,
            maxAttempts: 3,
            errorCode: failed ? "CONFIGURATION_CHANGED" : null,
          };
          if (!failed)
            state.document.readback = {
              device: { brightnessPercent: 62 },
              modes: [],
            };
          view.configurationEpochs.x1 = String(
            Number(view.configurationEpochs.x1 ?? 0) + 1,
          );
          publish();
        },
        complete() {
          const request = state.requests.at(-1);
          const op = state.operations.find(
            (op: any) => op.operationId === request.operationId,
          );
          Object.assign(op, {
            status: "completed",
            progress: 1,
            effect: "complete",
          });
          if (op.configurationProgress)
            Object.assign(op.configurationProgress, {
              fieldsAcknowledged: 1,
              fieldsVerified: 1,
              phase: "complete",
              saveAcknowledged: true,
            });
          state.document.baseToken = "base-b";
          view.configurationEpochs.x1 = "1";
          publish();
        },
        disconnect() {
          view.status = "reconnecting";
          publish();
        },
      };
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
              message: "独立 Runtime",
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
          if (command === "runtime_read_configuration") {
            state.readRequests = (state.readRequests ?? 0) + 1;
            state.document = {
              deviceId: "x1",
              baseToken: "read-base",
              configuration: null,
              read: {
                status: "reading",
                attempt: 1,
                maxAttempts: 3,
                errorCode: null,
              },
            };
            view.configurationEpochs.x1 = String(
              Number(view.configurationEpochs.x1 ?? 0) + 1,
            );
            publish();
            return structuredClone(state.document.read);
          }
          if (command === "runtime_configuration")
            return structuredClone(state.document);
          if (command === "runtime_operation")
            return structuredClone(
              state.operations.find(
                (op: any) => op.operationId === args.operationId,
              ),
            );
          if (command === "runtime_control_operation") {
            (state.controls ??= []).push({
              id: args.operationId,
              resume: args.resume,
            });
            const op = state.operations.find(
              (op: any) => op.operationId === args.operationId,
            );
            op.status = args.resume ? "accepted" : "paused";
            op.errorCode = args.resume ? null : "CONFIGURATION_PAUSED";
            op.configurationProgress.phase = args.resume
              ? "verifying"
              : "paused";
            publish();
            return structuredClone(op);
          }
          if (command === "runtime_patch_configuration") {
            state.requests.push(structuredClone(args.request));
            state.operations.push({
              operationId: args.request.operationId,
              deviceId: "x1",
              status: "running",
              progress: 0.5,
              effect: "unknown",
              errorCode: null,
              ...(transaction
                ? {
                    configurationProgress: {
                      fieldsTotal: 1,
                      fieldsAcknowledged: 0,
                      fieldsVerified: 0,
                      phase: "writing",
                      saveAcknowledged: false,
                    },
                  }
                : {}),
            });
            publish();
            return {
              operationId: args.request.operationId,
              status: "accepted",
            };
          }
          throw new Error(command);
        },
      };
    },
    options,
  );
}
async function editor(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "亮度与描述", exact: true }).click();
}
async function sync(page: Page) {
  await page
    .getByRole("button", { name: "同步设置到编辑区", exact: true })
    .click();
  await page
    .getByRole("button", { name: "保存草稿并同步设置", exact: true })
    .click();
}

test("explicit sync leaves unknown fields unknown and makes previous drafts recoverable", async ({
  page,
}) => {
  await install(page, { partial: true });
  await editor(page);
  await expect(
    page.getByText("已知 1 / 17 项设置", { exact: true }),
  ).toBeVisible();
  const brightness = page.getByRole("spinbutton", {
    name: "全局亮度",
    exact: true,
  });
  const description = page.getByRole("textbox", {
    name: "模式 1 · Voice 键描述",
    exact: true,
  });
  await expect(brightness).toHaveValue("");
  await sync(page);
  await expect(brightness).toHaveValue("75");
  await expect(description).toHaveValue("");
  await description.fill("Draft");
  await sync(page);
  await expect(description).toHaveValue("");
  await page
    .getByRole("button", { name: "恢复上次同步前的设置草稿", exact: true })
    .click();
  await expect(description).toHaveValue("Draft");
  expect(
    await page.evaluate(() => (window as any).fieldsTest.state.requests),
  ).toEqual([]);
});

test("only changed descriptions are sent, newer edits survive completion and reload", async ({
  page,
}) => {
  await install(page, { partial: true });
  await editor(page);
  await sync(page);
  const description = page.getByRole("textbox", {
    name: "模式 1 · Voice 键描述",
    exact: true,
  });
  await description.fill("Plan");
  await page.getByRole("button", { name: "写入设置 · 1", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "部分设备当前值尚未读取",
  );
  await page.getByRole("button", { name: "确认写入设置", exact: true }).click();
  await description.fill("New draft");
  await page.getByRole("button", { name: "键位编辑", exact: true }).click();
  await page
    .getByRole("combobox", { name: "动作类型", exact: true })
    .selectOption("disabled");
  await expect(
    page.getByRole("button", { name: "写入修改 · 1", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await page.getByRole("button", { name: "亮度与描述", exact: true }).click();
  await expect(description).toHaveValue("New draft");
  await page.evaluate(() => (window as any).fieldsTest.complete());
  await expect(
    page.getByRole("button", { name: "写入设置 · 1", exact: true }),
  ).toBeEnabled();
  await expect(description).toHaveValue("New draft");
  const requests = await page.evaluate(
    () => (window as any).fieldsTest.state.requests,
  );
  expect(requests).toHaveLength(1);
  expect(requests[0].brightnessPercent).toBeUndefined();
  expect(requests[0].descriptions).toEqual([
    { mode: 0, index: 0, description: "Plan" },
  ]);
  await page.screenshot({
    path: "test-results/settings-editor.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /任务记录/, exact: false }).click();
  await expect(page.locator(".operation-device")).toContainText(
    "模式 1 · Voice 键描述",
  );
});

test("brightness changes do not resend descriptions and offline drafts stay editable", async ({
  page,
}) => {
  await install(page);
  await editor(page);
  await sync(page);
  const brightness = page.getByRole("spinbutton", {
    name: "全局亮度",
    exact: true,
  });
  await brightness.fill("57");
  await page.getByRole("button", { name: "写入设置 · 1", exact: true }).click();
  await page.getByRole("button", { name: "确认写入设置", exact: true }).click();
  const requests = await page.evaluate(
    () => (window as any).fieldsTest.state.requests,
  );
  expect(requests[0].brightnessPercent).toBe(57);
  expect(requests[0].descriptions).toBeUndefined();
  await page.evaluate(() => (window as any).fieldsTest.disconnect());
  await brightness.fill("42");
  await expect(brightness).toHaveValue("42");
  await expect(
    page.getByRole("button", { name: "写入设置 · 1", exact: true }),
  ).toBeDisabled();
});

test("older Runtime allows drafting but disables unsupported field writes", async ({
  page,
}) => {
  await install(page, { supported: false });
  await editor(page);
  await page
    .getByRole("spinbutton", { name: "全局亮度", exact: true })
    .fill("57");
  await expect(page.getByText(/当前 Runtime 不支持字段级设置/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "写入设置 · 1", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => (window as any).fieldsTest.state.requests),
  ).toEqual([]);
});

test("clearing a known description is an explicit empty field replacement", async ({
  page,
}) => {
  await install(page);
  await editor(page);
  await sync(page);
  const description = page.getByRole("textbox", {
    name: "模式 1 · Voice 键描述",
    exact: true,
  });
  await expect(description).toHaveValue("voice");
  await page
    .getByRole("button", { name: "清空Voice 键描述", exact: true })
    .click();
  await expect(description).toHaveValue("");
  await expect(description).toHaveAttribute("placeholder", "空描述");
  await page.getByRole("button", { name: "写入设置 · 1", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("空描述");
  await page.getByRole("button", { name: "确认写入设置", exact: true }).click();
  const requests = await page.evaluate(
    () => (window as any).fieldsTest.state.requests,
  );
  expect(requests).toHaveLength(1);
  expect(requests[0].descriptions).toEqual([
    { mode: 0, index: 0, description: "" },
  ]);
  expect(requests[0].brightnessPercent).toBeUndefined();
});

test("hardware reading survives UI reload, blocks writes, and requires explicit draft sync", async ({
  page,
}) => {
  await install(page, { readable: true });
  await editor(page);
  await page.getByRole("spinbutton", { name: "亮度" }).fill("49");
  await page
    .getByRole("button", { name: "从设备完整读取", exact: true })
    .click();
  await expect(page.getByText("正在从设备读取 · 第 1 / 3 次")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "写入设置 · 1", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "同步设置到编辑区", exact: true }),
  ).toBeDisabled();
  await page.getByRole("spinbutton", { name: "亮度" }).fill("51");
  await page.reload();
  await page.getByRole("button", { name: "亮度与描述", exact: true }).click();
  await expect(page.getByText("正在从设备读取 · 第 1 / 3 次")).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).fieldsTest.state.readRequests),
  ).toBe(1);
  await page.evaluate(() => (window as any).fieldsTest.retryRead());
  await expect(page.getByText("正在从设备读取 · 第 2 / 3 次")).toBeVisible();
  await page.evaluate(() => (window as any).fieldsTest.finishRead());
  await expect(
    page.getByText("当前值来自设备读回；同步到编辑区仍需确认。"),
  ).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "亮度" })).toHaveValue(
    "51",
  );
  await sync(page);
  await expect(page.getByRole("spinbutton", { name: "亮度" })).toHaveValue(
    "62",
  );
  expect(
    await page.evaluate(() => (window as any).fieldsTest.state.requests),
  ).toEqual([]);
});

test("failed hardware read exposes manual retry and shares its state across configuration pages", async ({
  page,
}) => {
  await install(page, { readable: true });
  await editor(page);
  await page
    .getByRole("button", { name: "从设备完整读取", exact: true })
    .click();
  await page.evaluate(() => (window as any).fieldsTest.finishRead(true));
  await expect(
    page.getByText("设备读取失败（CONFIGURATION_CHANGED），可以手动重试。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "重试设备读取", exact: true }).click();
  expect(
    await page.evaluate(() => (window as any).fieldsTest.state.readRequests),
  ).toBe(2);
  await page.getByRole("button", { name: "键位编辑", exact: true }).click();
  await expect(page.getByText("正在从设备读取 · 第 1 / 3 次")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "同步到编辑区", exact: true }),
  ).toBeDisabled();
});

test("configuration pause and explicit resume retain original task and newer draft after reload", async ({
  page,
}) => {
  await install(page, { transaction: true });
  await editor(page);
  await page
    .getByRole("textbox", { name: "模式 1 · Voice 键描述", exact: true })
    .fill("Frozen");
  await page.getByRole("button", { name: "写入设置 · 1", exact: true }).click();
  await page.getByRole("button", { name: "确认写入设置", exact: true }).click();
  await page.getByRole("button", { name: /^任务记录/ }).click();
  await page.getByRole("button", { name: "暂停配置写入", exact: true }).click();
  await expect(page.getByText("已在完整字段写入后暂停。")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /^任务记录/ }).click();
  await expect(
    page.getByRole("button", { name: "核验并继续配置", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() => (window as any).fieldsTest.state.controls.length),
  ).toBe(1);
  await page.getByRole("button", { name: "亮度与描述", exact: true }).click();
  await page
    .getByRole("textbox", { name: "模式 1 · Voice 键描述", exact: true })
    .fill("Newer draft");
  await page.getByRole("button", { name: /^任务记录/ }).click();
  await page
    .getByRole("button", { name: "核验并继续配置", exact: true })
    .click();
  await expect(
    page.getByText(
      "发现外部修改或无法读取的字段时会停下来；编辑区的新草稿不会加入本次任务。",
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).fieldsTest.state.controls.length),
  ).toBe(1);
  await page.getByRole("button", { name: "核验并继续", exact: true }).click();
  const captured = await page.evaluate(() => (window as any).fieldsTest.state);
  expect(captured.requests).toHaveLength(1);
  expect(captured.controls).toEqual([
    { id: captured.requests[0].operationId, resume: false },
    { id: captured.requests[0].operationId, resume: true },
  ]);
  await page.evaluate(() => (window as any).fieldsTest.complete());
  await expect(
    page.getByText(/已获确认 1 \/ 1 项 · 已读回核验 1 项 · 保存命令已确认/),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/configuration-resume.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "亮度与描述", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "模式 1 · Voice 键描述", exact: true }),
  ).toHaveValue("Newer draft");
  await expect(
    page.getByRole("button", { name: "写入设置 · 1", exact: true }),
  ).toBeEnabled();
});
