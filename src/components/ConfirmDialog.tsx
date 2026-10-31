import type { ReactNode } from "react";
import { Dialog } from "./Dialog";
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      initialFocus="action"
      title={title}
      onClose={onClose}
      actions={
        <>
          <button className="secondary-button" onClick={onClose} autoFocus>
            取消
          </button>
          <button className="primary-button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
