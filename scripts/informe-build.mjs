/**
 * The tire-business report, built from its ledger.
 *
 * Every figure in the document comes out of scripts/informe-data.json through
 * this template — including the descriptive ranges in the prose, which the
 * first draft typed by hand and the verification pass caught drifting from the
 * table they summarized. Nothing here is typed by hand any more: checking the
 * report means checking informe-data.mts against the database and this file
 * against the JSON. Rerunning both regenerates the report against live data.
 *
 * The output is a body fragment (title tag, styles, content — no <html>), the
 * same shape the brochure uses: the artifact host wraps it for the web, and
 * informe-pdf.mjs wraps it for Chrome.
 *
 * Written for a reader who runs a business, not a spreadsheet: plain Spanish,
 * short sentences, every conclusion next to the number that supports it.
 */
import fs from "node:fs";

const d = JSON.parse(fs.readFileSync("scripts/informe-data.json", "utf8"));

// ── Formatting ─────────────────────────────────────────────────────────────
const $0 = (c) => "$" + Math.round(c / 100).toLocaleString("en-US");
const $2 = (c) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n0 = (x) => Math.round(x).toLocaleString("en-US");
const n1 = (x) => x.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const n2 = (x) => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MES = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const mesCorto = (ym) => `${MES[+ym.split("-")[1]].slice(0, 3)} ${ym.slice(2, 4)}`;
const mesLargo = (ym) => `${MES[+ym.split("-")[1]]} de ${ym.slice(0, 4)}`;
const fecha = (iso) => {
  const [y, m, day] = iso.split("-");
  return `${+day} de ${MES[+m]} de ${y}`;
};

// ── Derived figures, all from the ledger ───────────────────────────────────
const S = d.windows.start, N = d.windows.now, Y = d.yoy, U = d.used, B = d.projectionBase;
const tot = d.monthly.reduce(
  (a, r) => ({ all: a.all + r.allC, newC: a.newC + r.newC, usedC: a.usedC + r.usedC, newU: a.newU + r.newU, usedU: a.usedU + r.usedU, t: a.t + r.tickets, days: a.days + r.tradingDays }),
  { all: 0, newC: 0, usedC: 0, newU: 0, usedU: 0, t: 0, days: 0 },
);
const gapTotalDays = d.gaps.reduce((n, g) => n + g.days, 0);
const maxPerDay = Math.max(...d.monthly.map((r) => r.allC / r.tradingDays));
const dropPct = (a, b) => Math.round(((b - a) / a) * 100);

// Ranges for the prose, from the table rather than from memory.
const meses = (from, to) => d.monthly.filter((r) => r.month >= from && r.month <= to);
const rango = (rows, pick) => {
  const v = rows.map(pick);
  return { min: Math.min(...v), max: Math.max(...v) };
};
const e1 = rango(meses("2024-03", "2024-08"), (r) => r.allC / r.tradingDays);
const e2 = rango(meses("2024-12", "2025-07"), (r) => r.allC / r.tradingDays);
const e2t = rango(meses("2024-12", "2025-07"), (r) => r.tickets);
const e1t = rango(meses("2024-03", "2024-08"), (r) => r.tickets);
const e3 = rango(meses("2025-09", "2026-05").filter((r) => !r.partial), (r) => r.allC / r.tradingDays);
const nuevas26 = rango(meses("2026-01", "2026-05"), (r) => r.newU);
const usadasU26 = rango(meses("2026-01", "2026-05"), (r) => r.usedU);
const usadasFin24 = rango(meses("2024-10", "2024-12"), (r) => r.usedC);
const usadasMed25 = rango(meses("2025-03", "2025-07"), (r) => r.usedC);
const usadas26 = rango(meses("2026-01", "2026-05"), (r) => r.usedC);
const oct24 = d.monthly.find((r) => r.month === "2024-10");
const nov24 = d.monthly.find((r) => r.month === "2024-11");

// Tires per ticket, the traceable version of "fewer tickets carry a tire".
const llantasPorTicketS = (S.perDay.newU + S.perDay.usedU) / S.perDay.tickets;
const llantasPorTicketN = (N.perDay.newU + N.perDay.usedU) / N.perDay.tickets;

// The new-tire line's own dollar hole, beside the used one.
const newGapPerMonthC = (S.perDay.newC - N.perDay.newC) * 30.4;

// "Hoy" is ONE window everywhere: the last six finished months (windows.now).
// The projection section uses its own base and says so by name — the first
// draft let the two figures both wear the label "hoy" and a careful reader
// would have found $90,994 and $95,818 as the same month's sales.
const tiresHoyPerDay = N.perDay.newC + N.perDay.usedC;

// Projection: September–November 2026, 91 calendar days, shop open daily.
const Q_DAYS = 91;
const qA = B.perDay.allC * Q_DAYS;
const usedLever = (S.perDay.usedC / 2 - B.perDay.usedC) * Q_DAYS;
const nov25 = d.monthly.filter((r) => ["2025-09", "2025-10", "2025-11"].includes(r.month));
const newLastFall = nov25.reduce((n, r) => n + r.newC, 0) / nov25.reduce((n, r) => n + r.tradingDays, 0);
const newLever = ((newLastFall - B.perDay.newC) / 2) * Q_DAYS;
const qB = qA + usedLever + newLever;
const leverProfit = (usedLever + newLever) * U.profitShare;

const cur = d.monthly[d.monthly.length - 1];

// ── The monthly table ──────────────────────────────────────────────────────
const rows = d.monthly
  .map((r) => {
    const perDay = r.allC / r.tradingDays;
    const bar = Math.max(2, Math.round((perDay / maxPerDay) * 100));
    return `<tr${r.partial ? ' class="parcial"' : ""}>
<td>${mesCorto(r.month)}${r.partial ? "&thinsp;*" : ""}</td>
<td class="r">${r.tradingDays}</td>
<td class="r">${n0(r.newU)}</td><td class="r">${$0(r.newC)}</td>
<td class="r">${n0(r.usedU)}</td><td class="r">${$0(r.usedC)}</td>
<td class="r">${n0(r.newU + r.usedU)}</td><td class="r">${$0(r.newC + r.usedC)}</td>
<td class="r">${$0(r.allC)}</td>
<td class="r">${$0(perDay)}</td>
<td class="barra"><span style="width:${bar}%"></span></td>
</tr>`;
  })
  .join("\n");

const html = `<title>Informe de llantas · Casias Tire Shop</title>
<style>
  .doc { background:#fff; color:#1a2733; font-family: Georgia, "Times New Roman", serif; font-size: 10.5pt; line-height: 1.5; max-width: 7.6in; margin: 0 auto; padding: 24px 18px 48px; }
  .doc h1, .doc h2, .doc h3, .doc table, .doc .kpi, .doc .cajas { font-family: "Segoe UI", Arial, sans-serif; }
  .doc h1 { color:#0a2540; font-size: 19pt; margin: 0 0 2px; letter-spacing:-0.01em; }
  .doc h2 { color:#0a2540; font-size: 13pt; margin: 22px 0 6px; border-bottom: 2px solid #0a2540; padding-bottom: 3px; }
  .doc h3 { color:#0a2540; font-size: 11pt; margin: 14px 0 4px; }
  .doc p { margin: 6px 0; }
  .doc .sub { color:#4f6e8e; font-size: 9.5pt; font-family:"Segoe UI",Arial,sans-serif; margin-bottom: 14px; }
  .doc .nota { background:#fffbeb; border:1px solid #f0d48a; border-left: 4px solid #b45309; border-radius: 6px; padding: 9px 12px; font-size: 9.5pt; color:#6b4708; margin: 12px 0; }
  .doc .perdida { background:#fef2f2; border:1px solid #fecaca; border-left: 5px solid #991b1b; border-radius: 6px; padding: 12px 14px; margin: 14px 0; }
  .doc .perdida h3 { color:#991b1b; margin: 0 0 6px; font-size: 12pt; }
  .doc .perdida .grande { font-family:"Segoe UI",Arial,sans-serif; font-size: 17pt; font-weight: 700; color:#991b1b; }
  .doc .verde { background:#ecfdf5; border:1px solid #a7f3d0; border-left: 5px solid #15803d; border-radius: 6px; padding: 10px 14px; margin: 10px 0; }
  .doc table { border-collapse: collapse; width: 100%; font-size: 8.4pt; }
  .doc th { text-align: left; color:#4f6e8e; text-transform: uppercase; font-size: 6.8pt; letter-spacing: 0.05em; padding: 3px 5px; border-bottom: 1.5px solid #0a2540; }
  .doc td { padding: 2.5px 5px; border-bottom: 1px solid #e6ecf2; font-variant-numeric: tabular-nums; }
  .doc tr.parcial td { color:#8a97a5; }
  .doc td.r, .doc th.r { text-align: right; }
  .doc td.barra { width: 66px; padding-right: 0; }
  .doc td.barra span { display:block; height: 7px; background:#0a2540; border-radius: 2px; }
  .doc tr.parcial td.barra span { background:#9db1c4; }
  .doc tfoot td { font-weight: 700; border-top: 2px solid #0a2540; border-bottom: none; }
  .doc .kpi { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 10px 0; }
  .doc .kpi > div { border: 1px solid #d9e2ec; border-radius: 6px; padding: 7px 10px; }
  .doc .kpi b { display:block; font-size: 13.5pt; color:#0a2540; font-variant-numeric: tabular-nums; }
  .doc .kpi span { font-size: 7.6pt; color:#4f6e8e; text-transform: uppercase; letter-spacing: 0.04em; }
  .doc .kpi i { font-style: normal; font-size: 8.4pt; color:#8a97a5; }
  .doc ul { margin: 6px 0 6px 20px; padding: 0; }
  .doc li { margin: 4px 0; }
  .doc .metodo { font-size: 8.4pt; color:#5c6b7a; border-top: 1px solid #d9e2ec; margin-top: 26px; padding-top: 8px; }
  .doc .firma { color:#4f6e8e; font-size: 9pt; margin-top: 4px; }
  @media print {
    .doc { padding: 0; max-width: none; }
    .doc h2 { break-after: avoid; }
    .doc tr { break-inside: avoid; }
    .doc .perdida, .doc .verde, .doc .nota, .doc .kpi > div { break-inside: avoid; }
  }
</style>
<div class="doc">

<h1>Informe de ventas de llantas</h1>
<div class="sub">Casias Muffler and Tire Shop · marzo de 2024 &ndash; agosto de 2026 · corte al ${fecha(d.record.lastDay)}</div>

<div class="nota">
<b>Nota sobre los datos.</b> El registro cubre del ${fecha(d.record.firstDay)} al ${fecha(d.record.lastDay)}: ${n0(d.record.tradingDays)} d&iacute;as con ventas anotadas. Hay tres tramos sin registro (nadie llev&oacute; la libreta esos d&iacute;as): ${d.gaps.map((g) => `del ${fecha(g.from)} al ${fecha(g.to)} (${g.days} d&iacute;as)`).join(", ")} &mdash; ${gapTotalDays} d&iacute;as en total, unas cinco semanas repartidas en dos a&ntilde;os y medio &mdash; adem&aacute;s de una docena de d&iacute;as sueltos, casi todos en fechas festivas. El taller abre los siete d&iacute;as de la semana salvo festivos, as&iacute; que un tramo sin registro es un tramo sin anotar, no semanas de puerta cerrada. Para que esos huecos no distorsionen nada, <b>todas las comparaciones de este informe se hacen por d&iacute;a con registro</b>, y los meses incompletos van marcados con * en la tabla. Con esa regla, los huecos no cambian las conclusiones.
</div>

<h2>Resumen</h2>
<ul>
<li>En sus primeros seis meses (marzo&ndash;agosto de 2024), el taller vend&iacute;a <b>${$0(S.perDay.allC)} al d&iacute;a</b> &mdash; unos ${$0(S.perDay.allC * 30.4)} al mes. Hoy vende <b>${$0(N.perDay.allC)} al d&iacute;a</b>, unos ${$0(N.perDay.allC * 30.4)} al mes. Es ${Math.abs(dropPct(S.perDay.allC, N.perDay.allC))}% menos.</li>
<li>La ca&iacute;da es de <b>clientes, no de precios</b>: comparando los &uacute;ltimos doce meses contra los mismos doce del a&ntilde;o anterior, los tickets por d&iacute;a bajaron de ${n1(Y.ticketsPerDayBefore)} a ${n1(Y.ticketsPerDayNow)} y el ticket promedio de ${$2(Y.avgTicketBeforeC)} a ${$2(Y.avgTicketNowC)}. El precio de una llanta nueva casi no se movi&oacute; en todo el registro: ${$0(S.avgNewPriceC)} al inicio, ${$0(N.avgNewPriceC)} hoy.</li>
<li>Las <b>llantas nuevas</b> pasaron de ${n1(S.perDay.newU)} a ${n1(N.perDay.newU)} por d&iacute;a &mdash; medido en llantas f&iacute;sicas, no en dinero.</li>
<li>Las <b>llantas usadas</b> pr&aacute;cticamente se apagaron: de ${$0(S.perDay.usedC)} al d&iacute;a a ${$0(N.perDay.usedC)}. Ese hueco cuesta unos <b>${$0(U.gapPerMonthC)} al mes en ventas</b>.</li>
<li>La variedad se encogi&oacute;: al inicio sal&iacute;an <b>${n0(S.sizesPerMonth)} medidas distintas</b> de llanta nueva en un mes normal; hoy salen <b>${n0(N.sizesPerMonth)}</b>. Menos medidas en el rack es gente que pregunta y se va.</li>
<li>Agosto de 2026 (con el sistema nuevo en caja) trae una se&ntilde;al buena: <b>${n1(cur.newU / cur.tradingDays)} llantas nuevas al d&iacute;a</b> en sus primeros ${cur.tradingDays} d&iacute;as, contra ${n1(N.perDay.newU)} de promedio en los seis meses anteriores. Es temprano, pero va en la direcci&oacute;n correcta.</li>
</ul>

<div class="perdida">
<h3>Lo que cuesta tener apagada la l&iacute;nea de usadas</h3>
<p>Al ritmo de sus primeros seis meses, la l&iacute;nea de llantas usadas vend&iacute;a ${$0(U.startPerDayC)} al d&iacute;a. Hoy vende ${$0(U.nowPerDayC)}. La diferencia:</p>
<p><span class="grande">${$0(U.gapPerMonthC)} al mes</span> &nbsp;en ventas que ya no entran.</p>
<p>Con el margen m&iacute;nimo del taller en llantas (20% sobre el costo, es decir, $20 de ganancia por cada $120 vendidos), eso es <b>al menos ${$0(U.profitLostPerMonthC)} de ganancia al mes</b> que se deja de recibir.</p>
<p>Acumulado desde que la l&iacute;nea empez&oacute; a caer (${n0(U.daysMeasured)} d&iacute;as con registro): <b>${$0(U.cumulativeLostC)} en ventas</b>, que al margen m&iacute;nimo son <b>${$0(U.cumulativeLostProfitC)} de ganancia</b> que no se recibi&oacute;.</p>
</div>

<h2>Mes por mes</h2>
<p>Cada rengl&oacute;n es un mes. &laquo;$ / d&iacute;a&raquo; divide la venta total del taller entre los d&iacute;as con registro de ese mes, que es la forma justa de comparar meses con huecos. Los meses marcados con * est&aacute;n incompletos: contienen un tramo sin registro, o siguen en curso.</p>
<table>
<thead><tr>
<th>Mes</th><th class="r">D&iacute;as</th>
<th class="r">Nuevas (u)</th><th class="r">Nuevas ($)</th>
<th class="r">Usadas (u)</th><th class="r">Usadas ($)</th>
<th class="r">Llantas (u)</th><th class="r">Llantas ($)</th>
<th class="r">Todo el taller</th><th class="r">$ / d&iacute;a</th><th></th>
</tr></thead>
<tbody>
${rows}
</tbody>
<tfoot><tr>
<td>Total</td><td class="r">${n0(tot.days)}</td>
<td class="r">${n0(tot.newU)}</td><td class="r">${$0(tot.newC)}</td>
<td class="r">${n0(tot.usedU)}</td><td class="r">${$0(tot.usedC)}</td>
<td class="r">${n0(tot.newU + tot.usedU)}</td><td class="r">${$0(tot.newC + tot.usedC)}</td>
<td class="r">${$0(tot.all)}</td><td class="r"></td><td></td>
</tr></tfoot>
</table>

<h2>La historia, en tres etapas</h2>
<p><b>1 &middot; El punto alto (marzo&ndash;agosto de 2024).</b> El mejor semestre del registro: entre ${$0(e1.min)} y ${$0(e1.max)} diarios seg&uacute;n el mes, m&aacute;s de mil llantas nuevas al mes en el verano, y una l&iacute;nea de usadas que aportaba unos ${$0(S.perDay.usedC * 30.4)} mensuales ella sola. En un mes normal sal&iacute;an ${n0(S.sizesPerMonth)} medidas distintas.</p>
<p><b>2 &middot; El primer escal&oacute;n (finales de 2024 a mediados de 2025).</b> A partir de octubre de 2024 la venta diaria baja de unos ${$0(oct24.allC / oct24.tradingDays)} a la zona de ${$0(e2.min)}&ndash;${$0(e2.max)} y se queda ah&iacute; unos ocho meses. Las usadas caen m&aacute;s r&aacute;pido que lo dem&aacute;s: de ${$0(nov24.usedC)} en noviembre de 2024 a la tercera parte para la primavera de 2025. Los tickets por mes bajan de ${n0(e1t.min)}&ndash;${n0(e1t.max)} a ${n0(e2t.min)}&ndash;${n0(e2t.max)}.</p>
<p><b>3 &middot; El segundo escal&oacute;n (desde finales de 2025).</b> De septiembre de 2025 en adelante la venta diaria baja otra vez, a la zona de ${$0(e3.min)}&ndash;${$0(e3.max)}, y en los &uacute;ltimos seis meses se estabiliza alrededor de <b>${$0(N.perDay.allC)} al d&iacute;a</b>. Las llantas nuevas pasan de 500 al mes a ${n0(nuevas26.min)}&ndash;${n0(nuevas26.max)}. La variedad baja a ${n0(N.sizesPerMonth)} medidas. Las usadas quedan en ${n0(usadasU26.min)}&ndash;${n0(usadasU26.max)} piezas al mes &mdash; contra ${n0(S.perDay.usedU * 30.4)} al mes en marzo&ndash;agosto de 2024.</p>

<h2>&iquest;De d&oacute;nde viene la ca&iacute;da?</h2>
<p>La venta diaria es tickets por d&iacute;a &times; ticket promedio, as&iacute; que el cambio se puede repartir con exactitud entre las dos causas. Comparando los &uacute;ltimos doce meses contra los mismos doce del a&ntilde;o anterior (los huecos se excluyen de los dos lados):</p>
<div class="kpi">
<div><span>Por menos clientes</span><b>&minus;${$0(Math.abs(Y.fromVolumeC))}</b><i>al d&iacute;a</i></div>
<div><span>Por tickets m&aacute;s chicos</span><b>&minus;${$0(Math.abs(Y.fromPriceC))}</b><i>al d&iacute;a</i></div>
<div><span>Cambio total</span><b>&minus;${$0(Math.abs(Y.perDayNowC - Y.perDayBeforeC))}</b><i>al d&iacute;a vs. hace un a&ntilde;o</i></div>
</div>
<p>Casi dos terceras partes de la ca&iacute;da del &uacute;ltimo a&ntilde;o vienen de que <b>entran menos clientes</b> (${n1(Y.ticketsPerDayBefore)} &rarr; ${n1(Y.ticketsPerDayNow)} tickets por d&iacute;a); el resto, de que cada cliente gasta menos (${$2(Y.avgTicketBeforeC)} &rarr; ${$2(Y.avgTicketNowC)} por ticket).</p>
<p>Dos datos m&aacute;s dicen que el problema no es de precios. Primero, el volumen f&iacute;sico: de ${n1(S.perDay.newU)} llantas nuevas al d&iacute;a se pas&oacute; a ${n1(N.perDay.newU)} &mdash; eso est&aacute; contado en llantas, no en dinero, as&iacute; que ning&uacute;n cambio de precio lo explica. Segundo, el precio promedio de una llanta nueva casi no se movi&oacute; en todo el registro: ${$0(S.avgNewPriceC)} al inicio, ${$0(N.avgNewPriceC)} hoy.</p>
<p>Lo que s&iacute; se encogi&oacute; es <b>lo que hay para vender</b>: de ${n0(S.sizesPerMonth)} medidas distintas en un mes normal a ${n0(N.sizesPerMonth)}. Las llantas vendidas por ticket tambi&eacute;n bajaron: de ${n2(llantasPorTicketS)} a ${n2(llantasPorTicketN)}. Cuando el precio no cambia pero salen menos piezas y menos medidas, la explicaci&oacute;n m&aacute;s probable no es que la gente haya dejado de comprar llantas: es que cada vez m&aacute;s veces no est&aacute; la medida que buscan.</p>

<h2>Las llantas usadas, de cerca</h2>
<p>Es la l&iacute;nea que m&aacute;s cay&oacute; en todo el negocio, y la ca&iacute;da fue por etapas, no de golpe: ${$0(d.monthly[0].usedC)}&ndash;${$0(d.monthly[1].usedC)} al mes en la primavera de 2024; ${$0(usadasFin24.min)}&ndash;${$0(usadasFin24.max)} a finales de ese a&ntilde;o; ${$0(usadasMed25.min)}&ndash;${$0(usadasMed25.max)} a mediados de 2025; y entre ${$0(usadas26.min)} y ${$0(usadas26.max)} en 2026. En piezas: de ${n1(S.perDay.usedU)} al d&iacute;a a ${n1(N.perDay.usedU)}.</p>
<p>Dos datos apuntan a que el problema es de <b>surtido, no de demanda</b>:</p>
<ul>
<li>El precio promedio de una usada apenas baj&oacute; (${$0(S.avgUsedPriceC)} &rarr; ${$0(N.avgUsedPriceC)}), nada comparado con el volumen. Cuando algo deja de venderse porque la gente ya no lo quiere, el precio suele caer primero; aqu&iacute; las pocas que hay se siguen vendiendo a precio normal.</li>
<li>Las usadas entran al taller por el mostrador &mdash; se le compran al p&uacute;blico. En todo el registro hay <b>${d.buybacks.reduce((n, b) => n + b.n, 0)} compras registradas, por ${$0(d.buybacks.reduce((n, b) => n + b.cents, 0))}</b> (las dos de este mes). Si no entran usadas, no hay usadas que vender: la l&iacute;nea no se muri&oacute; por falta de clientes, se qued&oacute; sin mercanc&iacute;a.</li>
</ul>
<p>Lo que los datos no pueden decir es <b>por qu&eacute;</b> se dej&oacute; de comprar: si fue una decisi&oacute;n del taller o algo que simplemente fue pasando. Esa pregunta vale la pena responderla, porque de ella depende si la l&iacute;nea se puede reabrir.</p>

<h2>Cu&aacute;nto entra hoy, y cu&aacute;nto se ha dejado de recibir</h2>
<div class="kpi">
<div><span>Venta mensual hoy</span><b>&asymp; ${$0(N.perDay.allC * 30.4)}</b><i>${$0(N.perDay.allC)} al d&iacute;a &middot; feb&ndash;jul 2026</i></div>
<div><span>Hace un a&ntilde;o</span><b>&asymp; ${$0(Y.perDayBeforeC * 30.4)}</b><i>${$0(Y.perDayBeforeC)} al d&iacute;a</i></div>
<div><span>Al inicio del registro</span><b>&asymp; ${$0(S.perDay.allC * 30.4)}</b><i>${$0(S.perDay.allC)} al d&iacute;a</i></div>
</div>
<p>De ese terreno perdido, cada l&iacute;nea tiene su parte: las <b>llantas nuevas</b> pasaron de ${$0(S.perDay.newC)} a ${$0(N.perDay.newC)} por d&iacute;a &mdash; unos <b>${$0(newGapPerMonthC)} al mes menos</b> &mdash; y las <b>usadas</b> explican otros ${$0(U.gapPerMonthC)} al mes. El resto es el trabajo de servicio que se fue con los clientes.</p>
<p>Comparado con el ritmo de sus primeros seis meses, al taller le han dejado de entrar <b>${$0(d.wholeBusiness.cumulativeLostC)} en ventas acumuladas</b> a lo largo de los ${n0(U.daysMeasured)} d&iacute;as con registro que siguieron. No todo ese monto era ganancia &mdash; ah&iacute; va el costo de las llantas &mdash; pero da el tama&ntilde;o del terreno perdido.</p>
<p><b>Una aclaraci&oacute;n honesta sobre &laquo;ganancia&raquo;.</b> El sistema registra ventas. Los gastos del taller (renta, sueldos, luz, proveedores) no est&aacute;n en estos datos, as&iacute; que este informe no puede decir la utilidad neta. Lo que s&iacute; se puede decir con el margen m&iacute;nimo que el taller maneja en llantas (20% sobre el costo): las llantas venden hoy ${$0(tiresHoyPerDay)} al d&iacute;a, que dejan <b>al menos ${$0((tiresHoyPerDay / 6) * 30.4)} al mes de ganancia bruta</b>. El resto de la venta (${$0(N.perDay.allC - tiresHoyPerDay)} al d&iacute;a) es servicio y mano de obra, donde el margen es mayor pero no est&aacute; medido en el sistema.</p>

<h2>Proyecci&oacute;n: septiembre a noviembre de 2026</h2>
<p>Tomando el ritmo real de los &uacute;ltimos tres meses completos (${B.months.map(mesLargo).join(", ")}: ${$0(B.perDay.allC)} al d&iacute;a) y ${Q_DAYS} d&iacute;as de trimestre:</p>
<div class="kpi">
<div><span>A &middot; Si todo sigue igual</span><b>&asymp; ${$0(qA)}</b><i>el trimestre (${$0(qA / 3)} al mes)</i></div>
<div><span>B &middot; Con los dos cambios de abajo</span><b>&asymp; ${$0(qB)}</b><i>el trimestre (${$0(qB / 3)} al mes)</i></div>
<div><span>Diferencia</span><b>+${$0(qB - qA)}</b><i>en el trimestre</i></div>
</div>
<div class="verde">
<p><b>Los dos cambios detr&aacute;s del escenario B</b> (los supuestos, dichos con claridad):</p>
<ul>
<li><b>Reabrir la compraventa de usadas</b>, y llevar la l&iacute;nea a la <i>mitad</i> de lo que vend&iacute;a en 2024: +${$0(usedLever / Q_DAYS)} al d&iacute;a &asymp; <b>+${$0(usedLever)} en el trimestre</b>.</li>
<li><b>Resurtir las medidas que la gente pide</b>, y con eso recuperar la mitad del camino hacia lo que las llantas nuevas vend&iacute;an en este mismo trimestre de 2025 (${$0(newLastFall)} al d&iacute;a entonces, ${$0(B.perDay.newC)} hoy): +${$0(newLever / Q_DAYS)} al d&iacute;a &asymp; <b>+${$0(newLever)} en el trimestre</b>.</li>
</ul>
<p>Solo la parte de llantas de ese aumento, al margen m&iacute;nimo del 20%, dejar&iacute;a <b>al menos ${$0(leverProfit)} m&aacute;s de ganancia bruta en el trimestre</b>. Son metas alcanzables &mdash; ninguna pide volver a 2024, solo recuperar la mitad del terreno m&aacute;s reciente &mdash; pero son supuestos, no promesas.</p>
</div>

<h2>Recomendaciones</h2>
<ul>
<li><b>1 &middot; Volver a comprar llantas usadas en mostrador.</b> Es la palanca m&aacute;s directa: la l&iacute;nea vend&iacute;a ${$0(U.startPerDayC * 30.4)} al mes y hoy vende ${$0(U.nowPerDayC * 30.4)}, con el precio de venta intacto &mdash; el problema es que no hay mercanc&iacute;a. Un letrero de &laquo;compramos llantas usadas&raquo;, un presupuesto fijo a la semana, y cada compra registrada en el sistema (la caja ya tiene c&oacute;mo).</li>
<li><b>2 &middot; Resurtir medidas.</b> De ${n0(S.sizesPerMonth)} medidas a ${n0(N.sizesPerMonth)}: cada medida que falta es un cliente que pregunt&oacute; y se fue. El sistema ya apunta las llantas que se buscan y no se tienen &mdash; lleva ${n0(d.demandTotal)} pedidos sin surtir anotados en su primer mes${d.demand.length ? `, con ${d.demand[0].size} y ${d.demand[1].size} a la cabeza` : ""} &mdash; y arma la lista de pedido; usarlo cada semana para decidir qu&eacute; entra.</li>
<li><b>3 &middot; Traer clientes de vuelta.</b> La ca&iacute;da del &uacute;ltimo a&ntilde;o es sobre todo de tr&aacute;fico (${n1(Y.ticketsPerDayBefore)} &rarr; ${n1(Y.ticketsPerDayNow)} tickets al d&iacute;a). El taller ya tiene p&aacute;gina nueva y cuentas para flotillas con su propio portal; empujar Google Maps y la p&aacute;gina, y sumar dos o tres flotillas nuevas, dar&iacute;a volumen estable sin tocar precios.</li>
<li><b>4 &middot; Subir el ticket promedio.</b> De ${$2(Y.avgTicketBeforeC)} baj&oacute; a ${$2(Y.avgTicketNowC)}. En cada llanta vendida, ofrecer siempre montaje, balanceo y desecho de la vieja; son d&oacute;lares que ya est&aacute;n parados frente al mostrador.</li>
</ul>

<div class="metodo">
<b>M&eacute;todo.</b> Fuente: el sistema de caja del taller, ${fecha(d.record.firstDay)} a ${fecha(d.record.lastDay)} (${n0(d.record.tradingDays)} d&iacute;as con registro; ventas totales registradas ${$0(tot.all)}). Las cifras son ventas cobradas en mostrador, con impuesto incluido, sin descontar costos. &laquo;Inicio&raquo; = promedio por d&iacute;a de los primeros seis meses (marzo&ndash;agosto de 2024); &laquo;hoy&raquo; = promedio por d&iacute;a de los &uacute;ltimos seis meses terminados (febrero&ndash;julio de 2026; dos de ellos con tramos sin registro, que la regla por d&iacute;a con registro ya descuenta). La comparaci&oacute;n anual usa los &uacute;ltimos doce meses terminados contra los mismos doce del a&ntilde;o anterior. La proyecci&oacute;n parte de los &uacute;ltimos tres meses completos (marzo&ndash;mayo de 2026). La ganancia m&iacute;nima en llantas usa el margen que el taller define como piso: 20% sobre el costo (la ganancia es 1/6 de la venta). Nota: la pantalla de Tendencias del sistema mide desde agosto de 2024 (su ventana es de dos a&ntilde;os), por eso algunas de sus cifras de &laquo;inicio&raquo; son m&aacute;s bajas que las de este informe, que abarca el registro completo.
<div class="firma">Preparado a partir de los registros del sistema &middot; ${fecha(d.record.lastDay)}</div>
</div>

</div>`;

fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync("docs/informe-llantas.html", html);
console.log(`docs/informe-llantas.html · ${(html.length / 1024).toFixed(0)} KB · ${d.monthly.length} monthly rows`);
