import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { requirePos } from "@/lib/api-helpers";
import { currentBusinessDate } from "@/lib/business-date";

/**
 * The written trends report, built fresh and handed over as a PDF.
 *
 * RUNS THE SCRIPT rather than reimplementing it. The document lives in
 * `scripts/build-shop-report.mts` — a thousand lines of Spanish prose, chart
 * markup and print CSS that already work and already print through Chrome, the
 * engine this shop actually prints with. A second copy of that inside the
 * server would be the two-manuals problem all over again: identical for a week,
 * then whichever one somebody forgot becomes the wrong one. The cost is a
 * shell-out and a few seconds; the button says so.
 *
 * ALWAYS REBUILT, never served from disk as-is. The report's own cover promises
 * "todas las cifras se recalculan cada vez que se genera este informe", and a
 * button that silently handed over last week's file would make the document a
 * liar in its first sentence. If the build fails, that is an error — not a
 * reason to quietly serve something stale.
 *
 * `viewBusinessReports`, matching the Trends page this document is the paper
 * form of — not `manageSettings`, even though the button lives on the settings
 * screen. The gate follows what is being read, not where the button sits.
 */

const ROOT = process.cwd();
const PDF = path.join(ROOT, "docs", "Informe-de-Tendencias.pdf");

/**
 * One build at a time, shared. Two owners clicking twice would race two Chrome
 * processes onto one output file; the second click simply waits for the first
 * build and gets the same fresh document.
 */
let inFlight: Promise<void> | null = null;

function buildReport(today: string): Promise<void> {
  inFlight ??= new Promise<void>((resolve, reject) => {
    execFile(
      "cmd.exe",
      [
        "/d",
        "/s",
        "/c",
        `npx --yes tsx --tsconfig scripts/tsconfig.preview.json scripts/build-shop-report.mts ${today}`,
      ],
      { cwd: ROOT, timeout: 180_000, windowsHide: true },
      (err, _stdout, stderr) => {
        if (err) reject(new Error(stderr.slice(-400) || err.message));
        else resolve();
      },
    );
  }).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export async function GET() {
  const auth = await requirePos("viewBusinessReports");
  if (!auth.ok) return auth.response;

  try {
    await buildReport(currentBusinessDate());
  } catch (e) {
    return NextResponse.json(
      { error: `The report did not build: ${(e as Error).message}` },
      { status: 500 },
    );
  }

  if (!fs.existsSync(PDF))
    return NextResponse.json(
      { error: "The build finished but left no PDF — is Chrome installed?" },
      { status: 500 },
    );

  return new NextResponse(new Uint8Array(fs.readFileSync(PDF)), {
    headers: {
      "Content-Type": "application/pdf",
      // `inline` so the browser opens its viewer — the person clicking this
      // wants to read and print, and a forced download puts a folder between
      // them and both. Saving is one click from the viewer anyway.
      "Content-Disposition": 'inline; filename="Informe-de-Tendencias.pdf"',
      "Cache-Control": "no-store",
    },
  });
}
