import { markTask, reconcileTask } from "../keymap/model";
import { markSettings, reconcileSettings } from "../settings/model";
import { useRef, useState } from "react";
import {
  controlOperation,
  describeError,
  normalizeError,
} from "../../runtime/client";
import type { ClientView } from "../../runtime/types";
import type { WorkspaceController } from "../keymap/useWorkspace";
import { markOled, reconcileOled } from "../oled/model";
export function useOperationControl(
  id: string,
  runtime: ClientView,
  controller: WorkspaceController,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(runtime);
  live.current = runtime;
  async function query() {
    setError(null);
    try {
      await controller.queryTask(id);
    } catch (cause) {
      setError(describeError(cause));
    }
  }
  async function control(resume: boolean) {
    setBusy(true);
    setError(null);
    const generation = runtime.generation;
    try {
      const result = await controlOperation(generation, id, resume);
      if (live.current.generation === generation)
        controller.commit((current) =>
          reconcileSettings(
            reconcileTask(reconcileOled(current, result), result),
            result,
          ),
        );
      await controller.queryTask(id);
    } catch (cause) {
      const problem = normalizeError(cause);
      setError(problem.message);
      if (problem.outcomeUnknown) {
        try {
          controller.commit((current) =>
            markSettings(
              markTask(
                markOled(current, id, "uncertain", problem.message),
                id,
                "uncertain",
                problem.message,
              ),
              id,
              "uncertain",
              problem.message,
            ),
          );
        } catch {}
      }
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, query, control };
}
