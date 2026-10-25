import {
  reconcileSettings,
  markSettings,
  unsettledSettings,
} from "../settings/model";
import { reconcileOled, unsettledOled, markOled } from "../oled/model";
import { useCallback, useEffect, useRef, useState } from "react";
import { describeError, readOperation } from "../../runtime/client";
import type { ClientView, Operation } from "../../runtime/types";
import {
  emptyWorkspace,
  markTask,
  reconcileTask,
  unsettledTask,
  type Workspace,
} from "./model";

const STORAGE_KEY = "ahakey.studio.keymap.v1";
function load(): { workspace: Workspace; error: string | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { workspace: emptyWorkspace(), error: null };
    const value = JSON.parse(raw);
    if (value.version !== 1 || !value.devices || !Array.isArray(value.tasks))
      throw new Error("unsupported workspace");
    return {
      workspace: {
        ...value,
        oledTasks: value.oledTasks ?? [],
        oledDrafts: value.oledDrafts ?? {},
        settingsDrafts: value.settingsDrafts ?? {},
        settingsTasks: value.settingsTasks ?? [],
      } as Workspace,
      error: null,
    };
  } catch {
    return {
      workspace: emptyWorkspace(),
      error: "本地草稿记录无法读取。请保留原记录，修复前不会发起写入。",
    };
  }
}

export function useWorkspace(runtime: ClientView) {
  const [initial] = useState(load);
  const [workspace, setWorkspace] = useState(initial.workspace);
  const [storageError, setStorageError] = useState<string | null>(
    initial.error,
  );
  const latest = useRef(workspace);
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const inFlightRecovery = useRef(new Set<string>());

  const commit = useCallback(
    (update: (current: Workspace) => Workspace) => {
      if (initial.error) throw new Error(initial.error);
      const next = update(latest.current);
      if (next === latest.current) return;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        const message = "本地草稿或任务记录无法保存，请释放存储空间后重试。";
        setStorageError(message);
        throw new Error(message);
      }
      latest.current = next;
      setWorkspace(next);
      setStorageError(null);
    },
    [initial.error],
  );

  const resolve = useCallback(
    (operation: Operation) => {
      commit((current) =>
        reconcileSettings(
          reconcileOled(reconcileTask(current, operation), operation),
          operation,
        ),
      );
    },
    [commit],
  );

  const queryTask = useCallback(
    async (id: string) => {
      const current = runtimeRef.current;
      if (current.status !== "connected") return;
      try {
        const operation = await readOperation(current.generation, id);
        if (runtimeRef.current.generation !== current.generation) return;
        resolve(operation);
      } catch (error) {
        if (runtimeRef.current.generation !== current.generation) return;
        commit((state) =>
          markSettings(
            markOled(
              markTask(state, id, "uncertain", describeError(error)),
              id,
              "uncertain",
              describeError(error),
            ),
            id,
            "uncertain",
            describeError(error),
          ),
        );
      }
    },
    [commit, resolve],
  );

  useEffect(() => {
    if (runtime.status !== "connected") return;
    try {
      commit((current) =>
        (runtime.inspection?.snapshot.operations ?? []).reduce(
          (state, operation) =>
            reconcileSettings(
              reconcileOled(reconcileTask(state, operation), operation),
              operation,
            ),
          current,
        ),
      );
    } catch {
      /* The storage error is visible and prevents further writes. */
    }
    const operations = runtime.inspection?.snapshot.operations ?? [];
    for (const task of [
      ...latest.current.tasks.filter(unsettledTask),
      ...latest.current.oledTasks.filter(unsettledOled),
      ...latest.current.settingsTasks.filter(unsettledSettings),
    ]) {
      const id = task.request.operationId;
      const lookup = `${runtime.generation}:${id}`;
      if (
        operations.some((operation) => operation.operationId === id) ||
        inFlightRecovery.current.has(lookup)
      )
        continue;
      inFlightRecovery.current.add(lookup);
      void queryTask(id).catch(() => {});
    }
  }, [
    runtime.status,
    runtime.generation,
    runtime.inspection?.snapshot.operations,
    commit,
    queryTask,
  ]);

  return { workspace, storageError, commit, queryTask, current: latest };
}
export type WorkspaceController = ReturnType<typeof useWorkspace>;
