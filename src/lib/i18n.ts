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
