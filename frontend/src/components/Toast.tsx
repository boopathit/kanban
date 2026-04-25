"use client";

import clsx from "clsx";

type ToastProps = {
  message: string;
  onDismiss?: () => void;
  variant?: "error" | "info";
};

export const Toast = ({ message, onDismiss, variant = "error" }: ToastProps) => {
  return (
    <div
      role="status"
      data-testid="board-error-toast"
      className={clsx(
        "fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-2xl border px-4 py-3 shadow-lg backdrop-blur",
        variant === "error"
          ? "border-red-300 bg-red-50/95 text-red-900"
          : "border-[var(--stroke)] bg-white/95 text-[var(--navy-dark)]"
      )}
    >
      <p className="text-sm leading-5">{message}</p>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="ml-1 rounded-full px-2 text-xs font-semibold uppercase tracking-wide opacity-70 transition hover:opacity-100"
        >
          Close
        </button>
      ) : null}
    </div>
  );
};
