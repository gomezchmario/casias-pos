/**
 * A layout that adds nothing but a name.
 *
 * Nearly every screen in this app is a client component, and a `"use client"`
 * module cannot export `metadata` — Next silently ignores it. The first attempt
 * at per-page titles set `document.title` from an effect instead, which appeared
 * to work and then lost a race: on a cold load Next streams its own `<title>`
 * in after hydration, so the tab settled back to the root default a few hundred
 * milliseconds later.
 *
 * A metadata export has to sit in a SERVER file, and the only server file that
 * can wrap a client page without rewriting it is a layout. So each section gets
 * a two-line `layout.tsx` that re-exports this and names itself. The title is
 * then in the streamed HTML, correct before a single line of JavaScript runs,
 * and correct in a bookmark and a browser-history entry too.
 *
 * The suffix comes from the `title.template` in `src/app/layout.tsx`; these only
 * ever supply the leading part.
 */
export default function TitleLayout({ children }: { children: React.ReactNode }) {
  return children;
}
