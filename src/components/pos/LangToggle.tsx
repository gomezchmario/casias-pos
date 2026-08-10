"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { LANG_LABEL, LANG_STORAGE_KEY, translate, type Lang } from "@/lib/i18n";

/**
 * The language switch, and what reads it.
 *
 * An accessibility control and nothing more — see `src/lib/i18n.ts`. Nothing
 * about the shop's records, receipts or reports changes with it; this is the
 * words on the glass for whoever is standing at the counter.
 */

type LangCtx = { lang: Lang; setLang: (l: Lang) => void; t: (s: string) => string };

const LanguageContext = createContext<LangCtx>({
  lang: "en",
  setLang: () => {},
  t: (s) => s,
});

/** `const { t } = useLang()` in any component under the register's shell. */
export function useLang(): LangCtx {
  return useContext(LanguageContext);
}

export function LangProvider({ children }: { children: React.ReactNode }) {
  /**
   * Starts English on every render, including the server's.
   *
   * Reading `localStorage` during the first render would mean the server draws
   * English and the browser draws Spanish, which React reports as a hydration
   * mismatch and repairs by throwing the markup away. So the stored choice is
   * applied in an effect: on a Spanish machine the header is English for one
   * frame. That is the correct trade — a flicker costs nothing, and a hydration
   * error on the register costs a re-render of the whole screen mid-ticket.
   */
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const saved = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (saved === "es" || saved === "en") setLangState(saved);
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, l);
    } catch {
      // Private browsing, a full disk, a locked-down profile. The switch still
      // works for this session; it simply will not be remembered, which is a
      // great deal better than the register refusing to change language.
    }
  }, []);

  const t = useCallback((s: string) => translate(lang, s), [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>{children}</LanguageContext.Provider>
  );
}

/**
 * The switch itself: EN over ES, one lit.
 *
 * Vertical because of where it sits — between the user's name and the Time
 * Clock button, in a header that is already a horizontal row of things. Stacked,
 * it takes the width of two letters instead of six and matches the height of the
 * button beside it, so it reads as part of the furniture rather than as a fourth
 * thing competing for the corner.
 *
 * Both languages are always visible and one is lit, rather than a single button
 * showing the language you would switch TO. That kind of switch is ambiguous in
 * exactly the situation it matters — somebody who cannot read the current screen
 * cannot tell whether the button names where they are or where they would go.
 * Two labels with one highlighted has only one reading.
 */
export function LangToggle() {
  const { lang, setLang } = useLang();

  return (
    <div
      className="lang-toggle"
      role="group"
      aria-label="Language / Idioma"
      title="Language · Idioma"
    >
      {(["en", "es"] as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          className={l === lang ? "lang-opt lang-opt-on" : "lang-opt"}
          aria-pressed={l === lang}
          onClick={() => setLang(l)}
        >
          {LANG_LABEL[l]}
        </button>
      ))}
    </div>
  );
}
