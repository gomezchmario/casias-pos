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

  /**
   * Freeze the page underneath while this is up.
   *
   * Without it a wheel over the dimmed backdrop -- or past the bottom of the
   * dialog's own scroll -- moves the screen behind instead, so somebody trying
   * to reach the Pay button on a long ticket watches the day's takings slide
   * around under it and the dialog stay put.
   *
   * The previous value is put back rather than blanked, which is what makes a
   * confirm box opened FROM a ticket behave: the inner one restores the outer
   * one's lock on close, instead of handing the page back while a dialog is
   * still on screen.
   */
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style={{ background: "rgba(10,37,64,0.55)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      {/* Capped to the window with the MIDDLE doing the scrolling, so the
          heading and whatever sits in the footer stay put. A ticket with a
          dozen lines, a payment panel and a status panel on it is taller than
          a laptop screen, and letting the whole card grow past the viewport
          pushed both the ticket number and the × off the top -- leaving no
          visible way to shut it and nothing on the card that would scroll. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl animate-pop-in flex flex-col"
        style={{
          width: "100%",
          maxWidth: width,
          maxHeight: "calc(100dvh - 2rem)",
          boxShadow: "0 24px 64px rgba(10,37,64,0.30)",
        }}
      >
        <div className="shrink-0 px-6 py-4 border-b border-black/5 flex items-center justify-between">
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
        {/* `min-h-0` is doing real work: a flex child defaults to a minimum
            size of its own content, which would let this box grow to whatever
            is inside it and quietly defeat the cap above. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="shrink-0 px-6 py-4 border-t border-black/5 flex justify-end gap-2 bg-black/[0.015] rounded-b-2xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
