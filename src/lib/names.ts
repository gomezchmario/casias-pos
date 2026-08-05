/**
 * People's names, printed the way a name is printed.
 *
 * Employees get typed into the roster however whoever was standing there felt
 * like typing them — ADRAIN, adrain, Adrain — and then that shouting turns up on
 * the leaderboard, on receipts, on the close-out, next to names that were typed
 * properly. It reads as though the system is emphasising one technician over
 * another, which is a thing nobody meant and everybody notices.
 *
 * THE RULE: ONLY RE-CASE A WORD THAT CARRIES NO CASE INFORMATION
 *
 * A word written in one case throughout — ADRAIN, or adrain — is telling us
 * nothing about how it should look, so we decide: first letter up, rest down.
 *
 * A word that is already mixed — McCoy, DeLeon, O'Brien — is somebody having
 * typed it deliberately, and it is left exactly alone. This is the whole reason
 * the function is not a plain title-case: blanket title-casing turns McCoy into
 * Mccoy, which is not tidier, it is wrong, and it is wrong in a way the person
 * whose name it is cannot fix by retyping it.
 *
 * Hyphens, apostrophes and full stops start a new word inside a word, so
 * JEAN-LUC becomes Jean-Luc and O'BRIEN becomes O'Brien rather than Jean-luc and
 * O'brien.
 *
 * Nothing here is Spanish-aware. DE LA CRUZ comes out De La Cruz rather than de
 * la Cruz, because guessing which particles a family lowercases is a good way to
 * get somebody's own name wrong on their pay report — and if they want the small
 * d they can type it, and the mixed-case rule above will protect it forever.
 */
export function properName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .trim()
    .split(/\s+/)
    .map(fixWord)
    .join(" ");
}

function fixWord(word: string): string {
  // Already mixed — somebody meant that. Hands off.
  if (/[a-z]/.test(word) && /[A-Z]/.test(word)) return word;
  return word
    .toLowerCase()
    .replace(/(^|[-'’.])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}
