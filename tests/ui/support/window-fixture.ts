import type { Page } from "@playwright/test";

/** Exercise Tauri's real onCloseRequested wrapper with an in-memory native transport. */
export async function installWindowLifecycle(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    const native = w.__TAURI_INTERNALS__;
    const invoke = native.invoke;
    const callbacks = new Map<number, (event: unknown) => Promise<void>>();
    const subscriptions = new Map<number, { event: string; handler: number }>();
    const calls: string[] = [];
    let id = 100;
    native.transformCallback = (
      callback: (event: unknown) => Promise<void>,
    ) => {
      callbacks.set(++id, callback);
      return id;
    };
    w.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener = (
      _event: string,
      key: number,
    ) => subscriptions.delete(key);
    native.invoke = async (command: string, args: any) => {
      if (command === "plugin:event|listen") {
        subscriptions.set(++id, args);
        return id;
      }
      if (command === "plugin:event|unlisten") return;
      if (
        command === "plugin:window|destroy" ||
        command === "plugin:window|hide"
      ) {
        calls.push(command);
        return;
      }
      return invoke(command, args);
    };
    w.windowTest = {
      calls,
      listeners: () =>
        Array.from(subscriptions.values()).filter(
          (s) => s.event === "tauri://close-requested",
        ).length,
      async close() {
        for (const [key, s] of subscriptions) {
          if (s.event === "tauri://close-requested")
            await callbacks.get(s.handler)?.({
              event: s.event,
              id: key,
              payload: null,
            });
        }
      },
    };
  });
}
