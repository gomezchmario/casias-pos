/**
 * The staff manual, in both languages the shop reads.
 *
 * Content rather than markup, and in one file rather than two, because the
 * alternative is what it replaced: a Spanish PDF, an English PDF and a page in
 * the app, all saying the same thing until the day somebody corrects one of
 * them. A manual that disagrees with itself is worse than no manual, because
 * the person holding the wrong copy has no way to know.
 *
 * The screens themselves are in English and the floor reads Spanish, so every
 * on-screen control is written as a chip — `[[New sale]]` — and rendered as the
 * exact words on the button in BOTH languages. Translating a button name would
 * send somebody hunting for a word that is not on the screen.
 *
 * Inline markup is deliberately tiny: `**bold**` and `[[Chip]]`, nothing else.
 * Anything richer would need an editor, and this file is meant to be corrected
 * by whoever notices the mistake.
 */

import { POS_SECTIONS } from "./manual-pos";
import { TIMECLOCK_SECTIONS } from "./manual-timeclock";

export type Lang = "es" | "en";

/** One string in both languages. */
export type T = { es: string; en: string };

export type Block =
  | { kind: "p"; text: T }
  | { kind: "h3"; text: T }
  | { kind: "steps"; items: T[] }
  | { kind: "list"; items: T[] }
  | { kind: "note"; title: T; body: T[] }
  | { kind: "warn"; title: T; body: T[] }
  | { kind: "table"; head: T[]; rows: T[][] }
  /**
   * A picture of the actual screen, with numbered markers on it.
   *
   * The single most useful thing a manual for this audience can contain, and
   * the hardest to keep honest: a drawing of a screen is out of date the day
   * somebody moves a button, and nobody notices because a drawing never stops
   * looking right. So these are photographs of the running system, taken by
   * `scripts/shoot-manual.mts`, and retaken whenever the screen changes.
   *
   * `src` is a bare filename under `public/manual/`. `x` and `y` are percentages
   * of the image, so a marker stays on the thing it points at whatever size the
   * picture is shown at.
   */
  | {
      kind: "figure";
      src: string;
      alt: T;
      callouts: { x: number; y: number; text: T }[];
    }
  /**
   * A live piece of the interface, rebuilt inline from the app's own styles.
   *
   * Better than a photograph for the thing a photograph is worst at: showing
   * ONE control. A screenshot of the register to explain a single button is a
   * picture of forty other buttons with an arrow on it, and the reader has to
   * find the arrow before the sentence means anything. A specimen puts the
   * button in the paragraph, at the size and colour it really is, with nothing
   * else in the frame.
   *
   * They are reproductions, not screenshots, and that is the trade: they cannot
   * go out of alignment with a data change, and they CAN go out of date if
   * somebody restyles a control. `specimens.tsx` says which real component each
   * one mirrors so the two can be checked against each other.
   *
   * `caption` is the label under it — usually what the reader should notice.
   */
  | { kind: "ui"; specimen: string; caption?: T };

export type Section = { title: T; blocks: Block[] };

/**
 * The two systems on this machine, and why they are two manuals.
 *
 * The register and the time clock share a database, a building and most of the
 * staff, and share almost nothing else. A technician touches the clock four
 * times a day and never opens the register; a cashier does the reverse. One
 * manual covering both would be a manual where everybody skips half, and the
 * half people skip is where they stop looking for anything.
 */
export type Guide = "pos" | "timeclock";

export type ManualDoc = {
  title: T;
  subtitle: T;
  intro: { title: T; body: T };
  sections: Section[];
};


/** What the toggle that picks between them says. */
export const GUIDE_LABELS: Record<Guide, T> = {
  pos: { es: "Caja", en: "Register" },
  timeclock: { es: "Reloj", en: "Time clock" },
};

/**
 * Both manuals, keyed by the system they describe.
 *
 * The Help page picks one with a toggle; the print script writes all four
 * files — two guides, two languages — from exactly this. There is nowhere for
 * paper and screen to disagree, which is the only reason the content lives in
 * a data file instead of in the page that shows it.
 *
 * There was briefly a second set of these behind a gold button, written deeper
 * and kept beside the originals to be compared against them. It won, and the
 * originals were deleted the same day rather than left switched off — a manual
 * with two versions is a manual where nobody knows which one is true, which is
 * the failure this whole file exists to prevent. What is here is the deep one:
 * it shows pieces of the actual interface in the paragraph, says what changed
 * after every action, and defines the words on the screen, for somebody who has
 * never been taught that a screen is a set of parts.
 */
export const MANUALS: Record<Guide, ManualDoc> = {
  pos: {
    title: { es: "Sistema del Taller", en: "Shop System" },
    subtitle: {
      es: "Cómo cobrar, cómo cerrar el día, y qué hacer cuando algo sale mal",
      en: "How to take money, how to close the day, and what to do when something goes wrong",
    },
    intro: {
      title: { es: "Cómo leer este manual", en: "How to read this" },
      body: {
        es: "Un recuadro como [[New sale]] es el texto exacto de un botón de la pantalla; búsquelo tal cual. Los cuadros grises con dibujos adentro son **pedazos de la pantalla**, no botones de esta página: no se pueden tocar. Y después de cada cosa que se hace, hay una nota que dice **qué acaba de pasar**.",
        en: "A box like [[New sale]] is the exact text on a button; look for it as written. The grey slabs are **pieces of the screen**, not controls on this page — they cannot be pressed. And after every action there is a note saying **what just happened**.",
      },
    },
    sections: POS_SECTIONS,
  },
  timeclock: {
    title: { es: "Reloj Checador", en: "Time Clock" },
    subtitle: {
      es: "Marcar entrada y salida, corregir horas, y la parte de administración",
      en: "Punching in and out, correcting hours, and the admin side",
    },
    intro: {
      title: { es: "Cómo leer este manual", en: "How to read this" },
      body: {
        es: "Un recuadro como [[Check In]] es el texto exacto de un botón. Los cuadros grises son **pedazos de la pantalla**, no botones de esta página. Las primeras cinco secciones son para todo el personal; de ahí en adelante es la administración, que se abre con contraseña.",
        en: "A box like [[Check In]] is the exact text on a button. The grey slabs are **pieces of the screen**, not controls on this page. The first five sections are for everybody; from there on it is the admin side, opened with a password.",
      },
    },
    sections: TIMECLOCK_SECTIONS,
  },
};
