import type { PreparedResource, OledDocument, OledRequest } from "./types";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import type {
  ClientView,
  ConfigurationDocument,
  ConfigurationPatch,
  Inspection,
  KeymapRequest,
  Operation,
  RuntimeError,
} from "./types";
export type { Device, Inspection, Operation } from "./types";

export const initialView: ClientView = {
  status: "connecting",
  generation: 0,
  inspection: null,
  error: null,
  configurationEpochs: {},
};

function requireDesktop() {
  if (!isTauri())
    throw {
      code: "DESKTOP_REQUIRED",
      message: "请在 AhaKey Studio 桌面应用中连接 Runtime。",
      outcomeUnknown: false,
    } satisfies RuntimeError;
}
export function watchRuntime(onUpdate: (view: ClientView) => void): () => void {
  try {
    requireDesktop();
  } catch (error) {
    onUpdate({
      ...initialView,
      status: "unavailable",
      error: error as RuntimeError,
    });
    return () => {};
  }
  const listenerId = crypto.randomUUID();
  const channel = new Channel<ClientView>();
  let stopped = false;
  channel.onmessage = (view) => {
    if (!stopped) onUpdate(view);
  };
  const attached = invoke("runtime_watch", { listenerId, channel }).catch(
    (error) => {
      if (!stopped)
        onUpdate({
          ...initialView,
          status: "unavailable",
          error: normalizeError(error),
        });
    },
  );
  return () => {
    stopped = true;
    // Cleanup waits for registration, so React StrictMode cannot leave an orphan observer.
    void attached
      .then(() => invoke("runtime_unwatch", { listenerId }))
      .catch(() => {});
  };
}
export function reconnectRuntime(): Promise<void> {
  requireDesktop();
  return invoke("runtime_reconnect");
}
export function readRuntimeSnapshot(): Promise<Inspection> {
  requireDesktop();
  return invoke("runtime_snapshot");
}
export function readConfiguration(
  generation: number,
  deviceId: string,
): Promise<ConfigurationDocument> {
  requireDesktop();
  return invoke("runtime_configuration", { generation, deviceId });
}
export function applyKeymap(
  generation: number,
  request: KeymapRequest,
): Promise<{ operationId: string; status: string }> {
  requireDesktop();
  return invoke("runtime_keymap", { generation, request });
}
export function readOperation(
  generation: number,
  operationId: string,
): Promise<Operation> {
  requireDesktop();
  return invoke("runtime_operation", { generation, operationId });
}
export function setDeviceConnection(
  generation: number,
  deviceId: string,
  connected: boolean,
): Promise<void> {
  requireDesktop();
  return invoke("runtime_device_connection", {
    generation,
    deviceId,
    connected,
  });
}
export function normalizeError(error: unknown): RuntimeError {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return {
      code:
        "code" in error && typeof error.code === "string"
          ? error.code
          : "CLIENT_ERROR",
      message: error.message,
      outcomeUnknown:
        "outcomeUnknown" in error ? error.outcomeUnknown !== false : true,
    };
  }
  return {
    code: "CLIENT_ERROR",
    message: "操作未获得确认，请查询原任务结果。",
    outcomeUnknown: true,
  };
}
export function describeError(error: unknown): string {
  return normalizeError(error).message;
}

export function prepareResource(bytes: Uint8Array): Promise<PreparedResource> {
  requireDesktop();
  return invoke("runtime_prepare_resource", { bytes: Array.from(bytes) });
}
export function readOled(
  generation: number,
  deviceId: string,
): Promise<OledDocument> {
  requireDesktop();
  return invoke("runtime_oled", { generation, deviceId });
}
export function uploadOled(
  generation: number,
  request: OledRequest,
): Promise<{ operationId: string; status: string }> {
  requireDesktop();
  return invoke("runtime_upload_oled", { generation, request });
}
export function controlOperation(
  generation: number,
  operationId: string,
  resume: boolean,
): Promise<Operation> {
  requireDesktop();
  return invoke("runtime_control_operation", {
    generation,
    operationId,
    resume,
  });
}

export type SettingsPane = "bluetooth" | "inputMonitoring";
export function openSystemSettings(pane: SettingsPane): Promise<void> {
  requireDesktop();
  return invoke("system_open_settings", { pane });
}

export interface InputSettingsState {
  enabled: boolean;
  active: boolean | null;
  available: boolean;
  editable: boolean;
  mock: boolean;
}
export function readInputSettings(): Promise<InputSettingsState> {
  requireDesktop();
  return invoke("runtime_input_settings");
}
export function saveInputSettings(
  enabled: boolean,
): Promise<InputSettingsState> {
  requireDesktop();
  return invoke("runtime_set_input_monitor", { enabled });
}

export function patchConfiguration(
  generation: number,
  request: ConfigurationPatch,
): Promise<{ operationId: string; status: string }> {
  requireDesktop();
  return invoke("runtime_patch_configuration", { generation, request });
}

export function startConfigurationRead(
  generation: number,
  deviceId: string,
): Promise<import("./types").ConfigurationRead> {
  requireDesktop();
  return invoke("runtime_read_configuration", { generation, deviceId });
}
