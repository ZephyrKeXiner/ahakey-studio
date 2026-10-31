import { useEffect, useId, useRef, type ReactNode } from "react";
export function Dialog({
  title,
  children,
  actions,
  onClose,
  className = "",
  initialFocus = "title",
}: {
  title: string;
  className?: string;
  initialFocus?: "title" | "action";
  children: ReactNode;
  actions: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const opener =
      document.activeElement instanceof HTMLElement &&
      !dialog.contains(document.activeElement)
        ? document.activeElement
        : null;
    if (!dialog.open) dialog.showModal();
    if (initialFocus === "title")
      heading.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [initialFocus]);
  return (
    <dialog
      ref={ref}
      className={`confirm-dialog ${className}`}
      aria-labelledby={titleId}
      onCancel={onClose}
    >
      <h2
        ref={heading}
        id={titleId}
        tabIndex={initialFocus === "title" ? -1 : undefined}
      >
        {title}
      </h2>
      <div className="dialog-body">{children}</div>
      <div className="dialog-actions">{actions}</div>
    </dialog>
  );
}
