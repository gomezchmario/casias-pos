"use client";

import { useState } from "react";
import { readPref, writePref } from "@/components/pos/Podium";
import {
  GUIDE_LABELS,
  MANUALS,
  type Block,
  type Guide,
  type Lang,
  type T,
} from "@/lib/manual";
import { Specimen } from "./specimens";
import "./help.css";

/**
 * The manual, on the machine it is about.
 *
 * A printed manual is the thing in the drawer under the counter that nobody
 * opens, because getting to it means leaving the register. This is the same
 * words on the same screen the question was asked on — one tap from Main, and
 * one from the time clock.
 *
 * A PUBLIC route, and that is the whole reason it does not live under `/pos`
 * any more. It used to, and the time clock could not link to it: the clock is
 * the screen a technician stands at, he has no register sign-in, and a help
 * link that asks for a password he does not have is worse than no help link.
 *
 * Nothing here needs guarding. The manual describes what each role can do; it
 * never does any of it, holds no figures, and names no customer. It is the same
 * argument the inventory board and the wall leaderboard already sit on.
 */

/**
 * What the reader last chose, remembered per machine.
 *
 * Per machine rather than per person because these are shared screens: the
 * counter, the forecourt tablet and the office each have one reader most of the
 * time, and that reader wants the same language and usually the same system
 * every time. Signing in should not change what the manual opens as.
 */
function usePref<V extends string>(key: string, allowed: V[], fallback: V): [V, (v: V) => void] {
  const [value, set] = useState<V>(() => readPref(key, allowed, fallback) as V);
  return [
    value,
    (v) => {
      writePref(key, v);
      set(v);
    },
  ];
}

/** One row of choices — used for both the system and the language. */
function Segmented<V extends string>({
  value,
  options,
  onPick,
}: {
  value: V;
  options: { v: V; label: string }[];
  onPick: (v: V) => void;
}) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-black/10">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onPick(o.v)}
          aria-pressed={value === o.v}
          className={`px-3 h-9 text-sm font-medium whitespace-nowrap ${
            value === o.v ? "bg-brand-500 text-white" : "bg-white text-brand-400"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The two pieces of markup the manual carries, and no more.
 *
 * `[[Charge]]` becomes the button as it appears on screen — always in English,
 * in both languages, because that is what is printed on the thing being looked
 * for. `**bold**` is emphasis. Anything richer would need an editor, and this
 * text is meant to be corrected by whoever spots the mistake.
 */
function rich(s: string, key = "") {
  const out: React.ReactNode[] = [];
  const re = /\[\[(.+?)\]\]|\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1] !== undefined)
      out.push(
        <span key={`${key}-c${i++}`} className="manual-chip">
          {m[1]}
        </span>,
      );
    else if (m[2] !== undefined) out.push(<strong key={`${key}-b${i++}`}>{m[2]}</strong>);
    else out.push(<em key={`${key}-i${i++}`}>{m[3]}</em>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

function Blocks({ blocks, lang, k }: { blocks: Block[]; lang: Lang; k: string }) {
  return (
    <>
      {blocks.map((b, n) => {
        const key = `${k}-${n}`;
        const t = (x: T) => x[lang];
        switch (b.kind) {
          case "p":
            return <p key={key}>{rich(t(b.text), key)}</p>;
          case "h3":
            return <h3 key={key}>{rich(t(b.text), key)}</h3>;
          case "steps":
            return (
              <ol key={key} className="manual-steps">
                {b.items.map((it, j) => (
                  <li key={j}>{rich(t(it), `${key}-${j}`)}</li>
                ))}
              </ol>
            );
          case "list":
            return (
              <ul key={key} className="manual-list">
                {b.items.map((it, j) => (
                  <li key={j}>{rich(t(it), `${key}-${j}`)}</li>
                ))}
              </ul>
            );
          case "note":
          case "warn":
            return (
              <div key={key} className={b.kind === "warn" ? "manual-warn" : "manual-note"}>
                <div className="manual-callout-title">{t(b.title)}</div>
                {b.body.map((p, j) => (
                  <p key={j}>{rich(t(p), `${key}-${j}`)}</p>
                ))}
              </div>
            );
          case "ui":
            return (
              <div key={key}>
                <Specimen name={b.specimen} />
                {b.caption && <p className="manual-specimen-caption">{t(b.caption)}</p>}
              </div>
            );
          case "figure":
            return (
              <figure key={key} className="manual-figure">
                <div className="manual-figure-shot">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/manual/${b.src}`} alt={t(b.alt)} />
                  {b.callouts.map((c, j) => (
                    <span
                      key={j}
                      className="manual-pin"
                      style={{ left: `${c.x}%`, top: `${c.y}%` }}
                      aria-hidden
                    >
                      {j + 1}
                    </span>
                  ))}
                </div>
                <ol className="manual-legend">
                  {b.callouts.map((c, j) => (
                    <li key={j}>{rich(t(c.text), `${key}-${j}`)}</li>
                  ))}
                </ol>
              </figure>
            );
          case "table":
            return (
              <div key={key} className="manual-table-wrap">
                <table className="manual-table">
                  <thead>
                    <tr>
                      {b.head.map((h, j) => (
                        <th key={j}>{t(h)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, j) => (
                      <tr key={j}>
                        {row.map((c, q) => (
                          <td key={q} className={yesNo(t(c))}>
                            {rich(t(c), `${key}-${j}-${q}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </>
  );
}

/** The permissions grid is the one table where a cell is a verdict rather than a
 *  sentence, and colour is what makes it readable at a glance. */
function yesNo(cell: string): string | undefined {
  if (cell === "Sí" || cell === "Yes") return "manual-yes";
  if (cell === "No") return "manual-no";
  return undefined;
}

export function ManualView() {
  const [lang, setLang] = usePref<Lang>("pos.manual.lang", ["es", "en"], "es");
  const [guide, setGuide] = usePref<Guide>("pos.manual.guide", ["pos", "timeclock"], "pos");
  const doc = MANUALS[guide];
  const t = (x: T) => x[lang];

  return (
    /* Its own page furniture now that there is no POS shell around it — the
       same pale field the register sits on, so walking here from Main does not
       feel like leaving the system. */
    <div className="min-h-screen manual-page">
      <div className="max-w-4xl mx-auto px-6 py-6 manual">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6 no-print">
        <div>
          <h1 className="text-2xl font-semibold text-brand-500">{t(doc.title)}</h1>
          <p className="text-sm text-brand-300 mt-1">{t(doc.subtitle)}</p>
        </div>
        {/* Buttons rather than dropdowns, for both rows. A dropdown hides the
            option you are not on, and the person who needs the other language is
            exactly the person who cannot read the one on screen. Same argument
            for the system: somebody looking for the time clock should be able
            to see that there IS a time clock manual without opening anything. */}
        <div className="flex items-center gap-2 flex-wrap">
          <Segmented
            value={guide}
            onPick={setGuide}
            options={(["pos", "timeclock"] as Guide[]).map((g) => ({
              v: g,
              label: GUIDE_LABELS[g][lang],
            }))}
          />
          <Segmented
            value={lang}
            onPick={setLang}
            options={[
              { v: "es" as Lang, label: "Español" },
              { v: "en" as Lang, label: "English" },
            ]}
          />
          <button type="button" className="btn" onClick={() => window.print()}>
            {lang === "es" ? "Imprimir" : "Print"}
          </button>
        </div>
      </div>

      {/* The printed copy needs its own heading; the screen one is above and is
          `no-print`, because on paper the buttons beside it mean nothing. */}
      <div className="print-only manual-sheet-head">
        <div className="manual-sheet-title">{t(doc.title)}</div>
        <div className="manual-sheet-sub">{t(doc.subtitle)}</div>
      </div>

      <div className="manual-warn">
        <div className="manual-callout-title">{t(doc.intro.title)}</div>
        <p>{rich(t(doc.intro.body), "intro")}</p>
      </div>

      <div className="manual-toc">
        <div className="manual-callout-title">{lang === "es" ? "Contenido" : "Contents"}</div>
        <ol>
          {doc.sections.map((s, i) => (
            <li key={i}>
              <a href={`#s${i + 1}`}>{t(s.title)}</a>
            </li>
          ))}
        </ol>
      </div>

      {doc.sections.map((s, i) => (
        <section key={i} id={`s${i + 1}`} className="manual-section">
          <h2>
            <span className="manual-num">{String(i + 1).padStart(2, "0")}</span>
            {t(s.title)}
          </h2>
          <Blocks blocks={s.blocks} lang={lang} k={`s${i}`} />
        </section>
      ))}

      <div className="manual-foot">
        {lang === "es"
          ? "Casias Muffler and Tire Shop · Manual del sistema · Las pantallas están en inglés; los nombres de botones se muestran tal como aparecen."
          : "Casias Muffler and Tire Shop · Shop system manual · Button names are shown exactly as they appear on screen."}
      </div>
      </div>
    </div>
  );
}
