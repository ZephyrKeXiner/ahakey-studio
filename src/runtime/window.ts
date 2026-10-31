import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Persisted drafts and Runtime tasks survive destruction; transient editors opt out. */
export function watchWindowClose(): () => void {
  if (!isTauri()) return () => {};
  const window = getCurrentWindow();
  let stopped = false;
  const attached = window.onCloseRequested(async (event) => {
    if (stopped) return;
    if (document.querySelector('[data-retain-webview="true"]')) {
      event.preventDefault();
      await window.hide();
    }
    // onCloseRequested destroys the window when default is not prevented.
  });
  return () => {
    stopped = true;
    void attached.then((unlisten) => unlisten());
  };
}
