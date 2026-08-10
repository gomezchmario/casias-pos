"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Print, and get out of here.
 *
 * The second button used to be `window.close()` alone, which a browser refuses
 * to honour on a tab it did not open by script — so a receipt reached by an
 * ordinary link had a button that did nothing at all, silently, which is worse
 * than not having one. It worked only from the register, which opens the
 * receipt in a popup, and that is where it was tested.
 *
 * Three ways out, in the order they are correct:
 *
 *   opened by the register  -> close the popup, which is what was asked for
 *   walked here from a link -> go back to whatever was being read
 *   opened cold             -> nothing to go back to, so go to the day screen
 *
 * The label follows the same decision, and is settled after mount rather than
 * during render: `window` does not exist on the server, and a button that says
 * "Close" on the first paint and "Back" on the second is a button somebody
 * clicks by accident.
 */
export function PrintButton() {
  const router = useRouter();
  const [canClose, setCanClose] = useState(false);

  useEffect(() => {
    setCanClose(Boolean(window.opener) && !window.opener.closed);
  }, []);

  function leave() {
    if (canClose) {
      window.close();
      return;
    }
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/pos");
  }

  return (
    <div className="no-print flex gap-2">
      <button type="button" className="btn btn-primary" onClick={() => window.print()}>
        Print
      </button>
      <button type="button" className="btn btn-ghost" onClick={leave}>
        {canClose ? "Close" : "Back"}
      </button>
    </div>
  );
}
