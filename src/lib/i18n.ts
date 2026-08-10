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
