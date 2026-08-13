import Image from "next/image";

/**
 * The shop's actual badge, wherever the drawn tire used to be.
 *
 * `TireMark` still draws a generic tire in SVG and is still the right thing for
 * a spinner, where a company badge going round would read as a page that had
 * failed to load rather than one that was working. It has no callers left now
 * that the lock screen wears this badge instead — that one names the business,
 * and TireMark decorates a wait.
 *
 * Served from `public/logo.png` rather than imported, so replacing the badge is
 * dropping a file in a folder rather than a code change. The file there is the
 * one the owner supplied, cut out of the flattened export it arrived in: the
 * transparency had been baked into a grey checkerboard, which would have
 * printed as a chequered square around the badge on every receipt.
 *
 * `unoptimized` because Next's image pipeline is a needless moving part for one
 * small static asset on a single-PC shop server, and because the optimiser
 * writes into a cache directory that a `.next` wipe clears — which would leave
 * the register briefly logo-less after every deploy.
 */
export function ShopLogo({
  size = 40,
  className,
  priority,
}: {
  size?: number;
  className?: string;
  /** For the one above the fold on the kiosk, which is the first thing drawn. */
  priority?: boolean;
}) {
  return (
    <Image
      src="/logo.png"
      alt="Casias Tire Shop"
      width={size}
      height={size}
      className={className}
      priority={priority}
      unoptimized
      style={{ width: size, height: "auto", objectFit: "contain" }}
    />
  );
}
