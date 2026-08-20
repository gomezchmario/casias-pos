"use client";

import { useEffect, useState } from "react";

/**
 * Back to the top of a long page.
 *
 * The inventory sheet is five hundred tires deep, and the things worth pressing
 * — the search box, Receive stock, Price a tire — all live in the header. Get to
 * the bottom of the racks and every one of them is a long scroll away, which is
 * why this exists.
 *
 * Hidden until it is needed. A control pinned over the page while the page is
 * already at the top is covering content to offer something nobody wants; it
 * appears once there is genuinely a distance to come back from.
 */
export function BackToTop({
  /** How far down before it shows. Roughly one screen. */
  showAfter = 600,
}: {
  showAfter?: number;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > showAfter);
    onScroll();
    // Passive: this only reads scrollY and never calls preventDefault, and
    // saying so keeps the listener off the critical path of the scroll itself.
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [showAfter]);

  return (
    <button
      type="button"
      aria-label="Back to top"
      title="Back to top"
      // Kept mounted and faded, rather than added and removed. A button that
      // pops into existence under a finger already on its way down is a
      // mis-tap; fading it in gives the eye the moment it needs to notice.
      // `pointer-events` is what stops the invisible one from being pressable.
      className={`pos-backtotop no-print fixed bottom-6 right-6 z-40 grid h-11 w-11 place-items-center rounded-full transition-all duration-200 ${
        show ? "opacity-90 hover:opacity-100" : "pointer-events-none opacity-0"
      }`}
      style={{
        // Translucent, because this thing is parked on top of the stock sheet
        // and the rows it covers are rows somebody is trying to read. Being able
        // to see what is underneath it is the difference between a control and
        // an obstruction. Blurred as well as tinted so the text showing through
        // is legible as a hint rather than legible as text, which would make the
        // button itself hard to read.
        background: "rgba(10, 37, 64, 0.75)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        // White, not the brand gold. Gold on solid navy was fine; gold seen
        // through a translucent panel over a white page is not, and this is a
        // 44-pixel utility button whose entire job is being unmistakable.
        color: "#fff",
        boxShadow: "0 4px 14px rgba(10, 37, 64, 0.35)",
        transform: show ? "none" : "translateY(8px)",
      }}
      onClick={() =>
        window.scrollTo({
          top: 0,
          // Somebody who has told Windows to stop animating things has said so
          // for a reason, and a page flying past under them is exactly the kind
          // of motion they turned off.
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
        })
      }
    >
      {/* Drawn rather than typed. "↑" is a text character, so how heavy it comes
          out is whatever the installed font decides — and in this stack it comes
          out hairline, which at this size is a smudge. A stroked path is the same
          weight on every machine in the shop. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 19V6" />
        <path d="M5.5 12.5 12 6l6.5 6.5" />
      </svg>
    </button>
  );
}
