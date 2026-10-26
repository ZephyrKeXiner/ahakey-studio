export interface Device {
  deviceId: string;
  name: string;
  connectionState: string;
  batteryPercent: number | null;
  workMode: number | null;
  lever: string | null;
}
export interface Operation {
  operationId: string;
  deviceId: string;
  status: string;
  progress: number;
  effect: string;
  errorCode: string | null;
  configurationProgress?: {
    fieldsTotal: number;
    fieldsAcknowledged: number;
    fieldsVerified: number;
    phase: string;
    saveAcknowledged: boolean;
  };
}
export interface InputState {
  status: string;
  permission: string;
  devices: { inputDeviceId: string; name: string }[];
}
export interface Inspection {
  protocol: { major: number; minor: number };
  instanceId: string;
  runtimeVersion: string;
  methods: string[];
  snapshot: {
    instanceId: string;
    sequence: string;
    devices: Device[];
    operations: Operation[];
    input?: InputState | null;
    voice?: VoiceView | null;
    hooks?: HooksView | null;
  };
}
export interface RuntimeError {
  code: string;
  message: string;
  outcomeUnknown?: boolean;
}
export interface ClientView {
  status: "connecting" | "connected" | "reconnecting" | "unavailable";
  generation: number;
  inspection: Inspection | null;
  error: RuntimeError | null;
  configurationEpochs: Record<string, string>;
}
export type Modifier = "control" | "shift" | "alt" | "gui";
export type MacroStep =
  | { type: "keyDown" | "keyUp"; keyCode: number }
  | { type: "delay"; delayMs: number }
  | { type: "releaseAll" | "noOp" };
export type Action =
  | { type: "disabled" }
  | { type: "shortcut"; modifiers: Modifier[]; keyCode: number }
  | { type: "macro"; steps: MacroStep[] };
export interface ConfigurationRead {
  status: "reading" | "completed" | "failed";
  attempt: number;
  maxAttempts: number;
  errorCode: string | null;
}
export interface ConfigurationDocument {
  read?: ConfigurationRead;
  deviceId: string;
  baseToken: string;
  configuration: {
    device: { brightnessPercent: number };
    modes: {
      mode: number;
      keys: { role: string; action: Action; description: string }[];
      lights: { state: string; effect: string }[];
    }[];
  } | null;
  readback?: {
    device?: {
      brightnessPercent: number | null;
      taskLightMode?: number | null;
    };
    modes: {
      mode: number;
      keys: {
        role: string;
        action: Action | null;
        description: string | null;
      }[];
    }[];
  };
}
export interface KeymapRequest {
  operationId: string;
  deviceId: string;
  baseToken: string;
  mode: number;
  keys: { index: number; action: Action }[];
}
export type OledState = "working" | "waiting" | "done";
export type OledTarget =
  | { kind: "modeDefault"; mode: number }
  | { kind: "modeState"; mode: number; state: OledState }
  | { kind: "multiState"; state: OledState };
export interface PreparedResource {
  resourceId: string;
  width: number;
  height: number;
  frameCount: number;
  intervalMs: number;
  byteLength: number;
  crc32: number;
}
export interface OledDocument {
  profile: string;
  width: number;
  height: number;
  intervalMs: number;
  entries: {
    target: OledTarget;
    valid: boolean;
    writeState: string;
    frameCount: number;
    byteLength: number;
    crc32: number;
    maxFrames: number;
  }[];
}
export interface OledRequest {
  operationId: string;
  deviceId: string;
  baseToken: string;
  resourceId: string;
  target: OledTarget;
}
export interface OledDraft {
  filename: string;
  resource: PreparedResource;
}
export interface OledTask {
  request: OledRequest;
  resource: PreparedResource;
  filename: string;
  createdAt: string;
  status: string;
  message: string | null;
}

export interface DescriptionPatch {
  mode: number;
  index: number;
  description: string;
}
export interface ConfigurationPatch {
  operationId: string;
  deviceId: string;
  baseToken: string;
  brightnessPercent?: number;
  descriptions?: DescriptionPatch[];
}

export interface VoicePreferences {
  enabled: boolean;
  inputDeviceId: string | null;
  trigger: "hold" | "toggle";
  locale: string;
  autoInsert: boolean;
  onDeviceOnly: boolean;
}
export interface VoiceView {
  available: boolean;
  status: string;
  preferences: VoicePreferences;
  sessionId: string | null;
  text: string;
  error: string | null;
  microphone: string;
  speech: string;
  accessibility: boolean;
  output: string | null;
}

export interface HookPreferences {
  enabled:boolean; deviceId:string|null; allowAutomatic:boolean; inputDeviceId:string|null; approveUsage:number|null; rejectUsage:number|null;
}
export interface HookApproval {
  requestId:string; decision:string; expiresAtMs:number;
  context:{ tool:string; sessionId:string; event:string; cwd:string; toolName:string; summary:string; };
}
export interface HooksView {
  revision:number; preferences:HookPreferences; approvals:HookApproval[];
  sessions:{tool:string; sessionId:string; cwd:string; event:string; status:string; updatedAtMs:number}[];
  selectedRequestId:string|null; learning:string|null;
}
