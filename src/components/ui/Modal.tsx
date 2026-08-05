"use client";

import { useEffect } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  /** A node, not just a string, so a dialog can style its own heading — the
   *  ticket drawer labels and sizes its number differently from a plain
   *  confirm box, and the alternative was every caller styling it from the
   *  outside through a second prop. */
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
};

export function Modal({ open, onClose, title, children, footer, width = 480 }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style={{ background: "rgba(10,37,64,0.55)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl animate-pop-in"
        style={{ width: "100%", maxWidth: width, boxShadow: "0 24px 64px rgba(10,37,64,0.30)" }}
      >
        <div className="px-6 py-4 border-b border-black/5 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-brand-500">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-brand-300 hover:text-brand-500 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && (
          <div className="px-6 py-4 border-t border-black/5 flex justify-end gap-2 bg-black/[0.015] rounded-b-2xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
