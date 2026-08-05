"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";

type Props = {
  open: boolean;
  /** Backdrop click, Escape and the Cancel button all land here. */
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  /** The question and its consequences. Prose, not a field list. */
  children: React.ReactNode;
  /** Name the action — "Yes, I counted them" beats "OK" every time. */
  confirmLabel: string;
  cancelLabel?: string;
  /** Red instead of navy, for the ones that destroy something. */
  danger?: boolean;
  /** Keeps the button from being pressed twice while the request is in flight. */
  busy?: boolean;
  /**
   * When set, a checkbox with this label sits above the buttons and the confirm
   * button stays disabled until it is ticked.
   *
   * For the actions where the danger is not that the click is destructive but
   * that it is FALSE — the ones that assert something about the world outside
   * the screen, which the software has no way to check. A dialog alone does not
   * stop those, because a dialog is dismissed by the same reflex that opened it:
   * click, click, done, without a word being read. Two deliberate clicks in
   * different places, one of which is a sentence in the first person, is enough
   * friction to interrupt the reflex.
   *
   * Word it as the claim being made, not as an instruction — "somebody walked
   * the racks", not "confirm you counted". The person ticking it should have to
   * notice they are the one saying it.
   */
  acknowledge?: string;
};

/**
 * A confirmation that belongs to the page instead of to the browser.
 *
 * `window.confirm` was doing this job and it has a real defect on the shop's
 * setup: the dialog is drawn by the browser chrome, at the top of the WINDOW,
 * with no relationship to where the click happened. On a scrolled page it can
 * land off-screen, and on the second monitor the register runs alongside it can
 * open on the display nobody is looking at. Staff reported it as the screen
 * freezing — which, from where they sit, is exactly what it looks like: the page
 * stops responding and there is no visible reason why.
 *
 * It is also modal to the whole tab, so the app cannot show progress, cannot
 * name the person the action is about to be attributed to, and cannot style the
 * dangerous ones differently from the routine ones.
 *
 * This renders inside the page, next to the button that opened it, and matches
 * every other dialog in the app — so the answer to "is this thing asking me
 * something" is always the same shape.
 */
export function ConfirmModal({
  open,
  onCancel,
  onConfirm,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  danger,
  busy,
  acknowledge,
}: Props) {
  const [acked, setAcked] = useState(false);

  // Untick on every open. The tick is a statement about right now, so carrying
  // it over from the last time the dialog was opened would hand the second
  // click away for free — which is the one thing this is here to prevent.
  useEffect(() => {
    if (open) setAcked(false);
  }, [open]);

  const blocked = busy || (!!acknowledge && !acked);

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      width={420}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={blocked}
            style={{
              ...(danger
                ? { background: "linear-gradient(180deg, #dc2626 0%, #b91c1c 100%)" }
                : null),
              // Visibly dead until the box is ticked, rather than merely inert.
              // A button that looks pressable and does nothing reads as the app
              // being broken; a greyed one sends you looking for what is missing,
              // which is sitting directly above it.
              ...(blocked ? { opacity: 0.45, cursor: "not-allowed" } : null),
            }}
          >
            {busy ? "Saving…" : confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm text-brand-400 leading-relaxed">{children}</div>
      {acknowledge && (
        <label className="mt-4 flex items-start gap-2.5 text-sm text-brand-500 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={acked}
            onChange={(e) => setAcked(e.target.checked)}
          />
          <span>{acknowledge}</span>
        </label>
      )}
    </Modal>
  );
}
