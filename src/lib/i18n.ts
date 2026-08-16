/**
 * The register in Spanish, for whoever wants it that way.
 *
 * AN ACCESSIBILITY OPTION, NOT A SECOND VERSION OF THE PRODUCT, and the
 * distinction decides everything below. The system's own language is English:
 * the receipts print in English, the reports print in English, and the staff
 * manual describes an English screen and always will. This translates what is
 * on the glass for somebody who reads Spanish more comfortably, and changes
 * nothing else. Turn it on, turn it off, and the shop's records are identical.
 *
 * THE KEY IS THE ENGLISH STRING. `t("Take payment")` returns the Spanish, or —
 * and this is the important half — returns "Take payment" when nothing has been
 * written for it yet. Three consequences, all of them deliberate:
 *
 *   The source stays readable. A file full of `t("register.pay.button")` is a
 *   file where you cannot tell what the screen says without a second window
 *   open, and the next person to edit it guesses.
 *
 *   A missing translation is a word in English, never a crash and never a
 *   blank. On a register that has to keep working, that is the only acceptable
 *   failure mode for a cosmetic feature.
 *
 *   Coverage can grow one line at a time, and the thing that grows is this file
 *   alone.
 *
 * WHAT IS DELIBERATELY NOT TRANSLATED. Ticket numbers, tender names as they
 * appear on the card terminal, tire sizes, and anything that has to be read
 * back to a supplier or matched against a printed slip. A word somebody has to
 * find on a piece of paper must be the word that is on the paper.
 */

export type Lang = "en" | "es";

export const LANGS: Lang[] = ["en", "es"];

/**
 * English → Spanish, for the register's own screens.
 *
 * Written the way the shop speaks rather than the way a dictionary does. "Cobrar"
 * for taking money, "corte" for the close-out, "llanta" rather than "neumático" —
 * these are the words used at this counter, and a translation into correct
 * Spanish nobody here says would be a second thing to learn rather than a help.
 */
const ES: Record<string, string> = {
  // ── The shell ──────────────────────────────────────────────────────────
  Technician: "Técnico",
  "Service Writer": "Recepción",
  Cashier: "Cajero",
  Accountant: "Contadora",
  Manager: "Gerente",
  Owner: "Dueño",
  "Register locked": "Caja bloqueada",
  "Enter your PIN to pick up where the counter left off.":
    "Escriba su PIN para seguir donde se quedó el mostrador.",
  "Checking…": "Revisando…",
  "PIN not recognized": "PIN no reconocido",
  Main: "Inicio",
  "New sale": "Venta nueva",
  Logs: "Registro",
  Inventory: "Inventario",
  "Close-out": "Corte",
  Settings: "Ajustes",
  "Time Clock": "Reloj",
  "Switch user": "Cambiar usuario",
  Locked: "Bloqueado",
  "The register locked itself": "La caja se bloqueó sola",
  "Type your PIN to carry on": "Escriba su PIN para seguir",
  Unlock: "Desbloquear",
  "Wrong PIN": "PIN incorrecto",

  // ── Words that appear all over ─────────────────────────────────────────
  Cancel: "Cancelar",
  Close: "Cerrar",
  Save: "Guardar",
  Saving: "Guardando",
  "Saving…": "Guardando…",
  Done: "Listo",
  Add: "Agregar",
  Remove: "Quitar",
  Edit: "Editar",
  Delete: "Borrar",
  Print: "Imprimir",
  Back: "Regresar",
  "Go back": "Regresar",
  Today: "Hoy",
  Yesterday: "Ayer",
  Total: "Total",
  Subtotal: "Subtotal",
  Amount: "Monto",
  Reason: "Razón",
  Note: "Nota",
  Notes: "Notas",
  Customer: "Cliente",
  Customers: "Clientes",
  Vehicle: "Vehículo",
  Ticket: "Ticket",
  Tickets: "Tickets",
  Time: "Hora",
  What: "Qué",
  Who: "Quién",
  Category: "Categoría",
  Detail: "Detalle",
  Balance: "Saldo",
  "Balance due": "Saldo pendiente",
  Paid: "Pagado",
  Payment: "Pago",
  Payments: "Pagos",
  Tip: "Propina",
  Tips: "Propinas",
  Void: "Anular",
  Voided: "Anulado",
  Refund: "Devolución",
  Refunded: "Devuelto",
  Loading: "Cargando",
  "Loading…": "Cargando…",
  Nothing: "Nada",
  Anybody: "Cualquiera",
  Everything: "Todo",
  Search: "Buscar",
  Quantity: "Cantidad",
  Price: "Precio",
  Cost: "Costo",
  Stock: "Existencia",
  Brand: "Marca",
  Size: "Medida",
  Used: "Usada",
  New: "Nueva",

  // ── Main ───────────────────────────────────────────────────────────────
  Sold: "Vendido",
  Collected: "Cobrado",
  Pending: "Pendiente",
  Outstanding: "Pendientes",
  "Terminal tax": "Cargo de terminal",
  "Open tickets": "Tickets abiertos",
  "Last transactions": "Últimas transacciones",
  "Nothing rung yet today.": "Todavía no se ha cobrado nada hoy.",
  "Money that actually came in today. Sold is what we charged for.":
    "El dinero que de verdad entró hoy. Vendido es lo que cobramos.",
  "to technicians": "a los técnicos",
  tickets: "tickets",

  // ── The sale screen ────────────────────────────────────────────────────
  "Complete sale": "Terminar venta",
  "Take payment": "Cobrar",
  "Add a line": "Agregar renglón",
  Description: "Descripción",
  Mechanic: "Técnico",
  "Nobody": "Nadie",
  "Pick a payment method": "Escoja la forma de pago",
  "How much": "Cuánto",
  "Cash": "Efectivo",
  "Change due": "Cambio",
  "Nothing on this ticket yet.": "Todavía no hay nada en este ticket.",
  "Search a tire size…": "Busque una medida…",
  "From stock": "Del inventario",
  "Order it": "Pedirla",
  "Store Credit Approved": "Crédito autorizado",

  // ── Logs ───────────────────────────────────────────────────────────────
  "Show voided": "Ver anulados",
  "Any tender": "Cualquier forma de pago",
  "Any category": "Cualquier categoría",
  "Lines rung": "Renglones cobrados",
  "Money moved": "Movimientos de dinero",
  entry: "renglón",
  entries: "renglones",
  rung: "cobrado",
  collected: "cobrado",
  Range: "Rango",
  "One day": "Un día",
  "Back to today": "Regresar a hoy",
  "Already showing today": "Ya está mostrando hoy",
  "Nothing happened on this day.": "No pasó nada ese día.",
  "Tire movements": "Movimientos de llantas",
  "Show only money taken on one tender": "Ver solo el dinero de una forma de pago",
  "Show only one kind of work": "Ver solo un tipo de trabajo",
  "Also show lines that were rung and struck off again mid-ticket":
    "Ver también los renglones que se pusieron y se quitaron del mismo ticket",
  delete: "borrar",
  "put back": "regresar",
  deleted: "borrado",

  // ── The close-out ──────────────────────────────────────────────────────
  "What the register says": "Lo que dice la caja",
  "Tender reconciliation": "Cuadre por forma de pago",
  "Cash in and out of the drawer": "Entradas y salidas de la caja",
  "Register logs through the day": "Registros de caja durante el día",
  "On account today": "A cuenta hoy",
  "Who received the payments": "Quién recibió los pagos",
  "Prices changed at the counter": "Precios cambiados en el mostrador",
  "Close this shift": "Cerrar el turno",
  Performance: "Desempeño",
  "How the week is going": "Cómo va la semana",
  Expected: "Debe haber",
  Counted: "Contado",
  Difference: "Diferencia",
  Tender: "Forma de pago",
  "Log Register": "Registrar caja",
  "Terminal batch closed": "Lote de terminal cerrado",
  "Print the close-out": "Imprimir el corte",
  "Print this day": "Imprimir este día",
  "Count the drawer and the terminal, then log the register.":
    "Cuente la caja y la terminal, luego registre.",
  "Take cash out": "Sacar dinero",
  "Cash out of the drawer": "Sacar dinero de la caja",
  "Cash into the drawer": "Meter dinero a la caja",
  "What for": "Para qué",
  "Nothing taken out or put in today.": "Hoy no se sacó ni se metió nada.",
  Balanced: "Cuadró",
  "Not counted": "Sin contar",
  "DOES NOT BALANCE": "NO CUADRA",
  short: "faltante",
  over: "sobrante",
  "By day": "Por día",
  "By week": "Por semana",
  "By month": "Por mes",
  "Default — the printed sheet": "Normal — la hoja impresa",
  "This week": "Esta semana",
  "Last week": "La semana pasada",
  "This month": "Este mes",
  "Last month": "El mes pasado",
  "Last day here": "Su último día aquí",
  "Tips today": "Propinas de hoy",
  "Tips this week": "Propinas de la semana",
  "Tips this month": "Propinas del mes",
  Income: "Ingreso",
  Shop: "Taller",

  // ── Inventory ──────────────────────────────────────────────────────────
  "Receive stock": "Recibir mercancía",
  "On hand": "En existencia",
  Count: "Conteo",
  "Low stock": "Poca existencia",
  "Out of stock": "Sin existencia",
  "Nothing matches that.": "No hay nada que coincida.",
  "Print the rack sheet": "Imprimir la hoja de racks",

  // ── Customers and accounts ─────────────────────────────────────────────
  "Owes money": "Debe dinero",
  "Credit account": "Cuenta de crédito",
  "Not approved": "Sin autorizar",
  "House account": "Cuenta de casa",
  "Record a payment": "Apuntar un pago",
  "Show payments": "Ver pagos",
  "Hide payments": "Ocultar pagos",
  "Print statement": "Imprimir estado de cuenta",
  "What went on the tab": "Lo que se cargó a la cuenta",
  "Money in": "Dinero recibido",
  owing: "de deuda",
  "in credit": "a favor",
  Settled: "Saldado",
  "Accounts this month": "Cuentas del mes",
  "Credit approved": "Crédito autorizado",
  "Name, phone or customer number…": "Nombre, teléfono o número de cliente…",

  // ── Orders ─────────────────────────────────────────────────────────────
  Ordered: "Pedida",
  Arrived: "Llegó",
  "Here — call them": "Ya está — hablarle",
  "Called — no answer": "Se le habló — no contestó",
  "Ready for pick up — call them": "Lista — hablarle",
  "Waiting for pickup": "Esperando que la recojan",
  "Picked up": "Ya se la llevaron",
  "Fulfil the order": "Entregar el pedido",
  "I'm sure": "Estoy seguro",

  // ── The tire study ─────────────────────────────────────────────────────
  "Didn't have it": "No la teníamos",
  "Write it down": "Apuntarlo",
  "How many": "Cuántas",
  "A customer asked for a size we did not have": "Un cliente pidió una medida que no teníamos",
  "Tires we didn't have": "Llantas que no teníamos",
  "Most asked for": "Las más pedidas",
  "Tires wanted": "Llantas que querían",
  "On hand now": "En existencia ahora",
  "Last asked": "Última vez que la pidieron",
  "never carried": "nunca la hemos tenido",

// ── The sale screen, in full ───────────────────────────────────────────
  "Tap a service, then a price.": "Toque un servicio, luego un precio.",
  "Add another tender": "Agregar otra forma de pago",
  "Split it, or take part of it": "Dividirlo, o cobrar una parte",
  "Split payment, or take only part of it": "Pago dividido, o cobrar solo una parte",
  "Cancel split": "Cancelar división",
  "Rest on last line": "El resto en el último renglón",
  "Note (optional)": "Nota (opcional)",
  "No mechanic": "Sin técnico",
  "Nobody in particular": "Nadie en particular",
  "Ring this line against nobody": "Poner este renglón sin técnico",
  "Somebody who is not on the floor list": "Alguien que no está en la lista",
  "Tip goes to": "La propina es para",
  "Tip added later": "Propina agregada después",
  "Run the tip as a second charge on the card": "Cobrar la propina como segundo cargo en la tarjeta",
  Cashback: "Cashback",
  "Charge 2": "Cargo 2",
  Change: "Cambio",
  "Create the ticket to pay at the cashier?": "¿Crear el ticket para pagar en la caja?",
  "Loading register…": "Cargando la caja…",
  "Type a size or a brand — 215 55 17, vantage…": "Escriba una medida o una marca — 215 55 17, vantage…",
  "Any way of writing it works — 195 65 15, 195/65R15, 1956515.":
    "Se puede escribir de cualquier forma — 195 65 15, 195/65R15, 1956515.",
  "Size or brand…": "Medida o marca…",
  "Size, brand or name…": "Medida, marca o nombre…",
  "Price a tire": "Cotizar una llanta",
  "This price is a discount": "Este precio es un descuento",
  "Priced at the counter": "Precio puesto en el mostrador",
  Take: "Cobrar",
  "Taking the money here instead": "Cobrando aquí en lugar de allá",
  "Carrying on": "Siguiendo",
  Draft: "Borrador",
  Line: "Renglón",
  Tech: "Técnico",
  Other: "Otro",

  // ── Main, in full ──────────────────────────────────────────────────────
  "Nothing collected yet.": "Todavía no se ha cobrado nada.",
  "Nothing rung on this day.": "No se cobró nada ese día.",
  "Nothing on order.": "No hay nada pedido.",
  "Still owed on orders": "Falta cobrar de pedidos",
  "Rung but never completed — finish the ticket": "Se cobró pero nunca se cerró — termine el ticket",
  "Vehicle is here — waiting on us": "El carro está aquí — esperándonos",
  "On order — we owe them the tire": "Pedida — le debemos la llanta",
  "Outstanding order": "Pedido pendiente",
  "They took it": "Ya se lo llevaron",
  "The tickets": "Los tickets",
  "Anything the next person on the counter needs to know…":
    "Algo que la siguiente persona del mostrador deba saber…",
  "Close this notice": "Cerrar este aviso",
  "Take it down": "Quitarlo",
  "Paid and closed. This notice clears itself in a minute.":
    "Pagado y cerrado. Este aviso se quita solo en un minuto.",
  "Move this order somewhere else": "Mover este pedido a otro lado",
  "Show finished": "Ver terminados",

  // ── The ticket drawer ──────────────────────────────────────────────────
  Details: "Detalles",
  "Print receipt": "Imprimir recibo",
  "Print a receipt": "Imprimir un recibo",
  "Pin a note to this ticket": "Dejar una nota en este ticket",
  "Note on this ticket": "Nota de este ticket",
  "Nothing collected on this ticket.": "No se ha cobrado nada de este ticket.",
  "Fix a price that was rung wrong": "Corregir un precio mal cobrado",
  "The customer paid, but this row says the wrong thing about it":
    "El cliente pagó, pero este renglón dice algo equivocado",
  "Refund on this ticket": "Devolución en este ticket",
  "Take it off": "Quitarlo",
  "Fitted by": "Montada por",
  Undo: "Deshacer",
  Invoice: "Factura",

  // ── Inventory, in full ─────────────────────────────────────────────────
  "Everything on the racks, by size.": "Todo lo que hay en los racks, por medida.",
  "Cost each": "Costo c/u",
  "Price each": "Precio c/u",
  "Sells at": "Se vende en",
  Supplier: "Proveedor",
  Model: "Modelo",
  Ply: "Capas",
  Name: "Nombre",
  Batteries: "Baterías",
  Miscellaneous: "Varios",
  Service: "Servicio",
  Tire: "Llanta",
  "Only show current stock": "Ver solo lo que hay",
  "Show sold out": "Ver lo agotado",
  "Running low": "Se está acabando",
  "Sold more than the racks had": "Se vendió más de lo que había",
  "On the rack with no price — the register does not know what to charge":
    "En el rack sin precio — la caja no sabe qué cobrar",
  "Pricing needs a look": "Hay que revisar precios",
  "Priced this way on purpose — kept out of the below-cost review":
    "Con este precio a propósito — fuera de la revisión de bajo costo",
  "Stock records disagree with themselves.": "Los registros de existencia no concuerdan.",
  "Counted on the rack": "Contado en el rack",
  "Total counted": "Total contado",
  "Counted today?": "¿Contado hoy?",
  "Miscount, damaged, sold off the books…": "Mal contado, dañado, vendido fuera de registro…",
  "Anything worth remembering about this count": "Algo que valga la pena recordar de este conteo",
  "One more": "Uno más",
  "One fewer": "Uno menos",
  Clear: "Limpiar",
  Date: "Fecha",
  Orders: "Pedidos",
  "Remove this from the list?": "¿Quitar esto de la lista?",
  Help: "Ayuda",

// ── The orders log ─────────────────────────────────────────────────────
  "The board": "El tablero",
  "All orders": "Todos los pedidos",
  "Any stage": "Cualquier etapa",
  Stage: "Etapa",
  "Still going": "Todavía en proceso",
  "Finished or cancelled": "Terminados o cancelados",
  "Taken between": "Levantados entre",
  "All time": "Todo el tiempo",
  "all time": "todo el tiempo",
  From: "Desde",
  To: "Hasta",
  and: "y",
  order: "pedido",
  orders: "pedidos",
  "Ticket, customer, phone, tire, note…": "Ticket, cliente, teléfono, llanta, nota…",
  "How it got here": "Cómo llegó aquí",
  "Hide the history": "Ocultar el historial",
  "It has not moved since it was rung.": "No se ha movido desde que se cobró.",
  "Ticket rung": "Ticket cobrado",
  "back from": "regresado de",
  after: "después de",
  day: "día",
  days: "días",

// ── The management reports ─────────────────────────────────────────────
  Reports: "Reportes",
  "How the shop is doing, over whatever window you ask for.":
    "Cómo va el taller, en el periodo que usted pida.",
  "Last 7 days": "Últimos 7 días",
  "Last 30 days": "Últimos 30 días",
  "Last 90 days": "Últimos 90 días",
  "Last 12 months": "Últimos 12 meses",
  Between: "Entre",
  "compared with the same length before it": "comparado con el mismo periodo anterior",
  "Management report": "Reporte gerencial",
  printed: "impreso",
  Money: "Dinero",
  "on the window before": "contra el periodo anterior",
  "Average ticket": "Ticket promedio",
  "Gross margin": "Margen bruto",
  "not enough cost data": "faltan costos",
  "costs are only recorded on tires": "los costos solo se capturan en llantas",
  "on the": "sobre el",
  "of sales with a cost": "de las ventas que traen costo",
  "Given away": "Descuentos",
  "tickets discounted": "tickets con descuento",
  "Tickets a day": "Tickets por día",
  "What sells": "Qué se vende",
  "Sales mix": "Mezcla de ventas",
  "How it was paid": "Cómo se pagó",
  "Margin by category": "Margen por categoría",
  "Best sellers": "Lo que más se vende",
  "Units sold in this window.": "Unidades vendidas en el periodo.",
  Units: "Unidades",
  Margin: "Margen",
  "Margin %": "Margen %",
  Costed: "Con costo",
  sold: "vendido",
  "When the shop is busy": "Cuándo hay trabajo",
  "Tickets by hour": "Tickets por hora",
  "Takings by day of the week": "Ventas por día de la semana",
  "Busiest hours": "Las horas más ocupadas",
  "tickets a day": "tickets por día",
  "Averaged over how many of each day the window held.":
    "Promediado sobre cuántos de cada día trae el periodo.",
  "Who did the work": "Quién hizo el trabajo",
  "Share of what the shop took": "Parte de lo que entró al taller",
  "New tires": "Llantas nuevas",
  "Used tires": "Llantas usadas",
  "Other work": "Otro trabajo",
  "Brought in": "Trajo",

// ── Performance, trends, and the rest of the newer report panels ───────
  Trends: "Tendencias",
  "Show 10 more": "Ver 10 más",
  showing: "mostrando",
  of: "de",
  Quiet: "Tranquilo",
  Busiest: "A tope",
  "Blue is quiet, red is flat out. This is the one report that settles a rota argument — a shop can feel busy on a Saturday and take most of its money on a Thursday.":
    "Azul es tranquilo, rojo es a tope. Este es el reporte que zanja una discusión de horarios — el taller puede sentirse ocupado en sábado y hacer la mayor parte del dinero en jueves.",

  "How everyone is doing": "Cómo va cada quien",
  "Measured per day they were actually here, against the same length of time before this window. Somebody who works Saturdays is not a sixth of somebody who works six days.":
    "Medido por día que de verdad estuvo aquí, contra el mismo periodo anterior. Quien trabaja los sábados no es la sexta parte de quien trabaja seis días.",
  "Nobody has been credited with a line in this window.":
    "Nadie tiene trabajo acreditado en este periodo.",
  "There is no record of the shop opening between": "No hay registro de que el taller abriera entre",
  ", so there is nothing to compare this window against. The arrows below are left off rather than showing everyone down 100%.":
    ", así que no hay contra qué comparar este periodo. Las flechas de abajo se omiten en vez de mostrar a todos con menos 100%.",
  "On the floor": "En el piso",
  "credited with work in this window": "con trabajo acreditado en este periodo",
  "Best day rate": "Mejor por día",
  "days here": "días aquí",
  "Typical day rate": "Lo normal por día",
  "the middle of the crew": "el medio del equipo",
  "what customers added, this window": "lo que los clientes agregaron, este periodo",
  "Money brought in, per day here": "Dinero que trajo, por día aquí",
  "The fair comparison between people who work different amounts.":
    "La comparación justa entre quienes trabajan distinto número de días.",
  "Days here": "Días aquí",
  "Per ticket": "Por ticket",
  "Tip a ticket": "Propina por ticket",
  "Per day here": "Por día aquí",
  gone: "ya no",

  "Which way it is going": "Hacia dónde va",
  "The only section that ignores the window at the top. A direction taken over whichever fortnight you selected is not a direction — this one always covers the last two years.":
    "La única sección que ignora el periodo de arriba. Una tendencia medida sobre la quincena que usted haya escogido no es una tendencia — esta siempre cubre los últimos dos años.",
  "No records at all for": "No hay ningún registro de",
  "Those months are left out of every comparison below rather than counted as zero, which would read as a collapse that never happened.":
    "Esos meses quedan fuera de toda comparación de abajo en vez de contarse como cero, lo cual se leería como una caída que nunca pasó.",
  "Takings a day": "Venta por día",
  "on a year ago": "contra hace un año",
  "months compared": "meses comparados",
  "on the 12 months before": "contra los 12 meses anteriores",
  "Best month": "Mejor mes",
  "a day": "por día",
  "Takings for every day open, month by month": "Venta por cada día abierto, mes por mes",
  "Per trading day rather than per month, so a short February and a week shut in July do not read as bad months.":
    "Por día trabajado y no por mes, para que un febrero corto o una semana cerrado en julio no se lean como meses malos.",
  "no records": "sin registro",
  "This year against last": "Este año contra el pasado",
  "Each month beside the same month a year earlier.":
    "Cada mes junto al mismo mes del año anterior.",
  "A year ago": "Hace un año",
  "This year": "Este año",
  "The shop's year": "El año del taller",
  "Every January averaged, every February averaged, and so on, over everything on record.":
    "Cada enero promediado, cada febrero promediado, y así, sobre todo lo registrado.",
  year: "año",
  years: "años",
  "What the shop sells, quarter by quarter": "Qué vende el taller, trimestre por trimestre",
  "Each column is one quarter's takings as shares. Watch for a band getting thicker across the page — that is the business changing shape.":
    "Cada columna es la venta de un trimestre en partes. Fíjese si una franja se hace más gruesa a lo largo de la página — eso es el negocio cambiando de forma.",
  "The shop has": "El taller tiene",
  "months on record. The busiest single day was": "meses registrados. El día más fuerte fue",
  January: "Enero",
  February: "Febrero",
  March: "Marzo",
  April: "Abril",
  May: "Mayo",
  June: "Junio",
  July: "Julio",
  August: "Agosto",
  September: "Septiembre",
  October: "Octubre",
  November: "Noviembre",
  December: "Diciembre",


// ── The trends page ────────────────────────────────────────────────────
// The page's own furniture is translated. The findings under "Worth knowing"
// are composed on the server with the shop's figures inside them, so they
// cannot be keyed on an English string and stay in English — the same
// fallback every untranslated string in this file uses. Their headings are
// here, because those come from a fixed list.
  "Everything on record — no date range. A direction measured over a fortnight is not a direction.":
    "Todo lo registrado — sin rango de fechas. Una tendencia medida sobre una quincena no es una tendencia.",
  "Back to Reports": "Volver a Reportes",
  "trading days": "días trabajados",
  "finished months on record": "meses completos registrados",
  "Working it out…": "Sacando cuentas…",
  "Could not load the trends": "No se pudieron cargar las tendencias",
  "Those months are left out of every comparison rather than counted as zero, which would read as a collapse that never happened.":
    "Esos meses quedan fuera de toda comparación en vez de contarse como cero, lo cual se leería como una caída que nunca pasó.",

  "Worth knowing": "Lo que hay que saber",
  "Worked out from the charts below every time this page is opened, not written down once. Each one says what it means and what it does not.":
    "Calculado de las gráficas de abajo cada vez que se abre la página, no escrito una sola vez. Cada punto dice qué significa y qué no.",
  "Nothing stands out. There is not enough history yet for most of these checks.":
    "Nada resalta. Todavía no hay suficiente historial para la mayoría de estas revisiones.",
  Serious: "Grave",
  Watch: "Ojo",
  Steady: "Estable",

  "Where it stands": "Cómo estamos",
  "The last twelve finished months against the twelve before them":
    "Los últimos doce meses completos contra los doce anteriores",
  "months both years have records for": "meses que ambos años tienen registrados",
  "technicians on an average day": "técnicos en un día normal",

  "Why it moved": "Por qué se movió",
  "Takings a day is tickets a day multiplied by the average ticket, so a change in it splits exactly between the two. There is no third cause and no remainder.":
    "La venta por día es tickets por día por el ticket promedio, así que un cambio se reparte exactamente entre los dos. No hay una tercera causa ni sobra nada.",
  "From a year ago to now, one cause at a time": "De hace un año a hoy, una causa a la vez",
  "Green adds, red takes away. The two steps sum to the whole change.":
    "Verde suma, rojo resta. Los dos pasos suman el cambio completo.",
  "Number of tickets": "Cuántos tickets",
  "Size of each ticket": "De a cómo cada ticket",
  Now: "Hoy",
  "Tickets for every day open": "Tickets por cada día abierto",

  "Whether there were tires to sell": "Si había llantas que vender",
  "What was on the racks was never written down before the register existed, so these three stand in for it. The last one is the control: if customers had stopped affording tires it would fall as they traded down. If the tires were not there, it does not move at all.":
    "Lo que había en los racks nunca se anotó antes de que existiera la caja, así que estas tres lo sustituyen. La última es el control: si a los clientes ya no les alcanzara, bajaría porque comprarían más barato. Si las llantas no estaban, no se mueve nada.",
  "Different sizes sold in the month": "Medidas distintas vendidas en el mes",
  "The range actually on offer. It narrows before the volume does.":
    "El surtido que de verdad hay. Se angosta antes de que caiga el volumen.",
  "Tickets that carried a tire": "Tickets que llevaron llanta",
  "How often somebody who walked in left with one.": "Qué tan seguido alguien que entró se fue con una.",
  Sizes: "Medidas",
  "Share of tickets": "Parte de los tickets",
  "Tires out of the door, for every day open": "Llantas que salieron, por cada día abierto",
  "Tires a day": "Llantas por día",
  "What one tire sold for": "De a cómo se vendió una llanta",
  "The control. A flat line here rules out customers trading down.":
    "El control. Una línea plana aquí descarta que los clientes estén comprando más barato.",
  "Average tire": "Llanta promedio",
  "What the shop sells, for every day open": "Qué vende el taller, por cada día abierto",
  "Three lines rather than shares, so a line that falls is seen falling rather than seen as another line growing.":
    "Tres líneas en vez de partes, para que una línea que baja se vea bajando y no como que otra creció.",

  "The crew, against the work": "El equipo, contra el trabajo",
  "Counted as technicians credited with work that day — the time clock has too little in it to measure hours, so everything here is per technician-day and never per hour.":
    "Contado como técnicos con trabajo acreditado ese día — el reloj tiene muy poco para medir horas, así que todo aquí es por técnico-día y nunca por hora.",
  "Technicians on the floor, on an average day": "Técnicos en el piso, en un día normal",
  "What one technician gets through in a day": "Lo que saca un técnico en un día",
  "Tickets against money. When tickets climb and money does not, the work got smaller rather than the person faster.":
    "Tickets contra dinero. Cuando suben los tickets y el dinero no, el trabajo se hizo más chico, no la persona más rápida.",
  "Money brought in per technician-day": "Dinero que entra por técnico-día",
  "Per technician-day": "Por técnico-día",

  "The long run": "El largo plazo",
  "Per trading day throughout, so a short February and a week shut in July do not read as bad months.":
    "Por día trabajado en todo, para que un febrero corto o una semana cerrado en julio no se lean como meses malos.",
  "The last bar is the month we are standing in and is not finished.":
    "La última barra es el mes en el que estamos y no está completo.",
  "The same figure with the seasons taken out": "La misma cifra sin la temporada",
  "Each point is the twelve months up to it, so every point holds one of every month. When this line moves, the business moved — not the calendar.":
    "Cada punto son los doce meses hasta ahí, así que cada punto trae uno de cada mes. Cuando esta línea se mueve, se movió el negocio — no el calendario.",
  "Twelve months to here": "Doce meses hasta aquí",

  "The shop's year, and its week": "El año del taller, y su semana",
  "Which months and which days the shop actually earns in, over everything on record.":
    "En qué meses y en qué días de verdad gana el taller, sobre todo lo registrado.",
  "Every month, averaged": "Cada mes, promediado",
  "Per trading day, over every year on record.": "Por día trabajado, sobre cada año registrado.",
  "The week, then and now": "La semana, antes y ahora",
  "A best day that stops standing out is what a ceiling looks like.":
    "Un mejor día que deja de destacar es como se ve un tope.",
  Then: "Antes",

  "How it is paid": "Cómo se paga",
  "Shares of what was collected, quarter by quarter. This is the figure that would move first if cash stopped being rung up, which is why it is worth a glance even when it is dull.":
    "Partes de lo cobrado, trimestre por trimestre. Esta es la cifra que se movería primero si el efectivo dejara de capturarse, por eso vale una mirada aunque esté aburrida.",

  "Kept on its own page, because it is the one question a date range cannot answer.":
    "En su propia página, porque es la única pregunta que un rango de fechas no puede contestar.",
  "Trends, and what is worth worrying about": "Tendencias, y qué hay que estar viendo",
  "Everything on record, per trading day: the long run with the seasons taken out, what is driving the change, whether there were tires to sell, the crew against the work — and the conclusions worked out for you at the top.":
    "Todo lo registrado, por día trabajado: el largo plazo sin la temporada, qué está moviendo el cambio, si había llantas que vender, el equipo contra el trabajo — y las conclusiones ya sacadas hasta arriba.",
  Open: "Abrir",

  Phone: "Teléfono",
  "New customer": "Cliente nuevo",
  "Who they are": "Quiénes son",
  "Add them": "Agregarlo",
  "Straight into the book, no ticket involved — for an account being set up before its first invoice. A name is enough; the phone and the cars can come later.":
    "Directo al libro, sin ticket de por medio — para una cuenta que se abre antes de su primera factura. Con el nombre basta; el teléfono y los carros pueden venir después.",
  "optional — “Fleet: Gomez Landscaping”": "opcional — “Flotilla: Gomez Landscaping”",

  "Trends report": "Informe de tendencias",
  "The written report, in Spanish, as a printable PDF: where the business is heading, why, and the evidence — every chart explained in plain words. It is rebuilt from today's figures each time, so opening it takes a few seconds.":
    "El informe escrito, en español, como PDF imprimible: hacia dónde va el negocio, por qué, y la evidencia — cada gráfica explicada con palabras sencillas. Se rearma con las cifras de hoy cada vez, así que abrirlo tarda unos segundos.",
  "Open the report": "Abrir el informe",

  Keep: "Mantener",
  Set: "Fijar",
  set: "fijado",
  asks: "pedidas",
  "The racks, worth a look": "Los racks, vale la pena un vistazo",
  "money standing still, what to keep stocked, and what walked out": "dinero parado, qué mantener surtido, y qué se fue sin venderse",
  "On the racks with no sale in 45 days. Every one of these is cash parked on a shelf.": "En los racks sin una venta en 45 días. Cada una de estas es dinero estacionado en una repisa.",
  "Nothing — the racks are moving.": "Nada — los racks se están moviendo.",
  "Sitting there, at cost": "Ahí parado, a costo",
  "What actually sells, against what is on the rack right now. Set puts the suggested level on the tire so the low-stock alarm watches it for you.": "Lo que de verdad se vende, contra lo que hay en el rack ahorita. Fijar pone el nivel sugerido en la llanta para que la alarma de existencia baja la vigile por usted.",
  "Nothing selling fast enough to advise on yet.": "Todavía no hay nada que se venda tan rápido como para aconsejar.",
  "Sizes asked for in the last month that the shop could not sell — from the counter's own study, and from searches that found nothing. Every row is a customer who left.": "Medidas que pidieron en el último mes y el taller no pudo vender — del estudio del mostrador, y de búsquedas que no encontraron nada. Cada renglón es un cliente que se fue.",
  "Nothing recorded walking out this month.": "Nada registrado que se fuera este mes.",
  "searched and not found": "buscada y no encontrada",

  "printed by": "impreso por",

  "Tires sold this week": "Llantas vendidas esta semana",
  "Tires stocked this week": "Llantas surtidas esta semana",
  "units on the racks": "piezas en los racks",
  "new tires, last 7 days": "llantas nuevas, últimos 7 días",

  "the full list": "la lista completa",
  "Every size on the racks with no sale in 45 days — oldest sleeper first.": "Cada medida en los racks sin una venta en 45 días — la más dormida primero.",
  "as of": "al",
  "Days on shelf": "Días en repisa",
  "never sold one": "nunca vendió una",
  sizes: "medidas",
  units: "piezas",
  "at cost": "a costo",
  "with no sale in": "sin venta en",
  Searches: "Búsquedas",
  "Your account can't see this report.": "Su cuenta no puede ver este reporte.",

  "Everything so far": "Todo hasta ahora",
  // The website's stock searches, on their own page.
  "Looked for on the website": "Buscado en la página web",
  "Tires looked for on the website": "Llantas buscadas en la página web",
  "Sizes people typed into the stock search on the website, and what it told them.":
    "Medidas que la gente escribió en el buscador de la página web, y lo que se les respondió.",
  "Times searched": "Veces buscada",
  "Different sizes": "Medidas distintas",
  "We had it": "Sí la teníamos",
  "We did not": "No la teníamos",
  "On the rack now": "En existencia ahora",
  // "Last asked", "never carried", "Last 30 days" and "Last 7 days" are
  // already in this table — the counter's own study says all four — so they
  // are not repeated here.
  typed: "escrito",
  "Back to reports": "Volver a reportes",
  "Nobody has searched the website in this window. The box went up recently — give it a few days.":
    "Nadie ha buscado en la página web en este periodo. El buscador se puso hace poco — dele unos días.",
  "Not counted above:": "No contadas arriba:",
  "searches where only part of a size was typed. The website refuses those rather than guessing, and they are kept because what people fail to type is worth reading too.":
    "búsquedas donde solo se escribió parte de una medida. La página no adivina, y se guardan porque lo que la gente no alcanza a escribir también dice algo.",
  "Your account does not read reports.": "Su cuenta no lee reportes.",
  "One month": "Un mes",

  "The racks": "Los racks",
  "Stock on hand": "Existencia",
  "units, at cost": "unidades, a costo",
  "Standing still": "Parado",
  "sizes with no sale in 45 days": "medidas sin venta en 45 días",
  "At the reorder point": "En punto de reorden",
  "sizes to order": "medidas por pedir",
  "Bought over the counter": "Comprado en el mostrador",
  "used tires taken in": "llantas usadas recibidas",
  "Where the money is, by brand": "Dónde está el dinero, por marca",
  "By rim size": "Por rin",
  "Money standing still": "Dinero parado",
  "To order": "Por pedir",
  "Tied up": "Detenido",
  "Last sold": "Última venta",
  "On the shelf": "En el rack",
  "Reorder at": "Reordenar en",
  "Sold in 90 days": "Vendidas en 90 días",
  "days ago": "días",
  never: "nunca",
  "What is owed to the shop": "Lo que le deben al taller",
  "On tickets": "En tickets",
  "On house accounts": "En cuentas de casa",
  "On accounts": "En cuentas",
  "Owed altogether": "Total adeudado",
  "How old the debt is": "Antigüedad de la deuda",
  Age: "Antigüedad",
  Together: "Juntos",
  "0–30 days": "0–30 días",
  "31–60 days": "31–60 días",
  "61–90 days": "61–90 días",
  "Over 90 days": "Más de 90 días",
  "Tickets with a name": "Tickets con nombre",
  "without one": "sin nombre",
  "New customers": "Clientes nuevos",
  "Came back": "Regresaron",
  "Repeat share": "Porcentaje que regresa",
  "of named customers had been in before": "de los clientes con nombre ya habían venido",
  "Who spends the most": "Quién gasta más",
  "What walked out": "Lo que se fue sin comprar",
  "Asked for and not in stock": "Pedidas y sin existencia",
  "Searched for and not found": "Buscadas y no encontradas",
  "From the counter's study.": "Del estudio del mostrador.",
  "The whole study": "El estudio completo",
  "still none": "sigue sin haber",
  "now on hand": "ahora en existencia",
  "Worth a second look": "Vale la pena revisar",
  "Voided tickets": "Tickets anulados",
  Refunds: "Devoluciones",
  "Changed after completing": "Cambiados después de cerrar",
  "Sold below the count": "Vendido debajo del conteo",
  "Register logs that did not balance": "Registros de caja que no cuadraron",
  worst: "el peor",
  "Who gave the discounts": "Quién dio los descuentos",
  "Who voided tickets": "Quién anuló tickets",
  "under the rack by": "debajo del precio de rack por",
  "over the rack by": "arriba del precio de rack por",
  "Adding it up…": "Sacando cuentas…",
  "Every figure here covers": "Todas las cifras cubren",
  "Your account can't see the management reports.":
    "Su cuenta no puede ver los reportes gerenciales.",

// ── Extra permissions ──────────────────────────────────────────────────
  "Extra permissions": "Permisos extra",
  "One permission, given to one person, without moving them to another role. Their role is unchanged and everything else about it stays exactly as it was.":
    "Un permiso, dado a una sola persona, sin cambiarla de puesto. Su puesto queda igual y todo lo demás sigue exactamente como estaba.",
  "nothing extra": "nada extra",
  "Give one": "Dar uno",
  "Pick a permission…": "Escoja un permiso…",
  "Take it back": "Quitarlo",

// ── Worth keeping in stock ─────────────────────────────────────────────
  "Worth keeping in stock": "Vale la pena tener siempre",
  "Selling steadily, with no standing level set — or one set too low.":
    "Se venden seguido y no tienen punto de reorden — o lo tienen muy bajo.",
  "Everything that sells has a reorder point that fits it.":
    "Todo lo que se vende ya tiene un punto de reorden adecuado.",
  "Days of cover": "Días que alcanza",
  Suggest: "Sugerido",
  "none left": "no queda",
  d: "d",
  "The suggestion is about a fortnight of sales at the rate above — a starting figure, not an answer. A fortnight is right only if the truck comes in a fortnight, which this cannot know. Set it on the tire in Inventory and it starts appearing in To order.":
    "El sugerido es más o menos lo que se vende en dos semanas al ritmo de arriba — un punto de partida, no una respuesta. Dos semanas sirve solo si el camión llega en dos semanas, y eso el sistema no lo sabe. Póngalo en la llanta desde Inventario y empezará a salir en Por pedir.",

// ── Discounts and the search list ──────────────────────────────────────
  "Apply Discount": "Aplicar descuento",
  "Change the": "Cambiar el",
  discount: "descuento",
  "How much off": "Cuánto de descuento",
  Why: "Por qué",
  "Regular · matched a price · put right a mistake": "Cliente frecuente · igualamos un precio · corregir un error",
  "Comes off the ticket before payment, and is reported separately at close.":
    "Se descuenta del ticket antes de cobrar, y en el corte sale por separado.",
  "You can take up to": "Usted puede quitar hasta",
  "off; more than that needs a manager.": "; más que eso lo tiene que hacer un gerente.",
  "That is more than you can take off on your own — a manager has to do it.":
    "Eso es más de lo que usted puede quitar solo — lo tiene que hacer un gerente.",
  "That is more than the ticket comes to. Giving back more than was charged is a refund.":
    "Eso es más de lo que suma el ticket. Regresar más de lo que se cobró es una devolución.",
  "Sizes the register was asked for and could not show.":
    "Medidas que le pidieron a la caja y no pudo mostrar.",
  "half-typed": "a medio escribir",
  "Show half-typed searches": "Ver búsquedas a medio escribir",
  "Showing half-typed searches as well as whole sizes":
    "Mostrando también las búsquedas a medio escribir",
  "Also show half-typed searches and other odd entries":
    "Ver también las búsquedas a medio escribir y otros casos raros",
  "Every search found a size we had.": "Todas las búsquedas encontraron una medida que teníamos.",

  /*
    ── The Drawer ─────────────────────────────────────────────────────────

    The screen only. The close-out sheet and the cashier sheet that print off
    this page stay in English on purpose: they are filed, signed and handed to
    the accountant, and a document that changes language depending on who
    happened to press Print is worse for that job than one kept consistently in
    the language the shop's paperwork is kept in.

    "Drawer" is the cash drawer itself — "Caja", not "Cajón", because on the
    floor the drawer, the register and the day's cash are one idea and "la
    caja" is what everybody already calls it.
  */
  Drawer: "Caja",
  "Count it in the morning, log cash in and out as it happens, close it at night. The printout is refused until the register is logged.":
    "Cuéntela en la mañana, apunte el dinero que entra y sale conforme pasa, y ciérrela en la noche. No se puede imprimir hasta que se apunte el conteo de la caja.",
  "Count the opening drawer": "Cuente la caja al abrir",
  "Counted in the drawer": "Contado en la caja",
  "Count the drawer and the terminal": "Cuente la caja y la terminal",
  "Count the cash in hand. Settle and read the batch total off the card terminal.":
    "Cuente el efectivo que hay. Cierre el lote en la terminal de tarjetas y lea el total.",
  "Log a count whenever it suits — at a shift change, after a bank run, or any time the drawer feels wrong — and again at close. The last one of the day is the one this sheet is signed on.":
    "Apunte un conteo cuando convenga — al cambiar de turno, después de ir al banco, o cuando la caja se sienta rara — y otra vez al cerrar. El último del día es sobre el que se firma esta hoja.",
  "Cash in / out of the drawer": "Dinero que entra o sale de la caja",
  "What happened": "Qué pasó",
  "The opening float is counted on its own when the shift opens — do not record it here too.":
    "El fondo de apertura se cuenta aparte cuando abre el turno — no lo apunte aquí también.",
  "Keep off the sheet": "No sale en la hoja",
  "Rename fixes the words. Delete is for a row where no cash moved — if it did, undo it instead so the day keeps both halves.":
    "Cambiar nombre corrige las palabras. Borrar es para una línea donde no se movió dinero — si sí se movió, mejor deshágala para que el día conserve las dos mitades.",
  "Still on the clock": "Todavía con el reloj corriendo",
  "Clock them out at the time they actually left. Anyone left on will be auto-closed at 9pm tonight.":
    "Márquele la salida a la hora en que de verdad se fue. A quien quede pendiente se le cierra solo a las 9 de la noche.",
  "Read the verdict": "Lea el resultado",
  "Appears once the register is logged.": "Aparece en cuanto se apunte el conteo de la caja.",
  "More in the drawer than the tickets account for — usually a sale rung short or not rung at all. Worth finding, but nothing is missing.":
    "Hay más en la caja de lo que explican los tickets — casi siempre una venta cobrada de menos o que no se registró. Vale la pena encontrarla, pero no falta nada.",
  // The tips-covered-the-short verdict, assembled around the two dollar
  // figures on screen: "The drawer counted {X} light, and {Y} of tips…"
  "The drawer counted": "A la caja le faltaron",
  "light, and": "en el conteo, y",
  "of tips were paid out of it in cash — the money left in hands, not unaccounted for.":
    "de propinas se pagaron de ahí en efectivo — el dinero salió en manos, no está perdido.",
  "Once the tips are set aside there is": "Ya apartadas las propinas, sobran",
  "more than the tickets explain.": "más de lo que explican los tickets.",
  "Print and sign": "Imprima y firme",
  "The close-out is one page: the verdict, the reconciliation and the signatures. Settle the terminal batch before signing.":
    "El corte es una sola hoja: el resultado, el cuadre y las firmas. Cierre el lote de la terminal antes de firmar.",
  "Print full report": "Imprimir el reporte completo",
  "Your account does not close the day.": "Su cuenta no cierra el día.",

/*
    ── The backlog ────────────────────────────────────────────────────────

    Everything that was already wrapped in tr() across the register and the
    reports but had no Spanish, done in one pass so the language toggle stops
    dropping half a screen back into English mid-sentence — which is worse than
    a screen that is honestly all English, because it reads as a bug.

    Two rules held throughout. Shop words over dictionary words: "la caja" for
    the drawer and the register both, "llantas", "ponchada", "el corte" for the
    close-out, because that is what is said at this counter. And the short
    fragments below are units and captions sitting under a number — they are
    translated as the label they are, not as sentences.
  */
  "Daily Report": "Reporte del día",
  "These figures are experimental and for the development team.":
    "Estas cifras son experimentales y para el equipo de desarrollo.",
  "Reports are still being built.": "Los reportes todavía se están construyendo.",
  "The judgements first — everything below them is the evidence.":
    "Primero las conclusiones — todo lo de abajo es la evidencia.",
  "Nothing stands out. The rest of this page is the evidence for that sentence.":
    "Nada llama la atención. El resto de esta página es la evidencia de esa frase.",
  "Sections": "Secciones",
  "The whole day, read rather than worked. Counting and signing are at":
    "El día completo, para leerse y no para trabajarse. El conteo y las firmas están en",

  // ── Alarms ─────────────────────────────────────────────────────────────
  "Alarm": "Alerta",
  "alarm": "alerta",
  "Alarms": "Alertas",
  "alarms": "alertas",
  "Alarm log": "Registro de alertas",
  "alarms in this range": "alertas en este rango",
  "Everything the Daily Report has flagged, day by day. Dismissing does not switch an alarm off — it writes your name, the time and your note against it, and the alarm keeps firing while the figures underneath it say it should.":
    "Todo lo que el Reporte del día ha marcado, día por día. Descartar no apaga una alerta — escribe su nombre, la hora y su nota junto a ella, y la alerta sigue sonando mientras las cifras de abajo digan que debe sonar.",
  "Nothing fired in this range. Every day in it closed clean.":
    "No sonó nada en este rango. Todos esos días cerraron limpios.",
  "Dismiss": "Descartar",
  "Dismiss with a note": "Descartar con una nota",
  "Dismissed": "Descartada",
  "Dismissed by": "Descartada por",
  "Reviewed": "Revisada",
  "alert dealt with": "alerta atendida",
  "alerts dealt with": "alertas atendidas",
  "serious": "grave",
  "no note": "sin nota",
  "Your account can't see the alarm log.": "Su cuenta no puede ver el registro de alertas.",

  // ── The register, the drawer and the day ───────────────────────────────
  "At the register": "En la caja",
  "The drawer": "La caja",
  "Register last logged": "Último conteo de la caja",
  "Opening float": "Fondo de apertura",
  "Cash from customers": "Efectivo de clientes",
  "Should be in the drawer": "Debe haber en la caja",
  "What should physically be in it: the float, plus cash from customers, plus what moved in or out without being a sale.":
    "Lo que físicamente debe haber: el fondo, más el efectivo de clientes, más lo que entró o salió sin ser una venta.",
  "as counted at": "contado a las",
  "matches the tickets": "cuadra con los tickets",
  "DOES NOT match the tickets": "NO cuadra con los tickets",
  "did not balance": "no cuadró",
  "balanced": "cuadró",
  "matches, counting the ordered tires": "cuadra, contando las llantas pedidas",
  "Of the difference:": "De la diferencia:",
  "Cash in and out": "Entradas y salidas de efectivo",
  "In / out": "Entra / sale",
  "Cash is covered until the drawer has been counted on the close-out.":
    "El efectivo queda tapado hasta que se cuente la caja en el corte.",
  "Shown once the drawer has been counted": "Se muestra en cuanto se cuente la caja",
  "Every non-sale movement, with its reason.": "Cada movimiento que no es venta, con su razón.",
  "no reason given": "sin razón anotada",
  "Where the money came from": "De dónde vino el dinero",
  "Off the payment ledger, the same rows the drawer and the terminal answer to. Tax shown inside, because prices include it.":
    "Del registro de pagos, las mismas líneas de las que responden la caja y la terminal. El impuesto se muestra por dentro, porque los precios lo incluyen.",
  "Who took the money, per payment.": "Quién recibió el dinero, por cada pago.",
  "Inside those figures: tax": "Dentro de esas cifras: impuesto",
  "disposal fees": "cuotas de desecho",
  "fees": "cuotas",
  "casings": "casings",
  "charged to house accounts": "cargado a cuentas de la casa",
  "of it, to fleets": "de eso, a flotillas",
  "of the day": "del día",
  "The arithmetic": "Las cuentas",
  "The eight days to here": "Los ocho días hasta aquí",
  "The last bar is this day. Same-day-last-week is the fair fight; yesterday is just the neighbour.":
    "La última barra es este día. La comparación justa es el mismo día de la semana pasada; ayer nada más es el vecino.",
  "Against the week": "Contra la semana",
  "Read against": "Comparado contra",
  "last week": "la semana pasada",
  "7-day average": "promedio de 7 días",
  "on the 7-day average": "sobre el promedio de 7 días",
  "average": "promedio",
  "last": "último",
  "Last": "Último",
  "against": "contra",
  "by": "por",
  "When": "Cuándo",
  "Days": "Días",
  "Month": "Mes",
  "days with something on them": "días con algo en ellos",
  "Up to": "Hasta",
  "Themselves": "Ellos mismos",
  "Control": "Control",
  "Log": "Registro",
  "Hide log": "Ocultar el registro",
  "Hide the list": "Ocultar la lista",
  "Show removed": "Ver lo quitado",
  "Working…": "Trabajando…",
  "Reading the ledger…": "Leyendo el registro…",
  "Reading the days…": "Leyendo los días…",
  "Reading the account…": "Leyendo la cuenta…",
  "That is not an amount": "Eso no es una cantidad",
  "none": "ninguno",
  "None today.": "Ninguno hoy.",
  "Nothing in this window.": "Nada en este periodo.",
  "Nothing recorded in this window.": "No se registró nada en este periodo.",
  "Nothing collected in this window.": "No se cobró nada en este periodo.",
  "Nothing sold in this window.": "No se vendió nada en este periodo.",
  "No tickets in this window.": "No hay tickets en este periodo.",
  "No named customers in this window.": "No hay clientes con nombre en este periodo.",
  "No payments yet.": "Todavía no hay pagos.",
  "No products sold.": "No se vendieron productos.",
  "No service lines.": "No hay líneas de servicio.",
  "Nobody credited yet.": "Todavía no se le ha acreditado a nadie.",
  ", is bucketed by the shop's own business day, and excludes voided tickets except where they are being counted.":
    ", se agrupa por el día de trabajo del taller, y no cuenta los tickets cancelados salvo donde se están contando.",

  // ── Tickets, sales and voids ───────────────────────────────────────────
  "Completed": "Terminados",
  "Still open": "Todavía abiertos",
  "Completed but not fully paid": "Terminados pero no pagados por completo",
  "Completed is the day's work; open is not counted anywhere yet; voided nets to zero by construction and is listed by name below.":
    "Terminados es el trabajo del día; los abiertos todavía no se cuentan en ningún lado; los cancelados quedan en cero por construcción y se listan por nombre abajo.",
  "Voids, by name": "Cancelaciones, por nombre",
  "Nothing was voided.": "No se canceló nada.",
  "Nothing was discounted.": "No se dio ningún descuento.",
  "No voids, no refunds, no discounts — nothing left the day after being rung.":
    "Sin cancelaciones, sin devoluciones, sin descuentos — nada se salió del día después de haberse cobrado.",
  "after discount of": "después de un descuento de",
  "It now comes to": "Ahora suma",
  "becomes": "queda en",
  "was reopened.": "se volvió a abrir.",
  "Add what is missing, or close it again as it stands.":
    "Agregue lo que falta, o ciérrelo otra vez tal como está.",
  "closing it leaves": "cerrarlo deja",
  "is already collected on it.": "ya está cobrado en él.",
  "overpaid.": "pagado de más.",
  "ticket": "ticket",
  "lines": "líneas",
  "What sold": "Qué se vendió",
  "Best sellers today": "Lo más vendido hoy",
  "Best services today": "Mejores servicios hoy",
  "Service lines": "Líneas de servicio",
  "Materials only": "Solo materiales",
  "— what the job consumes. Not wages: those are a cost of opening the doors and do not change with one more repair.":
    "— lo que consume el trabajo. No los sueldos: esos son un costo de abrir las puertas y no cambian por una reparación más.",
  "Times sold": "Veces vendido",
  "Tire attachment": "Llantas por ticket",
  "Tires against service is this shop's parts-against-labor. The attachment rate is the day's best selling question: of everyone who came in, how many left on new tires?":
    "Llantas contra servicio es el refacciones-contra-mano-de-obra de este taller. El porcentaje es la mejor pregunta de venta del día: de todos los que entraron, ¿cuántos se fueron con llantas nuevas?",
  "of tickets carried a new tire": "de los tickets llevó una llanta nueva",
  "no name": "sin nombre",
  "no name taken": "no se tomó nombre",
  "Bounded by how many tickets took a name at all — the figures below describe only those.":
    "Limitado por cuántos tickets tomaron un nombre siquiera — las cifras de abajo describen nada más a esos.",
  "What keeps coming back": "Lo que sigue regresando",
  "None of these is wrong by itself. What matters is the shape — one name against most of them, or a month where the count doubles.":
    "Ninguno de estos está mal por sí solo. Lo que importa es la forma — un mismo nombre en la mayoría, o un mes donde la cuenta se duplica.",

  // ── People and hours ───────────────────────────────────────────────────
  "Technicians": "Técnicos",
  "person": "persona",
  "people": "personas",
  "Hours on the clock": "Horas en el reloj",
  Hours: "Horas",
  // Not their wage — what they SOLD in each hour they were on the clock.
  "Sold per hour": "Vendido por hora",
  // This one IS the wage: hours on the clock × their rate.
  "Cost of the shift": "Costo del turno",
  "No pay recorded for this person": "No hay pago registrado para esta persona",
  "not set": "sin registrar",
  "All clocked out.": "Todos con salida marcada.",
  "Nobody clocked in.": "Nadie marcó entrada.",
  "still on": "todavía dentro",
  "clocked out; the rest auto-closed at 9pm and is an estimate":
    "con salida marcada; al resto se le cerró solo a las 9 de la noche y es un estimado",
  "No clocked-out hours to divide by": "No hay horas con salida marcada entre las cuales dividir",
  "Per person, off the same lines the leaderboard reads. Revenue per hour uses only hours somebody actually clocked out of — the share that is still an auto-close guess is stated rather than folded in.":
    "Por persona, de las mismas líneas que lee la tabla de posiciones. La venta por hora usa nada más las horas de las que alguien de verdad marcó salida — la parte que sigue siendo un cierre automático se dice aparte en vez de mezclarse.",

  // ── Money owed ─────────────────────────────────────────────────────────
  "Unpaid balances": "Saldos sin pagar",
  "Owed": "Se debe",
  "Owed now": "Se debe ahora",
  "Owed at the start": "Se debía al empezar",
  "Owed to the shop": "Se le debe al taller",
  "owed on tickets": "debido en tickets",
  "owing to account": "debido a la cuenta",
  "on the account": "en la cuenta",
  "outstanding": "pendiente",
  "nothing owed": "no se debe nada",
  "owes": "debe",
  "to collect.": "por cobrar.",
  "Payments received": "Pagos recibidos",
  "Charged": "Cobrado",
  "Charges": "Cargos",
  "charges": "cargos",
  "charge": "cargo",
  "Charged, all time": "Cobrado, desde siempre",
  "Charged to fleets": "Cobrado a flotillas",
  "Not just today's — everything standing, aged. Money owed for ninety days is a different fact from money owed since Tuesday.":
    "No nada más lo de hoy — todo lo pendiente, por antigüedad. Dinero debido desde hace noventa días es un hecho distinto a dinero debido desde el martes.",
  "Two columns because they are chased by different people. A ticket balance is settled at the register; a house account is settled monthly.":
    "Dos columnas porque las persiguen personas distintas. Un saldo de ticket se salda en la caja; una cuenta de la casa se salda cada mes.",
  "Sold is what was charged for. Collected is what came in — a deposit today on last week's order is in one and not the other.":
    "Vendido es lo que se cobró. Cobrado es lo que entró — un anticipo hoy sobre un pedido de la semana pasada está en uno y no en el otro.",
  "Over the same window as everything else on this page — not the close-out's week.":
    "Sobre el mismo periodo que todo lo demás en esta página — no la semana del corte.",
  "Nothing charged in this period.": "No se cobró nada en este periodo.",
  "Nothing charged for this driver.": "No se le cobró nada a este chofer.",
  "Statement": "Estado de cuenta",
  "Statement of account": "Estado de cuenta",

  // ── Companies, drivers and vehicles ────────────────────────────────────
  "Companies": "Empresas",
  "companies": "empresas",
  "company": "empresa",
  "Company account": "Cuenta de empresa",
  "Company email": "Correo de la empresa",
  "account": "cuenta",
  "This is a company others can be billed to": "Esta es una empresa a la que se le puede cargar",
  "billed to the company": "cargado a la empresa",
  "Bill to": "Cargar a",
  "Billed to": "Cargado a",
  "Billing details": "Datos de facturación",
  "Save billing details": "Guardar los datos de facturación",
  "Who to bill — name": "A quién cobrarle — nombre",
  // The envelope line, not a word — "Atención:" is what goes on the statement.
  Attn: "Atención",
  "Street address": "Dirección",
  "Their email": "Su correo",
  "Their phone": "Su teléfono",
  "Where the statement goes, and who settles it. Printed on the company's statement.":
    "A dónde va el estado de cuenta, y quién lo paga. Se imprime en el estado de cuenta de la empresa.",
  "Nobody is billed to this account yet.": "Todavía no se le carga a nadie en esta cuenta.",
  "not approved": "no aprobada",
  "not approved for credit": "no aprobada para crédito",
  "Driver": "Chofer",
  "driver": "chofer",
  "drivers": "choferes",
  "Drivers on this account": "Choferes en esta cuenta",
  "Vehicles": "Vehículos",
  "vehicle": "vehículo",
  "vehicles": "vehículos",
  "Add a car": "Agregar un carro",

  // ── The racks ──────────────────────────────────────────────────────────
  "Tires on tickets": "Llantas en tickets",
  "Tires off the racks": "Llantas salidas del rack",
  "Did the racks move in step": "¿Se movió el rack igual?",
  "A sold tire leaves a line on the ticket and a movement on the stock ledger, written by different code. When the two counts agree, no tire left the building unrecorded.":
    "Una llanta vendida deja una línea en el ticket y un movimiento en el inventario, escritos por código distinto. Cuando las dos cuentas coinciden, ninguna llanta salió del taller sin quedar registrada.",
  "oversold": "vendidas de más",
  "Oversells to review": "Ventas de más por revisar",
  "sold today as orders, not yet fitted": "vendidas hoy como pedido, todavía sin montar",
  "fitted today for tickets rung on earlier days":
    "montadas hoy para tickets cobrados en días anteriores",
  "booked today against other days' tickets": "cargadas hoy contra tickets de otros días",
  "That is the special-order cycle working, not stock walking.":
    "Eso es el ciclo de pedidos especiales funcionando, no inventario caminándose.",
  "manual stock adjustments today — each one is on the movements ledger with a name on it.":
    "ajustes manuales de inventario hoy — cada uno está en el registro de movimientos con un nombre.",
  "Moved in / out": "Entradas / salidas",
  "Last in": "Última entrada",
  "New today": "Nuevas hoy",
  "Received today": "Recibidas hoy",
  "Last tires received": "Últimas llantas recibidas",
  "Nothing has been received yet.": "Todavía no se ha recibido nada.",
  "received on this invoice": "recibidas en esta factura",
  "More from this invoice": "Más de esta factura",
  "Receive": "Recibir",
  "Receive & next": "Recibir y siguiente",
  "deliveries": "entregas",
  "Nothing on the racks.": "Nada en el rack.",
  "Nothing has moved. This tire has never been received or sold.":
    "No se ha movido nada. Esta llanta nunca se ha recibido ni vendido.",
  "Everything that happened to this tire": "Todo lo que le pasó a esta llanta",
  "Taken": "Quitadas",
  "Taken off the stock list": "Quitada de la lista de inventario",
  "removed": "quitada",
  "Put back": "Regresar",
  "Put it back": "Regresarla",
  "put it back to": "regresarla a",
  "moved to": "movida a",
  "tires": "llantas",
  "Stock is valued at what it actually cost — the weighted average of everything received — not at what the next one is expected to cost.":
    "El inventario se valúa a lo que de verdad costó — el promedio ponderado de todo lo recibido — no a lo que se espera que cueste la próxima.",
  "Stock and what is owed": "Inventario y lo que se debe",

  // ── What to order, and what is standing still ──────────────────────────
  "To-do": "Pendientes",
  "Order": "Pedido",
  "What to order": "Qué pedir",
  "what to order": "qué pedir",
  "money standing still, and what to keep stocked": "dinero parado, y qué mantener en existencia",
  "Sizes at their reorder point, and sizes selling faster than they are stocked. Take it to the phone.":
    "Medidas en su punto de pedido, y medidas que se venden más rápido de lo que se surten. Llévelo al teléfono.",
  "At or under the reorder point": "En o abajo del punto de pedido",
  "At or under the reorder point, with how fast it has been going.":
    "En o abajo del punto de pedido, con qué tan rápido ha estado saliendo.",
  "A level somebody set on the tire, now breached. The short, certain list.":
    "Un nivel que alguien le puso a la llanta, ya rebasado. La lista corta y segura.",
  "Nothing is at its reorder point.": "Nada está en su punto de pedido.",
  "Nothing has breached its level.": "Nada ha rebasado su nivel.",
  "Level": "Nivel",
  "Set the reorder point to": "Poner el punto de pedido en",
  "Use the suggested level": "Usar el nivel sugerido",
  "Suggested": "Sugerido",
  "A reorder level is a whole number of tires, or blank for none.":
    "Un punto de pedido es un número entero de llantas, o vacío para ninguno.",
  "Could not set that reorder point": "No se pudo poner ese punto de pedido",
  "Stop watching this size": "Dejar de vigilar esta medida",
  "Worked out from the rate of sale, whether or not anybody set a level. Type a Keep level to have the alarm watch this size — the suggestion beside the box fills it in, and ✕ or an empty box stops watching.":
    "Calculado según qué tan rápido se vende, haya o no un nivel puesto. Escriba un nivel para que la alerta vigile esta medida — la sugerencia junto a la casilla lo llena, y la ✕ o dejarla vacía deja de vigilarla.",
  "Selling faster than it is stocked": "Se vende más rápido de lo que se surte",
  "to bring the racks back to where they should be.": "para regresar el rack a donde debería estar.",
  "Missed": "Perdidas",
  "Two different qualities of evidence, kept apart. A recorded lost sale is somebody watching a customer leave; an empty search is a keystroke.":
    "Dos calidades distintas de evidencia, separadas a propósito. Una venta perdida anotada es alguien viendo irse a un cliente; una búsqueda vacía es una tecla.",
  "No answer": "Sin respuesta",
  "Unanswered": "Sin respuesta",
  "unanswered": "sin respuesta",
  "nobody has answered": "nadie ha contestado",
  "They answered": "Contestaron",
  "Never sold": "Nunca vendida",
  "never sold": "nunca vendida",
  "Sizes on the racks that have never sold a single unit — the hardest cases first.":
    "Medidas en el rack que nunca han vendido ni una sola pieza — los casos más difíciles primero.",
  "that have never sold a unit.": "que nunca han vendido una pieza.",
  "Sold, 90 days": "Vendidas, 90 días",
  "Every size on the racks with no sale in the window — oldest sleeper first.":
    "Cada medida en el rack sin una venta en el periodo — la más dormida primero.",
  "Everything on the racks has moved recently.": "Todo en el rack se ha movido hace poco.",
  "no sale in": "sin venta en",
  "On the racks, not sold in 45 days. Ranked by what it cost rather than by how long — the question is where the cash is.":
    "En el rack, sin venderse en 45 días. Ordenado por lo que costó y no por cuánto tiempo lleva — la pregunta es dónde está el dinero.",
  "45 days": "45 días",
  "90 days": "90 días",
  "120 days": "120 días",

  // ── What things cost ───────────────────────────────────────────────────
  "What things cost": "Cuánto cuestan las cosas",
  "At cost": "A costo",
  "Costs us, each": "Nos cuesta, cada una",
  "Sells for": "Se vende en",
  "Fill these in": "Llene estos",
  "Tires with no cost": "Llantas sin costo",
  "These have sold and the shop has never recorded what it paid for them. A tire's cost is set on the tire itself, in Inventory.":
    "Estas se vendieron y el taller nunca anotó lo que pagó por ellas. El costo de una llanta se pone en la llanta misma, en Inventario.",
  "Give all of them a cost at 20% markup": "Darles a todas un costo con 20% de margen",
  "Margin is worked out only on the lines that carry a cost, and the tax is taken out of the price first — the shop never kept that part.":
    "El margen se calcula nada más sobre las líneas que traen costo, y primero se le quita el impuesto al precio — esa parte el taller nunca se la quedó.",
  "Gross Margin on the Reports tab is worked out only over the part that can. Below about a fifth it shows no figure at all, because a margin over a fifth of the shop is not a margin for the shop. Filling these in raises it.":
    "El Margen Bruto en la pestaña de Reportes se calcula nada más sobre la parte que se puede. Abajo de más o menos una quinta parte no muestra ninguna cifra, porque un margen sobre una quinta parte del taller no es un margen del taller. Llenar estos lo sube.",
  "assumed: tires with no cost recorded, counted at the shop's posted markup and no better":
    "supuesto: llantas sin costo anotado, contadas al margen que el taller tiene puesto y nada mejor",
  "of the last year's takings has a cost the shop recorded":
    "de lo vendido el año pasado tiene un costo que el taller anotó",

  // ── New Sales ──────────────────────────────────────────────────────────
  "Rings by itself": "Se agrega solo",
  "Waits for Add": "Espera a Agregar",
  "What was it? (optional)": "¿Qué fue? (opcional)",
  "Your account can't ring sales.": "Su cuenta no puede cobrar ventas.",
  "The shop is buying, so the selling controls are put away. Type what you are buying and what you are paying for it on the right, add as many lines as you need, then pay out.":
    "El taller está comprando, así que los controles de venta se guardan. Escriba qué está comprando y cuánto está pagando por ello a la derecha, agregue las líneas que necesite, y luego pague.",
  "None of it counts as a sale: no commission, no technician, and nobody's week moves. It comes out of the drawer and shows on the close-out.":
    "Nada de esto cuenta como venta: sin comisión, sin técnico, y la semana de nadie se mueve. Sale de la caja y aparece en el corte.",
  "Cash leaves the drawer. This is not a sale: it earns no commission and counts against nobody's week.":
    "El efectivo sale de la caja. Esto no es una venta: no gana comisión y no cuenta contra la semana de nadie.",
  "Not on the rack? Order it in": "¿No está en el rack? Pídala",
  "Is the client leaving their vehicle?": "¿El cliente va a dejar su vehículo?",
  "Whatever you write shows on the ticket and the receipt. It still counts as Other on the leaderboard — a name here is a note, not somebody on the payroll.":
    "Lo que escriba aparece en el ticket y en el recibo. De todos modos cuenta como Otro en la tabla de posiciones — un nombre aquí es una nota, no alguien en la nómina.",
  "We have it": "Ya la tenemos",
  "Take the money as normal. It stays on the Outstanding panel even once it is paid.":
    "Cobre normal. Se queda en el panel de Pendientes aunque ya esté pagado.",
  "It stays on the Outstanding panel until somebody says it is done, paid or not.":
    "Se queda en el panel de Pendientes hasta que alguien diga que está listo, pagado o no.",
  "earlier entry": "captura anterior",
  "earlier entries": "capturas anteriores",

  /*
    ── The unsorted used-tire pile ────────────────────────────────────────

    "El montón" for the pool, not "la reserva" or "el fondo general". It is a
    physical heap of tires somebody walks up to and counts, and the word has to
    be the one that gets used while standing next to it.
  */
  "18-wheeler or specialty": "Tráiler o especial",
  "Semi, trailer, tow truck, mower. Keeps it in its own section at the end of the sheet instead of among the passenger sizes.":
    "Tráiler, caja, grúa, podadora. La mantiene en su propia sección al final de la hoja en vez de entre las medidas de carro.",
  "General pool": "Montón general",
  "bought by the load — listed by size as somebody works through it":
    "compradas por camionada — se apuntan por medida conforme alguien las va revisando",
  "Used Tires (Pool)": "Llantas usadas (montón)",
  "A whole load, no sizes yet": "Una camionada entera, todavía sin medidas",
  "Goes to the general pool. Somebody can list them by size later, and the pool comes down as they do.":
    "Se va al montón general. Después alguien las puede apuntar por medida, y el montón va bajando conforme lo hace.",
  "Used tires not yet listed by size": "Llantas usadas todavía sin apuntar por medida",
  "Bought by the load, so nobody has written a size on them yet. As they get listed by size the count here comes down — tick “Listing tires we already have” when you receive them.":
    "Se compran por camionada, así que todavía nadie les ha apuntado la medida. Conforme se van apuntando por medida, esta cuenta va bajando — marque “Apuntando llantas que ya tenemos” cuando las reciba.",
  "Nothing waiting. Every used tire the shop has is listed by size — when a load comes in with no sizes on it, it goes here first.":
    "No hay nada pendiente. Todas las llantas usadas del taller están apuntadas por medida — cuando llegue una camionada sin medidas, primero cae aquí.",
  "A load came in": "Llegó una camionada",
  "List some by size": "Apuntar algunas por medida",
  "A load, no sizes": "Una camionada, sin medidas",
  "A load of used tires, no sizes yet": "Una camionada de llantas usadas, todavía sin medidas",
  "Type how many came off the truck. Somebody can list them by size later, and the count here comes down as they do.":
    "Escriba cuántas bajaron del camión. Después alguien las puede apuntar por medida, y esta cuenta va bajando conforme lo hace.",
  "on the pile now": "en el montón ahora",
  "on the pile": "en el montón",
  "Listing tires we already have": "Apuntando llantas que ya tenemos",
  "These came off the unsorted pile — take them off it. Leave it off for a buyback or anything genuinely arriving.":
    "Estas salieron del montón sin apuntar — descuéntelas de ahí. Déjelo sin marcar si es una compra a un cliente o cualquier cosa que de verdad esté llegando.",
  "The pile was empty for": "El montón ya no alcanzó para",
  "of those, so only the rest came off it. They are all counted on the size either way — the pile was either counted light when it came in, or these came from somewhere else.":
    "de esas, así que nada más el resto se descontó de ahí. De todos modos todas quedan contadas en la medida — o el montón se contó corto cuando llegó, o estas vinieron de otro lado.",
  "This one is off the pile that has no sizes on it. If you can read the size off the tire, ring that size instead — it is the only way the shop ever finds out what it sells.":
    "Esta sale del montón que no tiene medidas apuntadas. Si alcanza a leer la medida en la llanta, cóbrela con esa medida — es la única manera de que el taller se entere de qué vende.",
  "A used tire is recorded by size only. No brand, price or cost — the price is set at the counter when it sells.":
    "Una llanta usada se registra nada más por medida. Sin marca, sin precio y sin costo — el precio se decide en el mostrador cuando se vende.",

  /*
    ── How many people the week needs ─────────────────────────────────────

    "Clientes" rather than "tickets" throughout this section, because it is the
    only report in the app counting PEOPLE arriving rather than paperwork — the
    whole question is how many hands are needed to serve them, and the word has
    to carry that.
  */
  "How many people the week needs": "Cuánta gente necesita la semana",
  "Customers to expect in each hour, and the cover that takes. The shape is counted off every ticket; the number of people needs one thing the tickets cannot say — how long a job takes — so pick the line that matches the bay.":
    "Cuántos clientes esperar en cada hora, y cuánta gente se necesita para atenderlos. La forma se cuenta de cada ticket; el número de personas necesita algo que los tickets no dicen — cuánto tarda un trabajo — así que escoja la línea que se parezca a lo que pasa en el taller.",
  "Customers to expect, hour by hour": "Clientes que esperar, hora por hora",
  "Averages over the window, not totals — what to expect in that hour on that day.":
    "Promedios del periodo, no totales — lo que se espera a esa hora de ese día.",
  "Technicians needed at the busiest hour": "Técnicos que se necesitan en la hora más pesada",
  "Rounded up — half a technician cannot fit a tire, and the cost of rounding down is a customer in the lobby.":
    "Redondeado hacia arriba — medio técnico no monta una llanta, y redondear hacia abajo se paga con un cliente esperando en la sala.",
  "If one handles": "Si uno atiende",
  "an hour": "por hora",
  "customer": "cliente",
  "customers": "clientes",
  "Busiest days first": "Los días más pesados primero",
  "The order to staff them in. The gap top to bottom is the argument for moving somebody's day off.":
    "El orden en que hay que cubrirlos. La diferencia entre el primero y el último es el argumento para mover el día de descanso de alguien.",
  "busiest at": "más pesado a las",
  "The shop cannot work out its own pace yet.": "El taller todavía no puede calcular su propio ritmo.",
  "Over this window the time clock recorded": "En este periodo el reloj registró",
  "technician hours": "horas de técnico",
  ", which is not enough to divide": ", que no alcanza para dividir",
  "customers by. Everything below is still counted from real tickets — only the last table needs you to pick a line rather than being told one. If the technicians clocked in and out, this would answer itself.":
    "clientes. Todo lo de abajo se sigue contando de tickets reales — nada más la última tabla necesita que usted escoja una línea en vez de que se la digan. Si los técnicos marcaran entrada y salida, esto se contestaría solo.",
  "Open the printable staffing report": "Abrir el reporte de personal para imprimir",
  "These are the customers we served, not the ones who wanted serving.":
    "Estos son los clientes que sí atendimos, no los que querían que los atendiéramos.",
  "Somebody who saw the wait and drove off left no ticket, so they are in none of these squares. The busier an hour is the more it turns away, which means the busiest hours are the most understated — read every figure here as a floor rather than as demand.":
    "Quien vio la espera y se fue no dejó ticket, así que no está en ninguno de estos cuadros. Entre más pesada la hora, más gente se va — o sea que las horas más pesadas son las que más se quedan cortas. Lea cada cifra de aquí como un mínimo, no como la demanda real.",

  /*
    ── The ticket drawer and the cash counter ─────────────────────────────

    These live in src/components/pos, which the audit script did not walk until
    now — so a whole modal could read as fully translated while being entirely
    English. Several of these are FRAGMENTS assembled around a figure in JSX
    ("Move the" · $5.00 · "tip to somebody else"), so each half is written to
    sit correctly around the number rather than as a sentence on its own.
  */
  "Fix something on this ticket": "Corregir algo en este ticket",
  "What this line says": "Lo que dice esta línea",
  "Correct what this line says, how many, or the price":
    "Corregir lo que dice esta línea, cuántas, o el precio",
  "Show corrections": "Ver correcciones",
  "Hide corrections": "Ocultar correcciones",
  "Show every correction made to this ticket":
    "Ver todas las correcciones hechas a este ticket",
  "Hide the corrections and show the ticket as it stands":
    "Ocultar las correcciones y ver el ticket como quedó",
  "corrected row hidden": "línea corregida oculta",
  "corrected rows hidden": "líneas corregidas ocultas",
  "open the eye above to see them": "abra el ojo de arriba para verlas",

  // "Move the" · $5.00 · "tip to somebody else"
  "Move the": "Pasarle los",
  "tip to somebody else": "de propina a otra persona",
  // "Credited to" · NAME · " right now."
  "Credited to": "Acreditada a",
  " right now.": " ahora mismo.",
  "It comes off them and goes to whoever you pick, for the same amount, on the day it was rung — the ticket and the day's takings do not change.":
    "Se le quita a esa persona y se le pasa a quien usted escoja, por la misma cantidad, en el día en que se cobró — el ticket y lo vendido del día no cambian.",
  "Move it": "Pasarla",
  "Pick a technician": "Escoja un técnico",
  "Nobody is on this ticket — who is the tip for?":
    "No hay nadie en este ticket — ¿para quién es la propina?",
  "Choose somebody…": "Escoja a alguien…",
  nobody: "nadie",

  "Reopen it": "Volver a abrirlo",
  "Reopen this ticket to add lines": "Volver a abrir este ticket para agregar líneas",
  "The ticket goes back to open so lines can be added. The payments stay where they are and the tires already fitted stay out of stock — finishing it again only books what you add.":
    "El ticket regresa a abierto para poder agregarle líneas. Los pagos se quedan donde están y las llantas ya montadas siguen fuera del inventario — al cerrarlo otra vez solo se registra lo que usted agregue.",
  // "It has" · $60.00 · "collected on it, which stays collected."
  "It has": "Tiene",
  "collected on it, which stays collected.": "cobrados, y cobrados se quedan.",
  // "This ticket belongs to" · DATE · ", not today" — ...
  "This ticket belongs to": "Este ticket es del",
  "not today": "no de hoy",
  "that day has already been counted, and adding to it changes what it sold.":
    "ese día ya se contó, y agregarle algo cambia lo que vendió.",
  "Close it again as it is": "Cerrarlo otra vez tal como está",
  Financing: "Financiamiento",

  // The cash counter.
  "Count the drawer": "Contar la caja",
  "Count the drawer note by note": "Contar la caja billete por billete",
  "Type how many of each you have. Leave a row empty if you have none of it — the total adds itself up as you go.":
    "Escriba cuántos tiene de cada uno. Deje la línea vacía si no tiene ninguno — el total se va sumando solo.",
  "Comes to": "Suma",
  Bills: "Billetes",
  Coin: "Moneda",
  Coins: "Monedas",
  "In the drawer": "En la caja",
  "Start over": "Empezar de nuevo",
  Use: "Usar",

  /*
    ── The staffing report, printable in Spanish ──────────────────────────

    A whole DOCUMENT rather than screen furniture, and the first one in this app
    that prints in either language. The rule stated at the top of this file — the
    paperwork stays English — holds for the close-out sheet and the receipts,
    which are filed and handed to an accountant. This one is handed to a
    technician to explain a rota, so it goes out in the language that person
    reads.

    Long paragraphs are kept whole where the markup allows and split only where a
    <strong> sits inside them; the split halves are written to read correctly
    when assembled, not as sentences on their own.
  */
  "Reading the weeks…": "Leyendo las semanas…",
  Staffing: "Personal",
  "Staffing — how many people the week needs":
    "Personal — cuánta gente necesita la semana",
  Covers: "Abarca",
  Printed: "Impreso",
  "The bottom line": "En resumen",

  "These are the customers the shop SERVED — not the ones who wanted serving":
    "Estos son los clientes que el taller SÍ atendió — no los que querían que los atendieran",
  "Every figure here is counted off tickets, and a ticket only exists for somebody who waited. The customer who looked at the queue on a Saturday morning and drove to the shop down the road left no ticket and no trace, so they are not in any of these squares.":
    "Cada cifra de aquí se cuenta de los tickets, y un ticket solo existe para alguien que esperó. El cliente que vio la fila un sábado en la mañana y se fue al taller de la otra cuadra no dejó ticket ni rastro, así que no está en ninguno de estos cuadros.",
  "That does not cut both ways.": "Y esto no funciona en los dos sentidos.",
  "The busier an hour is, the more people it turns away — so the busiest hours are the ones most understated, which is exactly where this report is being used to decide cover.":
    "Entre más pesada la hora, más gente se va — así que las horas más pesadas son justo las que más se quedan cortas, y son exactamente las que este reporte usa para decidir cuánta gente poner.",
  "Read every number below as a floor.": "Lea cada número de abajo como un mínimo.",
  "The real demand at the peak is higher by however many people left, and nobody knows that figure.":
    "La demanda real en la hora pico es más alta por toda la gente que se fue, y esa cifra nadie la sabe.",

  "The average number of customers who walk in during each hour of each day, counted off every ticket the shop rang over this window. Darker is busier. This is the part of the report that is measured rather than assumed.":
    "El promedio de clientes que entran en cada hora de cada día, contado de cada ticket que el taller cobró en este periodo. Más oscuro es más pesado. Esta es la parte del reporte que está medida, no supuesta.",
  "All day": "Todo el día",
  "Averages, not totals — what to expect on a given day, not what happened across the whole window. The reddest square is the busiest hour of the week and everything else is shaded against it. Every square counts customers served; anybody who left rather than wait is in none of them.":
    "Promedios, no totales — lo que se espera en un día cualquiera, no lo que pasó en todo el periodo. El cuadro más rojo es la hora más pesada de la semana y todo lo demás se sombrea contra ella. Cada cuadro cuenta clientes atendidos; quien se fue en vez de esperar no está en ninguno.",

  "How many technicians that takes": "Cuántos técnicos se necesitan para eso",
  "Customers per hour becomes people on the floor once you know how long a job takes. The shop knows that better than this report does, so the table gives the answer at four paces — read the line that matches what actually happens in the bay.":
    "Los clientes por hora se vuelven gente en el piso en cuanto uno sabe cuánto tarda un trabajo. El taller sabe eso mejor que este reporte, así que la tabla da la respuesta a cuatro ritmos — lea la línea que se parezca a lo que de verdad pasa en el taller.",
  "These are minimums, not targets": "Estos son mínimos, no metas",
  "Staffing one above it is how the shop finds out whether there is more work than it has been seeing.":
    "Poner una persona más de las que dice la tabla es como el taller se entera de si hay más trabajo del que ha estado viendo.",
  "Why the shop is being asked instead of told":
    "Por qué se le pregunta al taller en vez de decírselo",
  "If the technicians clocked in and out, this page would answer it by itself":
    "Si los técnicos marcaran entrada y salida, esta página lo contestaría sola",
  "If one technician handles": "Si un técnico atiende",
  "This is cover for the BUSIEST hour of each day, rounded up.":
    "Esto cubre la hora MÁS PESADA de cada día, redondeado hacia arriba.",
  "Half a technician cannot fit a tire, and the cost of rounding down is a customer sitting in the lobby. Away from the peak the same days need fewer — the grid above shows exactly where, and the difference between the two is the case for a split shift rather than a second full one.":
    "Medio técnico no monta una llanta, y redondear hacia abajo se paga con un cliente sentado en la sala. Fuera de la hora pico esos mismos días necesitan menos — la tabla de arriba muestra exactamente dónde, y la diferencia entre las dos es el argumento para un turno partido en vez de un segundo turno completo.",

  "The week, busiest day first": "La semana, el día más pesado primero",
  "The order to staff the week in. The gap between the top of this list and the bottom is the argument for moving somebody&apos;s day off.":
    "El orden en que hay que cubrir la semana. La diferencia entre el primero y el último de esta lista es el argumento para mover el día de descanso de alguien.",
  "Busiest hour": "Hora más pesada",
  "At its busiest": "En su hora pico",
  "Trading hours": "Horas abierto",
  "Against the busiest day": "Contra el día más pesado",

  "Appendix — this time of year, across every year on record":
    "Apéndice — esta época del año, en todos los años que tenemos registrados",
  Year: "Año",
  "Days traded": "Días abierto",
  "A day": "Por día",
  "All of it": "Todo junto",
  "Customers an hour, averaged over every year":
    "Clientes por hora, promediado sobre todos los años",
  "Read this against section 1 rather than instead of it.":
    "Lea esto junto con la sección 1, no en lugar de ella.",
  "Where the two agree, the shape is the shop&apos;s and it is worth rostering to. Where they differ, something has changed — and which of the two is right depends on whether the change is the season or the business.":
    "Donde las dos coinciden, esa forma es la del taller y vale la pena armar el rol con ella. Donde no coinciden, algo cambió — y cuál de las dos tiene razón depende de si lo que cambió es la temporada o el negocio.",

  "Appendix — what technicians are paid in San Antonio":
    "Apéndice — cuánto se les paga a los técnicos en San Antonio",
  "What other shops in this town were paying, as of August 2026 — for setting wages against, and for costing the cover in section 2. This is the one page here that does not come from the shop&apos;s own books.":
    "Lo que pagaban otros talleres de esta ciudad, hasta agosto de 2026 — para comparar sueldos y para costear el personal de la sección 2. Esta es la única página que no sale de los libros del taller.",
  "Role, and who is reporting it": "Puesto, y quién lo reporta",
  Hourly: "Por hora",
  "A year, full time": "Al año, tiempo completo",
  "What it covers": "Qué incluye",
  "Tire technician — San Antonio average": "Técnico de llantas — promedio de San Antonio",
  "ZipRecruiter, July 2026": "ZipRecruiter, julio 2026",
  "Most fall between": "La mayoría está entre",
  "Tire technician — Texas average": "Técnico de llantas — promedio de Texas",
  "ZipRecruiter, June 2026": "ZipRecruiter, junio 2026",
  "Slightly above the San Antonio figure": "Un poco arriba de la cifra de San Antonio",
  "Discount Tire, San Antonio": "Discount Tire, San Antonio",
  "Indeed, reported by staff": "Indeed, reportado por empleados",
  "Their own postings run $15.00–$16.00": "Sus propios anuncios van de $15.00 a $16.00",
  "Walmart Auto Care, San Antonio": "Walmart Auto Care, San Antonio",
  "ZipRecruiter and Glassdoor postings, 2026": "Anuncios de ZipRecruiter y Glassdoor, 2026",
  Advertised: "Anunciado",
  "Costco, San Antonio": "Costco, San Antonio",
  "The other big-box shop, and about the same money":
    "La otra tienda grande, y más o menos el mismo dinero",
  "Automotive service technician — San Antonio":
    "Técnico automotriz de servicio — San Antonio",
  "Indeed, May 2026": "Indeed, mayo 2026",
  "A qualified mechanic, not a tire fitter": "Un mecánico con oficio, no un llantero",
  "Automotive technician — San Antonio": "Técnico automotriz — San Antonio",
  "Glassdoor, 2026": "Glassdoor, 2026",
  "Same role, second source, higher": "Mismo puesto, otra fuente, más alto",
  "Automotive service technicians — national median":
    "Técnicos automotrices de servicio — mediana nacional",
  "US Bureau of Labor Statistics, May 2024":
    "Oficina de Estadísticas Laborales de EE.UU., mayo 2024",
  "Across the whole country": "En todo el país",
  "Two different jobs are on this table, and the gap between them is the point.":
    "En esta tabla hay dos puestos distintos, y la diferencia entre ellos es lo importante.",
  "The big-box shops sit with the mechanics, not with the tire fitters.":
    "Las tiendas grandes pagan como a mecánicos, no como a llanteros.",
  "Costing the cover.": "Lo que cuesta cubrir el turno.",
  "At the San Antonio tire-technician average of $16.00, one technician on the floor for a ten-hour day is about":
    "Al promedio de San Antonio de $16.00 para técnico de llantas, un técnico en el piso por un día de diez horas cuesta como",
  "Gathered August 2026 from ZipRecruiter, Indeed, Glassdoor and the US Bureau of Labor Statistics. Advertised and self-reported pay both run ahead of and behind what is really paid, so read these as the shape of the market rather than as quotes — and check them again before any hiring decision, because the market moves and this page does not.":
    "Recopilado en agosto de 2026 de ZipRecruiter, Indeed, Glassdoor y la Oficina de Estadísticas Laborales de EE.UU. Tanto lo anunciado como lo que reporta la gente queda arriba y abajo de lo que de verdad se paga, así que léalo como la forma del mercado y no como cotizaciones — y vuelva a revisarlo antes de contratar, porque el mercado se mueve y esta página no.",

  "Appendix — what a day costs, and when overtime starts":
    "Apéndice — cuánto cuesta un día, y cuándo empiezan las horas extra",
  "A long day is not overtime in Texas — a long WEEK is":
    "Un día largo no es hora extra en Texas — una SEMANA larga sí",
  "Texas has no overtime law of its own and follows the federal rule, which counts hours by the week rather than by the day.":
    "Texas no tiene su propia ley de horas extra y sigue la regla federal, que cuenta las horas por semana y no por día.",
  "That is worse for the shop, not better.": "Eso es peor para el taller, no mejor.",
  "Pay rate": "Sueldo por hora",
  "Straight time": "Tiempo normal",
  "At the overtime rate": "A tarifa de hora extra",
  "The difference": "La diferencia",
  "A whole week of them": "Una semana entera de esos días",
  "Read the two overtime columns before anything else.":
    "Lea las dos columnas de horas extra antes que nada.",
  "This is a rate calculation, not legal advice.":
    "Esto es un cálculo de tarifas, no una asesoría legal.",
  "It assumes an hourly, non-exempt employee on a standard workweek and ignores everything else that lands on a wage — payroll taxes, insurance, breaks, and any agreement with the employee themselves. Have an accountant confirm it before it is used to set anybody&apos;s pay. Rule checked August 2026 against the Texas Workforce Commission&apos;s position and the federal Fair Labor Standards Act.":
    "Supone un empleado por hora, no exento, en una semana laboral normal, y no incluye nada más de lo que carga un sueldo — impuestos de nómina, seguro, descansos, ni ningún acuerdo con el propio empleado. Que un contador lo confirme antes de usarlo para fijarle el pago a alguien. Regla revisada en agosto de 2026 contra la postura de la Comisión de la Fuerza Laboral de Texas y la Ley Federal de Normas Justas de Trabajo.",

  // ── Things that go wrong ───────────────────────────────────────────────
  "That did not save": "Eso no se guardó",
  "Could not load": "No se pudo cargar",
  "Not found": "No se encontró",
  "Your account can't do that.": "Su cuenta no puede hacer eso.",
  "A reason is required": "Se necesita una razón",
};

const TABLES: Record<Lang, Record<string, string>> = { en: {}, es: ES };

/**
 * Translate one string.
 *
 * English in, the chosen language out, and the English back when there is no
 * translation for it. `t` is exported bare as well as through the hook so it can
 * be used in the handful of places that are not React components.
 */
export function translate(lang: Lang, english: string): string {
  if (lang === "en") return english;
  return TABLES[lang][english] ?? english;
}

/** The label on each side of the switch. Never translated — they name themselves. */
export const LANG_LABEL: Record<Lang, string> = { en: "EN", es: "ES" };

/**
 * Where the choice is kept.
 *
 * The BROWSER rather than the employee record, and that is the right place for
 * it here: this machine is a counter in one shop, everybody who uses it reads
 * the same two languages, and tying it to a login would mean the screen flipped
 * language every time somebody unlocked it — which is worse than either
 * language on its own. One PC, one setting, changed by whoever wants it changed.
 */
export const LANG_STORAGE_KEY = "pos-lang";
