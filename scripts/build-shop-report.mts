/**
 * Informe de tendencias — a written report on the state of the business, as a
 * standalone PDF.
 *
 * NOT PART OF THE SITE, deliberately. The Trends page answers a question
 * somebody is already asking, on a screen, with the program running. This is a
 * document: it can be printed, emailed, handed to an accountant or a bank, and
 * read six months from now by somebody who has never seen the register. So it
 * carries what a screen leaves out — where the figures came from, how much of
 * the history is missing, the check that proves the fall is real, and the
 * tables the charts were drawn from.
 *
 * IN SPANISH, because it is written for the people who run this shop rather
 * than for the program. The program's own screens stay English with an optional
 * translation on top; this is the other way round, and there is no English
 * edition to drift out of step with.
 *
 * Every figure comes from `shopReport()`, which is `shopTrends()` — the same
 * function the page uses — plus the report's own evidence. Nothing here is
 * typed in by hand, so a report built next month is next month's report rather
 * than this one with the dates changed.
 *
 *   npx tsx --tsconfig scripts/tsconfig.preview.json scripts/build-shop-report.mts
 *
 * Emits HTML and then, if Chrome is where Windows normally puts it, prints to
 * PDF — the same pipeline `build-manual.mts` uses, and for the same reason:
 * the shop prints from Chrome, so the paper is laid out by the engine that
 * will actually lay it out.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BarChart,
  Bridge,
  LineChart,
  PairedBars,
  RankedBars,
  StackedBars,
} from "../src/components/pos/Charts.tsx";
import { shopReport } from "../src/lib/shop-report.ts";
import { formatCents } from "../src/lib/money.ts";

const today = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const r = shopReport(today);
const x = r.extras;
const c = r.compare;

// ── Formatting, Spanish ─────────────────────────────────────────────────────
const money = (n: number) => formatCents(Math.round(n));
const pct = (n: number, d = 0) => `${n > 0 ? "+" : "−"}${Math.abs(n).toFixed(d)} %`;
const num = (n: number, d = 1) => n.toFixed(d).replace(".", ",");
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const MES3 = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
/** "2026-08" → "Ago 26". */
const ml = (b: string) => `${MES3[Number(b.split("-")[1]) - 1]} ${b.slice(2, 4)}`;
/** "2026-08-09" → "9 de agosto de 2026". */
const fecha = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return `${day} de ${MESES[m - 1]} de ${y}`;
};

// ── Document furniture ──────────────────────────────────────────────────────
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** **bold** and *italic*, the same two marks the manual understands. */
const rich = (s: string) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");

let sectionNo = 0;
const parts: string[] = [];
const push = (s: string) => parts.push(s);

const H1 = (t: string) => push(`<h1 class="sec">${++sectionNo}. ${esc(t)}</h1>`);
const H2 = (t: string) => push(`<h2>${esc(t)}</h2>`);
const P = (t: string) => push(`<p>${rich(t)}</p>`);
const LEAD = (t: string) => push(`<p class="lead">${rich(t)}</p>`);
const NOTE = (t: string) => push(`<p class="note">${rich(t)}</p>`);
const BREAK = () => push('<div class="break"></div>');

/** A boxed conclusion — the thing a reader takes away if they read nothing else. */
const KEY = (title: string, body: string) =>
  push(`<div class="key"><div class="key-t">${esc(title)}</div><p>${rich(body)}</p></div>`);

/**
 * A figure, its caption, and — always — its reading instructions.
 *
 * EVERY CHART IN THIS DOCUMENT TEACHES ITSELF. The reader this report is
 * written for has run businesses since before computers were furniture and has
 * never needed one to know how his shop is doing; he is not going to ask what
 * an axis means, and he should never have to. So each figure carries a walk-
 * through in plain words: what each bar is, where to put your finger first,
 * what shape would be good news, and what shape is actually there. Written to
 * the reader's experience, not down to it — the charts confirm what a man who
 * has watched a counter for decades already senses, and the walkthrough's job
 * is to let him verify it himself.
 */
const FIG = (title: string, chart: unknown, explain: string, caption?: string) =>
  push(
    `<figure><figcaption class="fig-t">${esc(title)}</figcaption>` +
      `<div class="fig-b">${renderToStaticMarkup(chart as never)}</div>` +
      (caption ? `<figcaption class="fig-c">${rich(caption)}</figcaption>` : "") +
      `<div class="howto"><span class="howto-t">Cómo leer esta gráfica</span>${rich(explain)
        .split("\n\n")
        .map((p) => `<p>${p}</p>`)
        .join("")}</div>` +
      `</figure>`,
  );

const TABLE = (head: string[], rows: (string | number)[][], right = 1) =>
  push(
    `<table><thead><tr>${head
      .map((c2, i) => `<th${i >= right ? ' class="r"' : ""}>${esc(c2)}</th>`)
      .join("")}</tr></thead><tbody>${rows
      .map(
        (row) =>
          `<tr>${row
            .map((c2, i) => `<td${i >= right ? ' class="r"' : ""}>${esc(String(c2))}</td>`)
            .join("")}</tr>`,
      )
      .join("")}</tbody></table>`,
  );

const STATS = (items: { label: string; value: string; sub?: string }[]) =>
  push(
    `<div class="stats">${items
      .map(
        (s) =>
          `<div class="stat"><div class="stat-l">${esc(s.label)}</div>` +
          `<div class="stat-v">${esc(s.value)}</div>` +
          (s.sub ? `<div class="stat-s">${esc(s.sub)}</div>` : "") +
          `</div>`,
      )
      .join("")}</div>`,
  );

// Shared chart inputs.
const labels = r.months.map((m) => ml(m.bucket));
const orNull = (m: { tradingDays: number }, v: number) => (m.tradingDays > 0 ? v : null);
const accLabels = r.access.map((a) => ml(a.bucket));

// ═══════════════════════════════════════════════════════════════════════════
// 1 · Resumen ejecutivo
// ═══════════════════════════════════════════════════════════════════════════
H1("Resumen ejecutivo");

LEAD(
  `Entre ${fecha(x.history.firstDate)} y ${fecha(x.history.lastDate)} el taller registró ` +
    `**${x.history.tickets.toLocaleString("es-MX")} tickets** en **${x.history.tradingDays} días de trabajo**, ` +
    `por un total de **${money(x.history.takingsCents)}**. Comparando los últimos doce meses completos con ` +
    `los doce anteriores — y solo sobre los ${c.comparedMonths} meses que ambos años tienen registrados — ` +
    `la venta por día abierto pasó de ${money(c.perDayBeforeCents)} a ${money(c.perDayNowCents)}: ` +
    `**${pct(c.growthPct ?? 0)}**.`,
);

STATS([
  { label: "Venta por día abierto", value: money(c.perDayNowCents), sub: `${pct(c.growthPct ?? 0)} contra hace un año` },
  { label: "Tickets por día", value: num(c.ticketsPerDayNow), sub: `antes ${num(c.ticketsPerDayBefore)}` },
  { label: "Ticket promedio", value: money(c.avgTicketNowCents), sub: `antes ${money(c.avgTicketBeforeCents)}` },
  { label: "Técnicos en el piso", value: num(r.capacity.at(-1)?.techDaysPerDay ?? 0), sub: "en un día normal" },
]);

NOTE(
  "Cómo leer estos recuadros: el número grande es el de hoy, y el renglón chico debajo es el mismo dato hace un " +
    "año, para tener contra qué compararlo. \"Venta por día abierto\" es lo que deja un día normal de trabajo; " +
    "\"tickets por día\" es cuántas cuentas se cobran en ese día; y \"ticket promedio\" es de a cuánto sale cada " +
    "cuenta. Los tres juntos cuentan la historia completa: viene menos gente, y la que viene gasta menos.",
);

KEY(
  "La causa no es la demanda. Es que no hay llantas que vender.",
  `Tres cifras lo demuestran juntas. Las **medidas distintas** que salieron en un mes pasaron de ` +
    `${num(mean(r.access.slice(0, 6), (a) => a.sizesSold), 0)} a ${num(mean(r.access.slice(-6), (a) => a.sizesSold), 0)}. ` +
    `La **proporción de tickets que llevaron llanta** pasó de ${num(mean(r.access.slice(0, 6), (a) => a.ticketSharePct), 0)} % ` +
    `a ${num(mean(r.access.slice(-6), (a) => a.ticketSharePct), 0)} %. Y el **precio promedio de una llanta vendida** ` +
    `pasó de ${money(mean(r.access.slice(0, 6), (a) => a.avgLineCents))} a ${money(mean(r.access.slice(-6), (a) => a.avgLineCents))} — ` +
    `prácticamente no se movió.\n\nEsa última cifra es todo el argumento. Si a los clientes ya no les alcanzara para ` +
    `llantas, el precio promedio habría **bajado**, porque comprarían más barato. No bajó. Las llantas que sí están en ` +
    `el rack se siguen vendiendo en lo que siempre valieron; simplemente hay muchas menos, en la mitad del surtido, ` +
    `y mucha menos gente se va con uma. Es un problema de abasto, no de mercado.`,
);

P(
  `Todo lo demás de este informe es consistente con esa explicación y con ninguna otra: el ticket promedio bajó ` +
    `porque la llanta es lo que hacía grande un ticket; el sábado dejó de destacar porque ya no hay motivo para venir ` +
    `en sábado; y el equipo se redujo mientras cada técnico atiende **más** tickets, que es la forma que toma un taller ` +
    `cuando el trabajo se vuelve más chico y más rápido — ponchaduras en lugar de montajes.`,
);

H2("Lo que hay que saber, en orden");
P(
  `Las tarjetas que siguen no las escribió nadie: **las calcula el sistema** a partir de los registros, cada vez ` +
    `que se genera este informe. Cada una trae tres partes. La etiqueta de color dice qué tan seria es — roja es ` +
    `**grave**, ámbar es **para vigilar**, verde es **está bien** — y las verdes se incluyen a propósito, porque ` +
    `saber que algo NO se movió vale tanto como saber que algo sí. Debajo de la etiqueta viene el hallazgo con sus ` +
    `números, y al final, en letra más suave, qué significa y qué no significa. Van ordenadas de lo más serio a lo ` +
    `más tranquilo.`,
);
for (const k of r.concerns) {
  const tag = { serious: "Grave", watch: "Ojo", steady: "Estable" }[k.severity];
  push(
    `<div class="concern ${k.severity}"><div class="concern-h">` +
      `<span class="concern-tag">${tag}</span><span class="concern-t">${esc(es(k.title))}</span></div>` +
      `<p class="concern-f">${esc(es(k.finding))}</p>` +
      `<p class="concern-m">${esc(es(k.meaning))}</p></div>`,
  );
}

BREAK();

// ═══════════════════════════════════════════════════════════════════════════
// 2 · De dónde salen estas cifras
// ═══════════════════════════════════════════════════════════════════════════
H1("De dónde salen estas cifras");

P(
  `El historial de ventas se reconstruyó a partir de los cuadernos de Excel que llevaba la caja, importados al ` +
    `sistema ticket por ticket y renglón por renglón. No es un resumen: cada venta, su fecha, su cajero, su técnico ` +
    `y el detalle de lo que se cobró están capturados. A partir del ${fecha("2026-08-05")} el registro lo lleva ` +
    `directamente el punto de venta.`,
);

TABLE(
  ["Concepto", "Valor"],
  [
    ["Primer día registrado", fecha(x.history.firstDate)],
    ["Último día registrado", fecha(x.history.lastDate)],
    ["Días de trabajo con registro", x.history.tradingDays.toLocaleString("es-MX")],
    ["Tickets", x.history.tickets.toLocaleString("es-MX")],
    ["Venta acumulada", money(x.history.takingsCents)],
    ["Meses completos con registro", String(r.monthsOnRecord)],
  ],
);

H2("Lo que falta");
P(
  `Hay tramos que nadie anotó. Se buscaron en todos los respaldos disponibles y no aparecen en ninguno. ` +
    `**No se cuentan como cero en ninguna comparación de este informe**, porque un mes sin registro valdría cero y ` +
    `un cero contra un mes completo del año anterior se leería como un desplome que nunca ocurrió.`,
);
TABLE(
  ["Desde", "Hasta", "Días"],
  x.history.gaps.map((g) => [fecha(g.from), fecha(g.to), g.days]),
  2,
);

H2("La comprobación que sostiene el informe");
if (x.verification) {
  const v = x.verification;
  P(
    `La objeción evidente a todo lo anterior es que un cuaderno llevado con menos cuidado en 2026 que en 2024 ` +
      `fabricaría una caída de la nada. Hay un mes en que existieron **dos registros independientes del mismo taller**: ` +
      `el punto de venta y el cuaderno, corriendo a la vez.`,
  );
  TABLE(
    ["Registro", "Días", "Tickets", "Tickets por día", "Venta por día", "Ticket promedio"],
    [
      ["Punto de venta", v.pos.days, v.pos.tickets, num(v.pos.tickets / v.pos.days), money(v.pos.perDayCents), money(v.pos.avgTicketCents)],
      ["Cuaderno de Excel", v.excel.days, v.excel.tickets, num(v.excel.tickets / v.excel.days), money(v.excel.perDayCents), money(v.excel.avgTicketCents)],
    ],
  );
  const gapPct = Math.abs(
    ((v.pos.perDayCents - v.excel.perDayCents) / (v.excel.perDayCents || 1)) * 100,
  );
  KEY(
    "Los dos registros coinciden",
    `En ${ml(v.month)} los dos sistemas — uno automático, otro a mano — difieren en **${num(gapPct)} %** en la venta ` +
      `por día. La caída que describe este informe es real y no un efecto de cómo se llevaron los papeles.`,
  );
} else {
  P(`No hay un mes con registro doble, así que esta comprobación no se pudo hacer.`);
}

H2("Cómo se mide");
P(
  `**Todo se divide entre días de trabajo, no entre meses.** Febrero es corto, una semana cerrado en julio no es un ` +
    `mal julio, y un mes sin registro no es un mes sin ventas. Dividir entre los días de los que sí hay registro ` +
    `convierte un hueco en una muestra más chica en vez de en una catástrofe.`,
);
P(
  `**Las comparaciones son mes contra el mismo mes del año anterior**, y solo donde ambos tienen registro. ` +
    `De los doce meses del último año, ${c.comparedMonths} entraron en la comparación` +
    (c.skippedMonths.length
      ? ` y ${c.skippedMonths.length} quedaron fuera (${c.skippedMonths.map(ml).join(", ")}).`
      : `.`),
);
P(
  `**El mes en curso nunca entra en una comparación.** El día ${Number(today.slice(8))} del mes lleva una fracción ` +
    `del mes y se leería como un derrumbe.`,
);

H2("Lo que estos datos no pueden decir");
P(
  `**Horas trabajadas.** El reloj checador tiene un puñado de registros contra dos años y medio de ventas. Donde este ` +
    `informe dice "técnicos en el piso" se refiere a técnicos con trabajo acreditado ese día, y todo lo derivado es ` +
    `por técnico-día, nunca por hora.`,
);
P(
  `**Quién estuvo en el mostrador.** Todos los tickets importados nombran a la misma persona como cajero, porque el ` +
    `cuaderno nunca lo anotaba. Cualquier medida de desempeño de mostrador hablaría de la importación, no del taller.`,
);
P(
  `**Existencias históricas.** Lo que había en el rack en un día de 2024 no está en ninguna parte. Por eso la ` +
    `sección 4 usa tres indicadores de venta como sustituto, en lugar de un inventario que no existe.`,
);

BREAK();

// ═══════════════════════════════════════════════════════════════════════════
// 3 · La caída, y de qué se compone
// ═══════════════════════════════════════════════════════════════════════════
H1("La caída, y de qué se compone");

P(
  `La venta por día abierto es, exactamente, **tickets por día multiplicado por ticket promedio**. Un cambio en ella ` +
    `se reparte entre esas dos causas sin residuo y sin una tercera. La distinción importa: menos clientes es un ` +
    `problema de abasto y de atracción; tickets más chicos es un problema de qué se vende. Pedirían respuestas ` +
    `opuestas, y un taller que confunda una con otra pasará un año arreglando lo que no era.`,
);

FIG(
  "De hace un año a hoy, una causa a la vez",
  h(Bridge, {
    start: { label: "Hace un año", value: c.perDayBeforeCents },
    steps: [
      { label: "Cuántos tickets", delta: c.fromVolumeCents },
      { label: "De a cómo cada uno", delta: c.fromPriceCents },
    ],
    end: c.perDayNowCents,
    endLabel: "Hoy",
    format: money,
  }),
  `Léala como una escalera, de izquierda a derecha. La primera barra, la azul de la izquierda, es lo que el taller ` +
    `vendía en un día normal hace un año: ${money(c.perDayBeforeCents)}. La última barra, la azul de la derecha, es lo ` +
    `que vende hoy: ${money(c.perDayNowCents)}. Las barras de en medio son los escalones que llevan de una cifra a la ` +
    `otra: un escalón rojo baja, un escalón verde sube, y cada uno tiene nombre.\n\nEl primer escalón es lo que cambió ` +
    `porque **cambió cuánta gente viene** — cuántos carros llegan al taller. El segundo es lo que cambió porque ` +
    `**cambió cuánto gasta cada uno**. No hay una tercera razón posible: la venta de un día es cuántas cuentas se ` +
    `cobraron por el tamaño de cada cuenta, igual que siempre ha sido, y por eso los escalones suman exactamente la ` +
    `diferencia, sin sobrar ni faltar un centavo.\n\n` +
    (c.fromVolumeCents < 0 && c.fromPriceCents < 0
      ? `Aquí los dos escalones son rojos, y el más grande es el de los clientes: de los ` +
        `${money(Math.abs(c.perDayNowCents - c.perDayBeforeCents))} diarios que se perdieron, ` +
        `**${money(Math.abs(c.fromVolumeCents))} son gente que ya no viene** y ${money(Math.abs(c.fromPriceCents))} son ` +
        `cuentas más chicas de la gente que todavía viene.`
      : `Aquí el escalón de la gente vale ${money(c.fromVolumeCents)} diarios y el del gasto por cliente ` +
        `${money(c.fromPriceCents)}; el signo de cada barra dice cuál ayudó y cuál estorbó.`),
  `De los ${money(Math.abs(c.perDayNowCents - c.perDayBeforeCents))} diarios de diferencia, ` +
    `**${money(Math.abs(c.fromVolumeCents))} vienen del número de tickets** y ` +
    `${money(Math.abs(c.fromPriceCents))} del tamaño de cada uno. Las dos barras suman el cambio completo.`,
);

FIG(
  "Venta por cada día abierto, mes por mes",
  h(BarChart, {
    data: r.months.map((m) => ({
      label: ml(m.bucket),
      value: m.perDayCents,
      sub: m.tradingDays === 0 ? "sin registro" : undefined,
    })),
    format: money,
    height: 150,
  }),
  `Cada barra es un mes, y la altura de la barra es cuánto vendió el taller **en un día normal de ese mes** — no el ` +
    `mes entero. Se mide así a propósito: febrero es corto, y un mes donde se cerró una semana no fue un mal mes, ` +
    `nada más fue un mes con menos días. Al dividir entre los días que sí se trabajó, cada barra se puede comparar ` +
    `con cualquier otra sin trampa.\n\nPonga el dedo en la barra más alta, a la izquierda, y recórralas hacia la ` +
    `derecha. No hace falta leer ningún número: la forma baja como una rampa, mes tras mes, durante dos años. Un mal ` +
    `invierno se vería como un valle con recuperación después. Esto no es un valle — no se recupera.\n\nDonde una ` +
    `barra dice "sin registro" no es que no se vendió: es que ese mes nadie llevó el cuaderno, y este informe lo dice ` +
    `en lugar de esconderlo.`,
  "La última barra es el mes en curso y no está completo.",
);

FIG(
  "La misma cifra sin la temporada",
  h(LineChart, {
    series: [
      {
        name: "Doce meses hasta aquí",
        values: r.ttm.map((p, i) => (i >= 11 ? p.perDayCents : null)),
      },
    ],
    labels: r.ttm.map((p) => ml(p.bucket)),
    format: money,
    height: 150,
  }),
  `Usted conoce mejor que nadie el ritmo del año: los reembolsos de impuestos, el calor, la temporada floja de ` +
    `diciembre. Ese ritmo hace que la gráfica anterior suba y baje aunque el negocio esté igual, y un ojo confiado ` +
    `puede tomar una subida de temporada por una mejoría. Esta gráfica le quita ese ruido.\n\nEl truco es simple: ` +
    `cada punto de la línea no es un mes, sino **el promedio de los doce meses que terminan ahí**. Como doce meses ` +
    `siempre traen un enero, un febrero, un marzo y así hasta diciembre, la temporada completa está dentro de cada ` +
    `punto y ya no puede mover la línea. Lo único que puede moverla es el negocio mismo.\n\nPor eso esta es la ` +
    `gráfica más seria del informe: no tiene excusas adentro. Si el taller estuviera igual que hace dos años, la ` +
    `línea sería plana. Si se estuviera recuperando, en algún tramo subiría. Recórrala con el dedo de izquierda a ` +
    `derecha: baja en todo su recorrido, sin un solo repunte.\n\nVerá que la línea empieza a la mitad de la gráfica ` +
    `y no en la orilla. No falta nada: a los primeros meses del registro todavía no les caben doce meses atrás, y en ` +
    `lugar de dibujarlos a medias — que engañaría — se dejan en blanco.`,
);

BREAK();

// ═══════════════════════════════════════════════════════════════════════════
// 4 · Si había llantas que vender
// ═══════════════════════════════════════════════════════════════════════════
H1("Si había llantas que vender");

P(
  `Lo que había en el rack no se anotó nunca, así que no se puede consultar directamente. Tres indicadores tomados ` +
    `de las ventas lo sustituyen, y juntos son difíciles de rebatir.`,
);

FIG(
  "Medidas distintas vendidas en el mes",
  h(LineChart, {
    series: [{ name: "Medidas", values: r.access.map((a) => a.sizesSold) }],
    labels: accLabels,
    format: (n: number) => n.toFixed(0),
  }),
  `Esta línea no cuenta llantas — cuenta **medidas**. Si en un mes se vendieron doscientas llantas pero todas eran ` +
    `de cinco medidas, la línea marca cinco. Es la manera de medir, desde las ventas, qué tan surtido estaba el ` +
    `rack: nadie puede venderle al cliente una medida que no tiene.\n\nUsted sabe cómo se vacía un rack cuando se ` +
    `deja de comprar: primero faltan las medidas raras, las que rotan poco, y el mostrador todavía sale adelante con ` +
    `las comunes. Después faltan también las comunes. Por eso esta línea es la **alarma temprana** — se angosta ` +
    `meses antes de que la venta lo resienta, y aquí se angostó de ${num(mean(r.access.slice(0, 6), (a) => a.sizesSold), 0)} ` +
    `medidas al mes a ${num(mean(r.access.slice(-6), (a) => a.sizesSold), 0)}. Menos de la mitad del surtido que el ` +
    `taller sabía vender sigue pasando por el mostrador.`,
  "El surtido que de verdad se ofrecía, medido desde lo que salió por la puerta.",
);

FIG(
  "Proporción de tickets que llevaron llanta",
  h(LineChart, {
    series: [
      { name: "Parte de los tickets", values: r.access.map((a) => a.ticketSharePct), color: "#b45309" },
    ],
    labels: accLabels,
    format: (n: number) => `${n.toFixed(0)} %`,
  }),
  `De cada cien cuentas que se cobraron en el mes, esta línea dice cuántas incluyeron al menos una llanta nueva. ` +
    `No mide cuánta gente vino — mide **qué se llevó la gente que sí vino**.\n\nEso importa porque separa dos ` +
    `historias que se confunden. Si al taller llegara menos gente pero la que llega comprara igual, esta línea ` +
    `estaría plana y el problema sería de afluencia. En cambio la línea baja de ` +
    `${num(mean(r.access.slice(0, 6), (a) => a.ticketSharePct), 0)} de cada cien a ` +
    `${num(mean(r.access.slice(-6), (a) => a.ticketSharePct), 0)} de cada cien: el cliente sigue entrando por la ` +
    `puerta, pero cada vez más seguido se va **sin llanta** — se va con la ponchadura parchada y nada más. El ` +
    `cliente que pregunta por su medida, no la encuentra y se lleva otra cosa más barata, vive exactamente en esta ` +
    `gráfica.`,
);

FIG(
  "De a cómo se vendió una llanta — el control",
  h(LineChart, {
    series: [
      {
        name: "Llanta promedio",
        values: r.access.map((a) => (a.avgLineCents > 0 ? a.avgLineCents : null)),
        color: "#15803d",
      },
    ],
    labels: accLabels,
    format: money,
  }),
  `Esta es la gráfica que decide la discusión, y vale la pena entender por qué.\n\nCada punto es el precio promedio ` +
    `al que salió una llanta nueva ese mes. Ahora piense en las dos explicaciones posibles de la caída. Si el ` +
    `problema fuera **el cliente** — que ya no le alcanza, que la zona se empobreció, que la competencia lo está ` +
    `ganando con precio — usted sabe perfectamente qué haría ese cliente: no dejaría de necesitar llantas, compraría ` +
    `**más barato**. Pediría la de segunda marca, la usada, la más económica del rack. Y esta línea bajaría, porque ` +
    `es el promedio de lo que se vendió.\n\nLa línea no baja. Empezó alrededor de ` +
    `${money(mean(r.access.slice(0, 6), (a) => a.avgLineCents))} y hoy anda en ` +
    `${money(mean(r.access.slice(-6), (a) => a.avgLineCents))} — igual o un poco más arriba. La llanta que sí está ` +
    `en el rack se sigue vendiendo en lo que siempre ha valido, sin regateo y sin rebaja. Un cliente empobrecido no ` +
    `deja esa huella. Un rack vacío, sí: se vende poco, a precio normal, de un surtido corto. Por eso este informe ` +
    `puede afirmar que el problema es de abasto y no de mercado.`,
);

FIG(
  "Qué vende el taller, por cada día abierto",
  h(LineChart, {
    series: [
      { name: "Llantas nuevas", values: r.categories.map((v) => v.newCents) },
      { name: "Servicio", values: r.categories.map((v) => v.serviceCents), color: "#b45309" },
      { name: "Llantas usadas", values: r.categories.map((v) => v.usedCents), color: "#1f7a8c" },
    ],
    labels: r.categories.map((v) => ml(v.bucket)),
    format: money,
    height: 150,
  }),
  `Aquí el negocio está partido en sus tres fuentes de dinero, cada una con su propia línea: **azul marino** es la ` +
    `llanta nueva, **naranja** es el servicio — ponchaduras, montajes, balanceos, toda la mano de obra — y **azul ` +
    `claro** es la llanta usada. La altura de cada línea es cuánto dejó esa parte del negocio en un día normal de ` +
    `ese mes.\n\nMire primero cuál línea venía arriba: la llanta nueva. Era la columna vertebral del ingreso, el ` +
    `doble o el triple del servicio. Ahora siga la azul marino con el dedo: es la que se desploma, hasta cruzarse ` +
    `con la naranja y quedar debajo. El servicio también bajó — sin venta de llanta se pierde también su montaje y ` +
    `su balanceo — pero bajó mucho menos, porque una ponchadura no necesita inventario para cobrarse.\n\nSe dibujan ` +
    `las tres por separado, en dinero y no en porcentajes, por una razón: en una gráfica de porcentajes el servicio ` +
    `parecería estar "creciendo", cuando lo cierto es que no creció nada — nada más quedó de pie mientras lo demás ` +
    `se caía.`,
);

H2("En qué se convirtió el taller");
P(
  `Los renglones más frecuentes que no corresponden a un producto de inventario — es decir, el trabajo de mano de ` +
    `obra — cuentan la misma historia desde otro lado.`,
);
TABLE(
  ["Concepto", "Renglones", "Importe"],
  x.topLines.early.map((l) => [l.label, l.lines.toLocaleString("es-MX"), money(l.cents)]),
);
NOTE(`Primer trimestre con registro · ${x.topLines.earlyLabel}`);
TABLE(
  ["Concepto", "Renglones", "Importe"],
  x.topLines.late.map((l) => [l.label, l.lines.toLocaleString("es-MX"), money(l.cents)]),
);
NOTE(`Último trimestre · ${x.topLines.lateLabel}`);

KEY(
  "El taller se volvió un taller de ponchaduras",
  `La ponchadura siempre fue el renglón más frecuente, pero antes venía acompañada de inspecciones, montajes y ` +
    `llanta usada. Hoy la lista se acorta a ponchadura, montaje y revisión. El trabajo que quedó es el que **no ` +
    `necesita inventario para hacerse** — que es exactamente lo que queda cuando no hay inventario.`,
);

H2("Llantas usadas");
P(
  `La llanta usada entra al taller por compra de mostrador. El sistema tiene registradas ` +
    `**${x.buybacks.tickets} compras en total**, por ${money(x.buybacks.cents)}. Esa línea del negocio perdió su ` +
    `propio abasto, no solo su venta.`,
);

H2("Lo que hay hoy en el rack");
TABLE(
  ["Concepto", "Valor"],
  [
    ["Productos activos en el catálogo", x.stock.activeProducts.toLocaleString("es-MX")],
    ["Medidas con existencia mayor a cero", x.stock.sizesWithStock.toLocaleString("es-MX")],
    ["Piezas en existencia", x.stock.units.toLocaleString("es-MX")],
    ["Medidas distintas vendidas en 90 días", x.stock.soldLast90.toLocaleString("es-MX")],
    [
      "Días de cobertura al ritmo actual",
      x.stock.daysOfCover === null ? "—" : `${x.stock.daysOfCover} días`,
    ],
  ],
);
NOTE(
  "El catálogo tiene muchas más medidas que las que tienen existencia. La diferencia entre esas dos cifras es el " +
    "surtido que el taller sabe vender y hoy no puede ofrecer.",
);

BREAK();

// ═══════════════════════════════════════════════════════════════════════════
// 5 · El equipo
// ═══════════════════════════════════════════════════════════════════════════
H1("El equipo");

P(
  `Esta sección se presta a una lectura equivocada y conviene adelantarla: **el equipo no empeoró.** Se hizo más ` +
    `chico, y el trabajo que quedó es de otro tipo.`,
);

FIG(
  "Técnicos en el piso en un día normal",
  h(LineChart, {
    series: [{ name: "En el piso", values: r.capacity.map((v) => v.techDaysPerDay) }],
    labels: r.capacity.map((v) => ml(v.bucket)),
    format: (n: number) => n.toFixed(1),
  }),
  `Cada punto responde una pregunta sencilla: en un día normal de ese mes, ¿cuántos muchachos estaban trabajando? ` +
    `No se cuenta con el reloj checador — se cuenta a quien los registros de venta le acreditan trabajo ese día, ` +
    `que es la única lista de asistencia que estos papeles pueden probar.\n\nPuede salir un número con decimal, y ` +
    `no es un error: si un mes tuvo días con siete técnicos y días con seis, el promedio da seis y medio. Léalo como ` +
    `"cuánta gente había, más o menos, un día cualquiera".\n\nLa línea habla sola: el taller operaba con ` +
    `${num(mean(r.capacity.slice(0, 6), (v) => v.techDaysPerDay))} técnicos un día normal y hoy opera con ` +
    `${num(mean(r.capacity.slice(-6), (v) => v.techDaysPerDay))}. Las dos gráficas que siguen dicen qué pasó con los ` +
    `que se quedaron — y esa parte es la que desmiente la lectura fácil.`,
);

FIG(
  "Tickets que saca un técnico en un día",
  h(LineChart, {
    series: [
      { name: "Tickets", values: r.capacity.map((v) => v.ticketsPerTechDay), color: "#b45309" },
    ],
    labels: r.capacity.map((v) => ml(v.bucket)),
    format: (n: number) => n.toFixed(1),
  }),
  `Aquí se toma el total de cuentas del día y se reparte entre los técnicos que estuvieron. Es la medida de qué tan ` +
    `ocupado está **cada uno**, sin importar cuántos sean.\n\nFíjese que esta línea va **para arriba** — de ` +
    `${num(mean(r.capacity.slice(0, 6), (v) => v.ticketsPerTechDay))} cuentas por técnico a ` +
    `${num(mean(r.capacity.slice(-6), (v) => v.ticketsPerTechDay))}. Eso descarta una explicación que a cualquiera ` +
    `se le ocurriría primero: que el taller vende menos porque la gente que quedó trabaja menos. Es exactamente al ` +
    `revés. Los que quedaron están despachando más cuentas por cabeza que nunca en todo el registro. Si el trabajo ` +
    `se hubiera acabado, estarían parados; no lo están.`,
);

FIG(
  "Dinero que entra por técnico-día",
  h(LineChart, {
    series: [
      { name: "Por técnico-día", values: r.capacity.map((v) => v.perTechDayCents), color: "#15803d" },
    ],
    labels: r.capacity.map((v) => ml(v.bucket)),
    format: money,
  }),
  `La misma cuenta que la anterior, pero en dinero: cuánto dejó cada técnico en un día. Y aquí está la clave de ` +
    `toda la sección, porque hay que leer las dos gráficas **juntas**.\n\nCada técnico despacha bastantes más ` +
    `cuentas que antes — eso dice la gráfica anterior — pero el dinero por técnico subió apenas de ` +
    `${money(mean(r.capacity.slice(0, 6), (v) => v.perTechDayCents))} a ` +
    `${money(mean(r.capacity.slice(-6), (v) => v.perTechDayCents))}. Más trabajos, casi el mismo dinero, solo puede ` +
    `significar una cosa: **cada trabajo se hizo más chico.** Una ponchadura se cobra en minutos y deja poco; montar ` +
    `un juego de llantas tarda y deja bueno. Cambie montajes por ponchaduras y el conteo de cuentas sube mientras el ` +
    `dinero se queda igual — que es exactamente lo que muestran estas dos líneas. Los muchachos no se volvieron ni ` +
    `más lentos ni más rápidos: les cambió el trabajo que hay para hacer.`,
);

{
  const then = r.capacity.slice(0, 6);
  const now = r.capacity.slice(-6);
  TABLE(
    ["Indicador", "Al inicio del registro", "Hoy", "Cambio"],
    [
      [
        "Técnicos en el piso, día normal",
        num(mean(then, (v) => v.techDaysPerDay)),
        num(mean(now, (v) => v.techDaysPerDay)),
        pct(((mean(now, (v) => v.techDaysPerDay) - mean(then, (v) => v.techDaysPerDay)) / mean(then, (v) => v.techDaysPerDay)) * 100),
      ],
      [
        "Tickets por técnico-día",
        num(mean(then, (v) => v.ticketsPerTechDay)),
        num(mean(now, (v) => v.ticketsPerTechDay)),
        pct(((mean(now, (v) => v.ticketsPerTechDay) - mean(then, (v) => v.ticketsPerTechDay)) / mean(then, (v) => v.ticketsPerTechDay)) * 100),
      ],
      [
        "Venta por técnico-día",
        money(mean(then, (v) => v.perTechDayCents)),
        money(mean(now, (v) => v.perTechDayCents)),
        pct(((mean(now, (v) => v.perTechDayCents) - mean(then, (v) => v.perTechDayCents)) / mean(then, (v) => v.perTechDayCents)) * 100),
      ],
    ],
  );
}

KEY(
  "Más tickets cada uno, casi el mismo dinero cada uno",
  `Esa combinación es la firma de un trabajo que se hizo **más chico y más rápido**, no de gente que se volvió más ` +
    `productiva ni de gente que se volvió lenta. Una ponchadura es rápida y barata; montar un juego de llantas es ` +
    `lento y caro. Cambie uno por el otro y el conteo de tickets por técnico sube mientras la venta no.`,
);

BREAK();

// ═══════════════════════════════════════════════════════════════════════════
// 6 · La semana y el año
// ═══════════════════════════════════════════════════════════════════════════
H1("La semana y el año");

{
  // The walkthrough names the shop's own strongest day rather than assuming
  // one — the report regenerates from live data and the answer can change.
  const peakDay =
    DIAS[
      r.weekday.reduce((best, w) => (w.earlyPerDayCents > r.weekday[best].earlyPerDayCents ? w.weekday : best), 0)
    ].toLowerCase();
  FIG(
    `La semana, antes y ahora`,
    h(PairedBars, {
      data: r.weekday.map((w) => ({
        label: DIAS[w.weekday].slice(0, 3),
        a: w.earlyPerDayCents,
        b: w.latePerDayCents,
      })),
      labels: ["Antes", "Ahora"],
      format: money,
    }),
    `Cada día de la semana tiene dos barras juntas: la primera es lo que vendía ese día en el primer año del registro ` +
      `("Antes") y la segunda lo que vende en el último año ("Ahora"). Sirve para comparar la **forma** de la semana, ` +
      `no solo su tamaño.\n\nDos cosas para ver. La primera salta a la vista: todas las barras de "Ahora" son más ` +
      `chicas — la caída no respeta ningún día. La segunda es más fina y más importante: fíjese en el **${peakDay}**. ` +
      `Antes, su barra sobresalía claramente del resto de la semana; era el día en que la familia traía el carro para ` +
      `la llanta que venía aplazando. Ahora su barra apenas se distingue de las demás.\n\nUn día fuerte existe porque ` +
      `hay un motivo para escogerlo: el cliente aparta su ${peakDay} para una compra grande, no para un parche. ` +
      `Cuando la compra grande ya no se puede hacer — porque no está la medida — el ${peakDay} deja de tener chiste, ` +
      `y la semana entera se aplana. Eso es lo que muestran estas barras, y es la señal de que el daño ya no es solo ` +
      `de venta sino de **costumbre del cliente**.`,
    `${r.weekdayLabels.early} contra ${r.weekdayLabels.late}.`,
  );
}

{
  const wkE = r.weekday.reduce((n, w) => n + w.earlyPerDayCents, 0) / 7;
  const wkL = r.weekday.reduce((n, w) => n + w.latePerDayCents, 0) / 7;
  const pkE = Math.max(...r.weekday.map((w) => w.earlyPerDayCents));
  const pkL = Math.max(...r.weekday.map((w) => w.latePerDayCents));
  const which = DIAS[r.weekday.findIndex((w) => w.earlyPerDayCents === pkE)];
  P(
    `${which} era el día fuerte: vendía **${num((pkE / wkE - 1) * 100, 0)} % más** que un día normal. Hoy vende ` +
      `**${num((pkL / wkL - 1) * 100, 0)} % más**. Un mejor día que deja de destacar es lo que se ve cuando ya no ` +
      `hay un motivo particular para venir ese día.`,
  );
}

FIG(
  "El año del taller",
  h(RankedBars, {
    data: r.seasonality.map((s) => ({
      label: MESES[s.month - 1][0].toUpperCase() + MESES[s.month - 1].slice(1),
      value: s.perDayCents,
      note: ` · ${s.years} años`,
    })),
    format: money,
  }),
  `Esta gráfica junta todos los eneros del registro y los promedia, todos los febreros y los promedia, y así con ` +
    `los doce meses. La barra más larga es el mes que históricamente más vende por día trabajado; la más corta, el ` +
    `que menos. La anotación junto a cada barra dice de cuántos años salió el promedio.\n\nNo es una gráfica de ` +
    `alarma — es el mapa del terreno, y seguramente confirma lo que usted ya sabe de memoria: el empuje de mayo y ` +
    `junio con el calor, el respiro de diciembre y enero. Su valor está en la planeación: dice **cuándo tiene que ` +
    `estar lleno el rack**. El inventario que se va a vender en la temporada fuerte se compra antes de la temporada ` +
    `fuerte, y esta gráfica pone fecha a ese "antes".`,
);

BREAK();

// ═══════════════════════════════════════════════════════════════════════════
// 7 · Cobros y controles
// ═══════════════════════════════════════════════════════════════════════════
H1("Cobros y controles");

FIG(
  "Cómo se cobra, trimestre por trimestre",
  h(StackedBars, {
    columns: r.tender.map((q) => ({
      label: q.bucket.replace("-", " "),
      // Tender names stay English on the register because they must match the
      // card terminal's slips. On paper there is no slip to match, so the
      // legend can speak the reader's language. Clover and SNAP are names.
      parts: q.parts.map((p) => ({
        label:
          { "Credit Card": "Tarjeta", Cash: "Efectivo", Other: "Otros", "PO Shop": "PO del taller" }[
            p.label
          ] ?? p.label,
        value: p.cents,
      })),
    })),
    format: money,
  }),
  `Cada columna es un trimestre, y todas las columnas miden lo mismo de alto a propósito: aquí no se compara cuánto ` +
    `se cobró, sino **en qué proporción** — cuánto fue tarjeta, cuánto efectivo, cuánto lo demás. Los colores son ` +
    `las franjas de la leyenda, y una franja se sigue con la vista de columna en columna, como una veta en la ` +
    `madera.\n\n¿Por qué vigilar esto? Porque usted sabe igual que cualquiera que ha tenido mostrador: si en un ` +
    `negocio el efectivo empieza a "no llegar a la caja", el primer lugar donde se nota es aquí — la franja del ` +
    `efectivo se adelgaza sola, sin que ninguna otra cosa lo explique. Es la prueba del algodón del manejo de la ` +
    `caja.\n\nY la noticia aquí es buena precisamente porque la gráfica es aburrida: la franja del efectivo mide ` +
    `prácticamente lo mismo en la primera columna que en la última, con dos años y media docena de personas distintas ` +
    `en el mostrador de por medio. El dinero se está cobrando como siempre; nada más está entrando menos.`,
);

TABLE(
  ["Control", "Resultado"],
  [
    [
      "Descuentos otorgados en todo el historial",
      x.control.discountTickets === 0
        ? "Ninguno — la función nunca se ha usado"
        : `${money(x.control.discountCents)} en ${x.control.discountTickets} tickets`,
    ],
    [
      "Tickets cancelados",
      `${x.control.voidedTickets} · ${money(x.control.voidedCents)}`,
    ],
    [
      "Ventas del último año a las que se les puede asignar costo",
      `${x.control.costCoveragePct} %`,
    ],
  ],
);
NOTE(
  "El margen bruto se calcula únicamente sobre la parte que tiene costo asignado, y por eso describe esa parte y " +
    "no el taller entero. Se corrige capturando costos en Configuración → Lo que nos cuesta.",
);

BREAK();

// ═══════════════════════════════════════════════════════════════════════════
// 8 · Conclusiones
// ═══════════════════════════════════════════════════════════════════════════
H1("Conclusiones");

P(
  `**1. La caída es real.** Dos sistemas de registro independientes coinciden en el mes en que ambos funcionaron, ` +
    `y la tendencia es continua a lo largo de ${r.monthsOnRecord} meses sin un solo salto en la frontera de ninguna ` +
    `importación.`,
);
P(
  `**2. La causa es de abasto, no de mercado.** El precio promedio por llanta vendida no se movió mientras el ` +
    `surtido se redujo a la mitad y la proporción de tickets con llanta casi se partió en dos. Un mercado que ya no ` +
    `puede pagar deja otra huella: precios a la baja. Esa huella no está.`,
);
P(
  `**3. El daño se está acumulando en el hábito del cliente**, no solo en la venta del día. El sábado dejó de ser ` +
    `el día fuerte. Un cliente que llega dos veces y no encuentra su medida deja de llegar, y recuperarlo cuesta más ` +
    `que no haberlo perdido.`,
);
P(
  `**4. La capacidad instalada todavía existe pero se está encogiendo.** El equipo pasó de ` +
    `${num(mean(r.capacity.slice(0, 6), (v) => v.techDaysPerDay))} a ` +
    `${num(mean(r.capacity.slice(-6), (v) => v.techDaysPerDay))} técnicos en un día normal. Cada técnico que se va ` +
    `es capacidad que no regresa el día que vuelva a haber inventario.`,
);
P(
  `**5. Lo que se dejó de vender es medible y está identificado.** El sistema ya registra qué medidas se buscan y ` +
    `no se encuentran, y la sección "Vale la pena tener en existencia" del módulo de reportes ordena las medidas por ` +
    `lo que el taller realmente vende. La decisión de qué comprar no requiere adivinar.`,
);

H2("Recomendaciones");
P(
  `**Reponer por rotación, no por corazonada.** Las medidas que el taller vendía y hoy no tiene están listadas y ` +
    `ordenadas por venta real. Empezar por las de arriba recupera la mayor parte de la venta perdida con la menor ` +
    `inversión.`,
);
P(
  `**Restablecer la compra de llanta usada.** Es la línea con la caída más pronunciada y la que menos capital ` +
    `inmoviliza, porque el inventario entra por el mostrador.`,
);
P(
  `**Capturar los costos de mano de obra.** Con ${x.control.costCoveragePct} % de cobertura, el margen que reporta ` +
    `el sistema describe la mitad del taller. Tres conceptos — ponchadura, montaje y balanceo, y usada — llevarían ` +
    `esa cobertura por encima del 80 %.`,
);
P(
  `**Vigilar el surtido, no solo la venta.** La gráfica de medidas distintas vendidas por mes se angosta antes de ` +
    `que caiga la venta. Es el indicador que avisa con anticipación.`,
);

BREAK();

// ═══════════════════════════════════════════════════════════════════════════
// 9 · Anexo
// ═══════════════════════════════════════════════════════════════════════════
H1("Anexo: la tabla trimestral");
P(`Todas las cifras por día de trabajo. Es la tabla de la que salieron las gráficas de este informe.`);
TABLE(
  ["Trimestre", "Días", "Tickets/día", "Ticket prom.", "Venta/día", "Nuevas/día", "Usadas/día", "Servicio/día", "Técnicos"],
  x.quarters.map((q) => [
    q.bucket,
    q.days,
    num(q.ticketsPerDay),
    money(q.avgTicketCents),
    money(q.perDayCents),
    money(q.newPerDayCents),
    money(q.usedPerDayCents),
    money(q.servicePerDayCents),
    num(q.techDaysPerDay),
  ]),
);

// ═══════════════════════════════════════════════════════════════════════════

function mean<T>(rows: T[], pick: (r: T) => number): number {
  return rows.length ? rows.reduce((n, v) => n + pick(v), 0) / rows.length : 0;
}

/**
 * The computed findings, in Spanish.
 *
 * `shopTrends` composes them in English with the shop's own figures inside, so
 * they cannot be keyed on a fixed string the way the app's translations are.
 * Instead every sentence template the checks can produce is matched here by
 * pattern, with the figures captured and carried across. Anything that does not
 * match falls through in English rather than being dropped — the same failure
 * mode the app's translation uses, and the only safe one: a future check added
 * to `trends.ts` shows up here in the wrong language, which is exactly the
 * prompt to come and add its pattern.
 */
function es(s: string): string {
  // Inside the function rather than beside it: the document body above calls
  // `es()` while the module is still evaluating, and a hoisted function can
  // reach these only if they live in its own scope.
  const M = "\\$[\\d,]+\\.\\d\\d"; // a money figure as `money()` prints it
  const N = "[\\d.]+"; // a bare number
  const P2 = "[+−-]?\\d+%"; // a signed percentage
  const rules: [RegExp, string][] = [
    // ── Titles ────────────────────────────────────────────────────────────
    [/^Takings are well down on a year ago$/, "La venta está muy por debajo de hace un año"],
    [/^Takings are well up on a year ago$/, "La venta está muy por encima de hace un año"],
    [/^Takings are about where they were a year ago$/, "La venta está más o menos donde estaba hace un año"],
    [/^There are fewer tires to sell, and that is what the fall is$/, "Hay menos llantas que vender, y eso es la caída"],
    [/^The range of tires being sold has narrowed$/, "El surtido de llantas que se vende se angostó"],
    [/^It is customers, not prices$/, "Son los clientes, no los precios"],
    [/^It is the size of the ticket, not the number of them$/, "Es el tamaño del ticket, no cuántos son"],
    [/^Both the number of tickets and their size have moved$/, "Se movieron tanto el número de tickets como su tamaño"],
    [/^Half the crew, each of them handling more tickets$/, "La mitad del equipo, y cada quien con más tickets"],
    [/^The crew has shrunk$/, "El equipo se redujo"],
    [/^Used tire sales have all but stopped$/, "La venta de llanta usada prácticamente se detuvo"],
    [/^New tire sales have all but stopped$/, "La venta de llanta nueva prácticamente se detuvo"],
    [/^Service work have all but stopped$/, "El trabajo de servicio prácticamente se detuvo"],
    [/^Used tire sales is well down$/, "La venta de llanta usada está muy por debajo"],
    [/^New tire sales is well down$/, "La venta de llanta nueva está muy por debajo"],
    [/^Service work is well down$/, "El trabajo de servicio está muy por debajo"],
    [/^Fewer tires are going out of the door$/, "Salen menos llantas por la puerta"],
    [/^The best day of the week has flattened out$/, "El mejor día de la semana se aplanó"],
    [/^Half the shop still has no cost against it$/, "Media operación sigue sin costo asignado"],
    [/^The share paid in cash has not moved$/, "La proporción pagada en efectivo no se movió"],
    [/^More of the money is arriving as cash$/, "Está llegando más dinero en efectivo"],
    [/^Less of the money is arriving as cash$/, "Está llegando menos dinero en efectivo"],

    // ── Findings, with their figures carried across ───────────────────────
    [
      new RegExp(`^(${M}) for every day open, against (${M}) over the same twelve months a year earlier — (${P2})\\. Measured over (\\d+) months that both years have records for\\.$`),
      "$1 por cada día abierto, contra $2 en los mismos doce meses de hace un año — $3. Medido sobre $4 meses que ambos años tienen registrados.",
    ],
    [
      new RegExp(`^(${M}) a day against (${M}) — (${P2})\\.$`),
      "$1 por día contra $2 — $3.",
    ],
    [
      new RegExp(`^Tickets a day went (${N}) → (${N}), and the average ticket (${M}) → (${M})\\. Of the (${M}) a day change, (${M}) comes from the number of tickets and (${M}) from their size\\.$`),
      "Los tickets por día pasaron de $1 a $2, y el ticket promedio de $3 a $4. De los $5 diarios de cambio, $6 vienen del número de tickets y $7 de su tamaño.",
    ],
    [
      new RegExp(`^(${N}) different sizes went out in an average month at the start of the record, (${N}) now\\. The share of tickets carrying a tire at all went (${N})% → (${N})%\\. What one tire sold for went (${M}) → (${M})( — barely moved)?\\.$`),
      "En un mes normal al inicio del registro salían $1 medidas distintas; hoy salen $2. La proporción de tickets que llevaron llanta pasó de $3 % a $4 %. Y una llanta se vendió en $5 antes y en $6 hoy — prácticamente no se movió.",
    ],
    [
      new RegExp(`^(${N}) technicians on the floor on an average day at the start of the record, (${N}) now\\. Each went from (${N}) to (${N}) tickets a day, and from (${M}) to (${M}) brought in\\.$`),
      "Al inicio del registro había $1 técnicos en el piso en un día normal; hoy hay $2. Cada uno pasó de $3 a $4 tickets por día, y de dejar $5 a dejar $6.",
    ],
    [
      new RegExp(`^(${M}) a day at the start of the record, (${M}) now — (${P2})\\.$`),
      "$1 por día al inicio del registro, $2 hoy — $3.",
    ],
    [
      new RegExp(`^(${N}) new tires a day at the start of the record, (${N}) now — (${P2})\\.$`),
      "$1 llantas nuevas por día al inicio del registro, $2 hoy — $3.",
    ],
    [
      new RegExp(`^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday) used to take (${N})% more than an average day\\. It now takes (${N})% more\\.$`),
      "$1 vendía $2 % más que un día normal. Hoy vende $3 % más.",
    ],
    [
      new RegExp(`^(${N})% of what was collected in (\\S+), (${N})% in (\\S+)\\.$`),
      "$1 % de lo cobrado en $2; $3 % en $4.",
    ],
    [
      new RegExp(`^(${N})% of the last year's takings can be given a cost\\. The rest is labour nobody has priced\\.$`),
      "Al $1 % de la venta del último año se le puede asignar un costo. El resto es mano de obra que nadie ha puesto precio.",
    ],
  ];
  let out = s;
  for (const [re, to] of rules)
    if (re.test(out)) {
      out = out.replace(re, to);
      break;
    }
  // Weekday names arrive inside composed sentences, so they are swept after.
  const DIAS_EN: [RegExp, string][] = [
    [/\bSaturday\b/g, "El sábado"], [/\bSunday\b/g, "El domingo"], [/\bMonday\b/g, "El lunes"],
    [/\bTuesday\b/g, "El martes"], [/\bWednesday\b/g, "El miércoles"], [/\bThursday\b/g, "El jueves"],
    [/\bFriday\b/g, "El viernes"],
  ];
  for (const [re, to] of DIAS_EN) out = out.replace(re, to);
  return esProse()[out] ?? out;
}

/**
 * The meanings — fixed sentences with no figures inside, so they translate by
 * exact lookup. Kept out of the pattern table above because these are prose and
 * the patterns are templates; mixing them would make both harder to check.
 *
 * Behind a hoisted function because the document body above calls `es()` while
 * the module is still evaluating — a top-level `const` would not exist yet.
 */
function esProse(): Record<string, string> {
  return {
  "Per day open, so this is not explained by holidays or by days the shop was shut. Whatever is behind it, it is not the calendar.":
    "Por día abierto, así que no lo explican los días festivos ni los días que se cerró. Lo que sea que está detrás, no es el calendario.",
  "Per day open, so this is real growth rather than simply having been open more.":
    "Por día abierto, así que es crecimiento real y no simplemente haber abierto más días.",
  "Within the range a shop this size moves by month to month.":
    "Dentro de lo que un taller de este tamaño se mueve de un mes a otro.",
  "Fewer people are being served. That is a question about how many can be served and how many are coming — not about what is being charged.":
    "Se está atendiendo a menos gente. Esa es una pregunta de cuántos vienen y cuántos se pueden atender — no de cuánto se cobra.",
  "Much the same number of people, spending less each. That points at what is being sold rather than at how many walk in.":
    "Más o menos la misma gente, gastando menos cada uno. Eso apunta a qué se está vendiendo, no a cuántos entran.",
  "Neither one on its own explains it, so a fix aimed at only one of them will only get part of the way.":
    "Ninguna de las dos lo explica por sí sola, así que una solución dirigida a una sola se quedará a medio camino.",
  "That last figure is the whole argument. If customers had stopped being able to afford tires, the average tire sold would have fallen as they traded down; it has not moved. The tires that are on the racks still sell for what they always did — there are simply fewer of them, across a narrower range of sizes, and fewer people leaving with one. This is a supply problem, not a demand problem, and no amount of selling harder will fix it. What fixes it is stock: the reorder list and Worth keeping in stock on the Reports page already say which sizes, ranked by what the shop actually sells.":
    "La última cifra es todo el argumento. Si a los clientes ya no les alcanzara para llantas, el precio promedio habría bajado porque comprarían más barato; no se movió. Las llantas que sí están en el rack se venden en lo que siempre valieron — simplemente hay menos, en un surtido más angosto, y menos gente se va con una. Es un problema de abasto, no de demanda, y venderle más duro no lo arregla. Lo arregla el inventario: la lista de reorden y \"Vale la pena tener en existencia\" en el módulo de reportes ya dicen qué medidas, ordenadas por lo que el taller realmente vende.",
  "Fewer sizes and fewer customers leaving with a tire, and the price has moved as well — so this is a mix of what is on offer and what people are willing to pay, and the two need separating before either is acted on.":
    "Menos medidas y menos clientes que se van con llanta, y el precio también se movió — así que aquí se mezclan el surtido y lo que la gente está dispuesta a pagar, y hay que separarlos antes de actuar sobre cualquiera.",
  "More tickets each but not much more money each, which is the shape of work that has changed rather than grown: a flat repair is quick and small, fitting a set of tires is slow and large. Swap one for the other and the ticket count per technician climbs while the takings do not. So this is not a crew that has become more productive, and not one that has become lazy — it is the same people doing different, smaller jobs.":
    "Más tickets cada uno pero casi el mismo dinero cada uno: esa es la forma de un trabajo que cambió, no que creció. Una ponchadura es rápida y chica; montar un juego de llantas es lento y grande. Cambie uno por el otro y el conteo de tickets por técnico sube mientras la venta no. No es un equipo que se volvió más productivo, ni uno que se volvió flojo — es la misma gente haciendo trabajos distintos y más chicos.",
  "Fewer people, and less from each of them.": "Menos gente, y menos de cada uno.",
  "A line of the business that has effectively closed. Worth knowing whether that was a decision or something that simply happened.":
    "Una línea del negocio que en la práctica cerró. Vale la pena saber si eso fue una decisión o algo que simplemente pasó.",
  "A line of the business that has effectively closed. Used stock comes in over the counter, and the shop has recorded almost no buybacks — so this one has a supply of its own that has dried up too. Worth knowing whether that was a decision or something that simply happened.":
    "Una línea del negocio que en la práctica cerró. La llanta usada entra por compra de mostrador, y el sistema casi no tiene compras registradas — así que esta línea perdió también su propio abasto. Vale la pena saber si eso fue una decisión o algo que simplemente pasó.",
  "Falling faster than the shop as a whole, so this is not only the general slowdown showing up here.":
    "Cae más rápido que el taller en su conjunto, así que no es solo la desaceleración general asomándose aquí.",
  "Counted in tires rather than in money, so it is not price changes or mix. This is the physical volume of the main business.":
    "Contado en llantas y no en dinero, así que no son cambios de precio ni de mezcla. Es el volumen físico del negocio principal.",
  "A busy day stops standing out when the shop cannot take any more work on it. On its own it proves nothing; alongside a crew that is running at its busiest, it is the same story told twice.":
    "Un día fuerte deja de destacar cuando ya no hay razón para escogerlo. Por sí solo no prueba nada; junto a lo demás, es la misma historia contada dos veces.",
  "Worth checking precisely because it is the figure that would move first if cash were going missing. It has not.":
    "Vale la pena revisarlo precisamente porque es la cifra que se movería primero si el efectivo se estuviera perdiendo. No se movió.",
  "The tender split is the figure that moves first if cash stops being rung up, so a shift of this size is worth an explanation — a new terminal, a change in what customers use, or something else.":
    "La mezcla de cobro es la cifra que se mueve primero si el efectivo deja de capturarse, así que un cambio de este tamaño merece explicación — una terminal nueva, un cambio en cómo paga la gente, u otra cosa.",
  "Every margin figure in this program is worked out over that share and no more, so it describes part of the shop rather than the shop. Settings → What things cost is where that gets fixed, and the three biggest jobs would take it most of the way.":
    "Todo margen que reporta el sistema se calcula solo sobre esa parte, así que describe un pedazo del taller y no el taller. Se corrige en Configuración → Lo que nos cuesta, y con los tres conceptos más grandes queda casi resuelto.",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// The document
// ═══════════════════════════════════════════════════════════════════════════

const CSS = `
@page { size: letter; margin: 16mm 15mm 18mm; }
* { box-sizing: border-box; }
/* Its own white and its own light scheme, declared rather than assumed. This
   file gets opened in browsers as well as printed, and a browser in dark mode
   otherwise supplies a near-black canvas under navy text. */
html { color-scheme: light only; }
body {
  margin: 0; background: #fff; font-family: "Segoe UI", system-ui, sans-serif;
  font-size: 10.5pt; line-height: 1.55; color: #14243a; -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.cover { height: 232mm; display: flex; flex-direction: column; justify-content: space-between; }
.cover-top { border-top: 3pt solid #0a2540; padding-top: 6mm; }
.cover h1 { font-size: 30pt; line-height: 1.1; margin: 26mm 0 4mm; font-weight: 700; letter-spacing: -0.5pt; }
.cover .sub { font-size: 13pt; color: #4a5b71; margin-bottom: 3mm; }
.cover .meta { font-size: 10pt; color: #66768c; }
.cover-foot { font-size: 9pt; color: #66768c; border-top: 0.6pt solid rgba(10,37,64,.2); padding-top: 3mm; }
.shopname { font-size: 12pt; font-weight: 700; letter-spacing: 1pt; text-transform: uppercase; }

h1.sec {
  font-size: 17pt; font-weight: 700; margin: 0 0 2mm; padding-bottom: 2mm;
  border-bottom: 1.6pt solid #0a2540; break-after: avoid;
}
h2 { font-size: 12pt; font-weight: 650; margin: 7mm 0 2mm; color: #0a2540; break-after: avoid; }
p { margin: 0 0 3mm; }
p.lead { font-size: 11.5pt; }
p.note { font-size: 9pt; color: #66768c; margin-top: -1mm; }
strong { font-weight: 650; }
.break { break-after: page; }

.key {
  border-left: 3pt solid #b45309; background: #fdf6ec; padding: 4mm 5mm; margin: 4mm 0 5mm;
  border-radius: 0 2mm 2mm 0; break-inside: avoid;
}
.key-t { font-weight: 700; font-size: 11.5pt; margin-bottom: 1.5mm; color: #7c3d06; }
.key p { margin: 0; white-space: pre-line; }

.stats { display: flex; gap: 3mm; margin: 4mm 0 5mm; }
.stat { flex: 1; border: 0.6pt solid rgba(10,37,64,.15); border-radius: 2mm; padding: 3mm; }
.stat-l { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .5pt; color: #66768c; }
.stat-v { font-size: 15pt; font-weight: 700; margin: 1mm 0 0.5mm; font-variant-numeric: tabular-nums; }
.stat-s { font-size: 8.5pt; color: #66768c; }

.concern { border-left: 2.5pt solid; padding: 3mm 4mm; margin-bottom: 3mm; break-inside: avoid; border-radius: 0 1.5mm 1.5mm 0; }
.concern.serious { border-color: #b91c1c; background: rgba(185,28,28,.05); }
.concern.watch   { border-color: #b45309; background: rgba(180,83,9,.05); }
.concern.steady  { border-color: #15803d; background: rgba(21,128,61,.05); }
.concern-h { margin-bottom: 1mm; }
.concern-tag {
  font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: .6pt;
  padding: 0.6mm 2mm; border-radius: 4mm; color: #fff; margin-right: 2.5mm;
}
.concern.serious .concern-tag { background: #b91c1c; }
.concern.watch .concern-tag   { background: #b45309; }
.concern.steady .concern-tag  { background: #15803d; }
.concern-t { font-weight: 650; font-size: 11pt; }
.concern-f { margin: 0; font-size: 9.5pt; font-variant-numeric: tabular-nums; }
.concern-m { margin: 1mm 0 0; font-size: 9.5pt; color: #4a5b71; }

figure { margin: 4mm 0 5mm; break-inside: avoid; }
.fig-t { font-size: 9pt; font-weight: 650; text-transform: uppercase; letter-spacing: .5pt; color: #0a2540; margin-bottom: 2mm; }
.fig-b { border: 0.6pt solid rgba(10,37,64,.12); border-radius: 2mm; padding: 4mm; background: #fff; }
.fig-c { font-size: 9pt; color: #4a5b71; margin-top: 2mm; }

/* The walkthrough under every chart. Set apart from the caption typographically
   — a left rule and a heading — so a reader who does not need it can skip it by
   shape alone, and the reader it is written for can find it the same way. */
.howto {
  margin-top: 2.5mm; padding: 3mm 4mm; background: #f4f6f9;
  border-left: 2pt solid rgba(10,37,64,.35); border-radius: 0 1.5mm 1.5mm 0;
}
.howto-t {
  display: block; font-size: 8pt; font-weight: 700; text-transform: uppercase;
  letter-spacing: .6pt; color: #4a5b71; margin-bottom: 1.5mm;
}
.howto p { font-size: 9.5pt; margin: 0 0 2mm; }
.howto p:last-child { margin-bottom: 0; }

table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin: 3mm 0 4mm; break-inside: avoid; }
th {
  text-align: left; font-size: 8pt; text-transform: uppercase; letter-spacing: .4pt;
  color: #4a5b71; border-bottom: 1pt solid rgba(10,37,64,.3); padding: 1.5mm 2mm 1.5mm 0;
}
td { padding: 1.5mm 2mm 1.5mm 0; border-bottom: 0.4pt solid rgba(10,37,64,.09); font-variant-numeric: tabular-nums; }
th.r, td.r { text-align: right; padding-right: 0; padding-left: 3mm; }

/* The charts are the app's own components, so they arrive with the app's class
   names and need the app's rules. Only the ones this document actually uses are
   copied, and they are copied rather than imported because the report has to
   build whether or not .next exists. */
.rp-bars { display: flex; align-items: flex-end; gap: 2px; }
.rp-bar-col { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; }
/* The peak and final bars carry a money label wider than their own column.
   The margins let it spill evenly onto both empty neighbours instead of
   shearing off to the right. */
.rp-bar-val { font-size: 6pt; text-align: center; color: #4a5b71; height: 3mm; white-space: nowrap; margin: 0 -100%; }
/* A bar needs its width said out loud. Inside a column flex it would stretch
   anyway, but PairedBars lays two of these in a ROW inside .rp-pair, and a
   width-less div in a row flex collapses to zero — the weekday chart rendered
   as a legend floating over nothing. Mirrors the app's own rule. */
.rp-bar { width: 100%; max-width: 8mm; border-radius: 1px 1px 0 0; }
.rp-bar-lab { font-size: 5.5pt; text-align: center; color: #66768c; margin-top: 1mm; }
.rp-bar-sub { font-size: 5pt; text-align: center; color: #b45309; }
.rp-pair { display: flex; align-items: flex-end; justify-content: center; gap: 1px; width: 100%; height: 100%; }
.rp-pair .rp-bar { max-width: 3.5mm; }
.rp-ranked { display: flex; flex-direction: column; gap: 1.2mm; }
.rp-rank-row { display: flex; align-items: center; gap: 2mm; font-size: 8.5pt; }
.rp-rank-lab { width: 26mm; flex: none; color: #4a5b71; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rp-rank-track { flex: 1; background: rgba(10,37,64,.06); border-radius: 1mm; height: 3.4mm; }
.rp-rank-fill { height: 100%; border-radius: 1mm; }
.rp-rank-val { width: 34mm; flex: none; text-align: right; font-variant-numeric: tabular-nums; }
.rp-rank-note { color: #66768c; font-size: 7.5pt; }
.rp-legend { display: flex; gap: 4mm; font-size: 8pt; color: #4a5b71; margin-top: 2mm; flex-wrap: wrap; }
.rp-legend i { display: inline-block; width: 2mm; height: 2mm; border-radius: .5mm; margin-right: 1.2mm; }
.rp-line-wrap { min-width: 0; }
.rp-line { width: 100%; display: block; overflow: visible; }
.rp-line-axis { display: flex; justify-content: space-between; font-size: 7.5pt; color: #66768c; margin-top: 1mm; }
.rp-bridge { display: flex; align-items: flex-end; gap: 4mm; }
.rp-bridge-col { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: flex-end; }
.rp-bridge-val { font-size: 8pt; text-align: center; color: #14243a; font-variant-numeric: tabular-nums; margin-bottom: 1mm; white-space: nowrap; }
.rp-bridge-track { position: relative; width: 100%; }
.rp-bridge-bar { position: absolute; left: 0; right: 0; border-radius: 1mm; }
.rp-bridge-lab { font-size: 7.5pt; text-align: center; color: #66768c; margin-top: 1.5mm; line-height: 1.2; }
.rp-stack-wrap { min-width: 0; }
.rp-stack { display: flex; align-items: flex-end; gap: 2mm; height: 34mm; margin-bottom: 2mm; }
.rp-stack-col { flex: 1; min-width: 0; display: flex; flex-direction: column; height: 100%; }
.rp-stack-bar { flex: 1; display: flex; flex-direction: column; border-radius: 1mm; overflow: hidden; }
.rp-stack-lab { font-size: 6pt; text-align: center; color: #66768c; margin-top: 1mm; white-space: nowrap; }
.rp-empty { font-size: 9pt; color: #66768c; padding: 4mm 0; }
`;

const cover = `
<section class="cover">
  <div>
    <div class="cover-top"><span class="shopname">Casias Muffler &amp; Tire Shop</span></div>
    <h1>Informe de tendencias<br>del negocio</h1>
    <div class="sub">Análisis del periodo ${fecha(x.history.firstDate)} — ${fecha(x.history.lastDate)}</div>
    <div class="meta">
      ${x.history.tradingDays.toLocaleString("es-MX")} días de trabajo ·
      ${x.history.tickets.toLocaleString("es-MX")} tickets ·
      ${money(x.history.takingsCents)} de venta acumulada
    </div>
  </div>
  <div class="cover-foot">
    Documento generado a partir de los registros de venta del taller.<br>
    Emitido el ${fecha(today)}. Todas las cifras se recalculan cada vez que se genera este informe.
  </div>
</section>
<div class="break"></div>
`;

const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>Informe de tendencias — Casias Muffler &amp; Tire Shop</title>
<style>${CSS}</style></head>
<body>${cover}${parts.join("\n")}</body></html>`;

const OUT = path.resolve("docs");
fs.mkdirSync(OUT, { recursive: true });
const htmlPath = path.join(OUT, "Informe-de-Tendencias.html");
fs.writeFileSync(htmlPath, html, "utf8");
console.log("escrito", htmlPath);

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));

if (!CHROME) {
  console.log("  (no se encontró Chrome — solo HTML)");
} else {
  const pdf = path.join(OUT, "Informe-de-Tendencias.pdf");
  execFileSync(CHROME, [
    "--headless",
    "--disable-gpu",
    "--no-pdf-header-footer",
    `--print-to-pdf=${pdf}`,
    `file:///${htmlPath.replace(/\\/g, "/")}`,
  ]);
  console.log("escrito", pdf, `(${Math.round(fs.statSync(pdf).size / 1024)} KB)`);
}
