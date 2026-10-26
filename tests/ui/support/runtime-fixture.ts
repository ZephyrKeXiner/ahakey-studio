import { type Page } from "@playwright/test";
import type {
  ClientView,
  ConfigurationDocument,
  KeymapRequest,
  Operation,
} from "../../../src/runtime/types";

export type Harness = {
  requests: KeymapRequest[];
  complete(): void;
  disconnect(): void;
};
export async function installRuntime(page: Page, partial = false) {
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
