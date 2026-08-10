/**
 * Photographs the screens the manual points at.
 *
 * A manual for people who are nervous about computers lives or dies on whether
 * the picture matches what is in front of them, so these are photographs of the
 * running system rather than drawings of it. Run this after any change to a
 * screen the manual shows, and the figures are correct again.
 *
 *   npm start          (the server has to be up)
 *   npx --yes tsx scripts/shoot-manual.mts
 *
 * Only the screens that need no sign-in can be taken this way. The register and
 * the admin side ask for a PIN or a password, and this script has neither — for
 * those, the file in `public/manual/` has to be put there by somebody who is
 * signed in. See the note in `src/lib/manual.ts` about keeping them current.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve("public/manual");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.MANUAL_BASE ?? "https://localhost:3000";

/** Screens with no door on them — see the note at the top. */
const SHOTS: { name: string; url: string; w: number; h: number }[] = [
  { name: "clock", url: "/", w: 1100, h: 860 },
  { name: "inventory", url: "/inventory", w: 1280, h: 900 },
  { name: "leaderboard", url: "/leaderboard", w: 1280, h: 760 },
];

fs.mkdirSync(OUT, { recursive: true });

for (const s of SHOTS) {
  const file = path.join(OUT, `${s.name}.png`);
  execFileSync(CHROME, [
    "--headless",
    "--disable-gpu",
    "--ignore-certificate-errors",
    "--hide-scrollbars",
    `--window-size=${s.w},${s.h}`,
    // The clock starts a camera and the boards fetch before they settle; give
    // the page time to finish becoming itself before the shutter.
    "--virtual-time-budget=6000",
    `--screenshot=${file}`,
    BASE + s.url,
  ]);
  console.log("shot", file, `(${Math.round(fs.statSync(file).size / 1024)} KB)`);
}
