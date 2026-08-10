import { LangProvider } from "@/components/pos/LangToggle";
import { PosShell } from "@/components/pos/PosShell";

// `default` names /pos itself and stands in for any POS screen added later that
// forgets its own layout.tsx.
//
// The `template` has to be repeated here even though the root layout already
// declares an identical one. A segment that sets `title` at all replaces the
// whole field, template included, so writing `title: "Register"` would leave
// every POS page below this one with a bare "Inventory" in the tab and no shop
// name at all. Found the hard way.
export const metadata = {
  title: { default: "Register", template: "%s · Casias Tire Shop" },
};

/**
 * The language provider sits ABOVE the shell, not inside it, so the shell's own
 * header can call `useLang()`. It holds a preference and nothing else — see
 * `src/lib/i18n.ts` — and every screen below it gets `t()` for free.
 */
export default function PosLayout({ children }: { children: React.ReactNode }) {
  return (
    <LangProvider>
      <PosShell>{children}</PosShell>
    </LangProvider>
  );
}
