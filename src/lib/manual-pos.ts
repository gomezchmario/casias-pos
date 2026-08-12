import type { Section } from "./manual";

/**
 * The register manual, second attempt — the thorough one.
 *
 * Written for the two people who actually have to use this, which is a
 * narrower brief than "staff". They are not slow; they have never been taught
 * that a screen is a set of parts, and nobody has ever told them what a word on
 * a button means. So this version does three things the first one did not:
 *
 *   It shows the control. A piece of the real interface goes in the paragraph,
 *   at the size and colour it really is, so "the amber grid" is not something
 *   to go and hunt for.
 *
 *   It says what just happened. After every action there is a line saying what
 *   changed and where to look for it, because the commonest question at this
 *   counter is not "how do I" — it is "did that work".
 *
 *   It explains the words. Sold, Collected, Pending, Outstanding, void, refund.
 *   Every one of those has cost somebody an afternoon.
 *
 * It is deliberately long. A manual nobody finishes is fine if the part they
 * did read was the part they needed; a short manual that leaves out the answer
 * is not.
 */
export const POS_SECTIONS: Section[] = [
  {
    title: { es: "Entrar y salir", en: "Signing in and out" },
    blocks: [
      {
        kind: "steps",
        items: [
          { es: "**Toque su nombre** en la lista. No escriba nada todavía.", en: "**Tap your name** in the list. Do not type anything yet." },
          { es: "Escriba su **PIN** de cuatro números.", en: "Type your four-digit **PIN**." },
        ],
      },
      {
        kind: "note",
        title: { es: "Qué acaba de pasar", en: "What just happened" },
        body: [
          {
            es: "El sistema ya sabe quién es usted. A partir de este momento **todo lo que haga lleva su nombre**: cada ticket, cada cobro, cada corrección. Eso no es para vigilarlo — es lo que le permite demostrar que usted no hizo algo.",
            en: "The system now knows who you are. From this moment **everything you do carries your name**: every ticket, every payment, every correction. That is not there to watch you — it is what lets you prove you did not do something.",
          },
        ],
      },
      { kind: "h3", text: { es: "Cuando se retira de la caja", en: "When you step away" } },
      {
        kind: "p",
        text: {
          es: "Toque [[Switch user]] arriba a la derecha. Si nadie toca la computadora por un rato, se bloquea sola.",
          en: "Press [[Switch user]] at the top right. If nobody touches the machine for a while it locks itself.",
        },
      },
      {
        kind: "warn",
        title: { es: "Nunca preste su PIN", en: "Never lend your PIN" },
        body: [
          {
            es: "Si otra persona usa su cuenta, lo que haga queda escrito con **su** nombre, y no hay manera de separarlo después. Si cree que alguien se lo aprendió, pida que se lo cambien el mismo día.",
            en: "If somebody else uses your account, what they do is written down under **your** name, and there is no way to separate it afterwards. If you think somebody has learned it, ask for it to be changed the same day.",
          },
        ],
      },
    ],
  },
  {
    title: { es: "Cómo está hecha la pantalla", en: "How the screen is laid out" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Antes de cualquier otra cosa: arriba de todo hay una fila de pestañas. Ésa fila no cambia nunca. Todo lo demás que ve en la pantalla cambia según la pestaña en la que esté.",
          en: "Before anything else: there is a row of tabs along the top. That row never changes. Everything else on screen changes depending on which tab you are in.",
        },
      },
      { kind: "ui", specimen: "tab-bar", caption: { es: "La fila de pestañas. La blanca es en la que está usted.", en: "The tab row. The white one is where you are." } },
      {
        kind: "p",
        text: {
          es: "La pestaña **blanca** es donde está parado. Las demás están en gris claro. Si no sabe dónde está, mire cuál está blanca.",
          en: "The **white** tab is where you are. The others are pale. If you are not sure where you are, look for the white one.",
        },
      },
      {
        kind: "table",
        head: [{ es: "Pestaña", en: "Tab" }, { es: "Qué encuentra ahí", en: "What is in it" }],
        rows: [
          [{ es: "[[Main]]", en: "[[Main]]" }, { es: "El resumen del día y las dos listas de pendientes.", en: "The day's summary and the two lists of things outstanding." }],
          [{ es: "[[New sale]]", en: "[[New sale]]" }, { es: "Donde se hace un ticket y se cobra.", en: "Where a ticket is built and money is taken." }],
          [{ es: "[[Logs]]", en: "[[Logs]]" }, { es: "Buscar cualquier ticket, de hoy o de antes.", en: "Look up any ticket, today's or older." }],
          [{ es: "[[Inventory]]", en: "[[Inventory]]" }, { es: "Qué llantas hay y a cómo.", en: "What tires are on the racks and at what price." }],
          [{ es: "[[Close-out]]", en: "[[Close-out]]" }, { es: "Contar el dinero y cerrar.", en: "Count the money and close." }],
        ],
      },
      {
        kind: "note",
        title: { es: "Si se pierde", en: "If you get lost" },
        body: [
          {
            es: "Toque [[Main]]. Siempre. Desde ahí se llega a todo y no se puede romper nada tocando esa pestaña.",
            en: "Press [[Main]]. Always. Everything is reachable from there and pressing that tab cannot break anything.",
          },
        ],
      },
    ],
  },

  {
    title: { es: "La pantalla de venta, por partes", en: "The sale screen, part by part" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Toque [[New sale]]. Antes de tocar nada más, mire cómo está partida la pantalla. Son **dos lados**, y hacen cosas distintas:",
          en: "Press [[New sale]]. Before touching anything else, look at how the screen is split. There are **two sides**, and they do different things:",
        },
      },
      { kind: "ui", specimen: "new-sale-map" },
      {
        kind: "table",
        head: [{ es: "#", en: "#" }, { es: "Qué es", en: "What it is" }, { es: "Para qué sirve", en: "What it does" }],
        rows: [
          [{ es: "1", en: "1" }, { es: "**Services | Inventory**", en: "**Services | Inventory**" }, { es: "Los dos modos. **Services** para trabajos, **Inventory** para cosas que salen del estante — llantas, baterías, sensores. Cambiar de modo cambia todo lo de abajo.", en: "The two modes. **Services** for work, **Inventory** for anything that comes off a shelf — tires, batteries, sensors. Switching modes changes everything below." }],
          [{ es: "2", en: "2" }, { es: "**PRICE** (azul)", en: "**PRICE** (navy)" }, { es: "Cantidades sueltas. Solo en modo Services.", en: "Loose amounts. Services mode only." }],
          [{ es: "3", en: "3" }, { es: "**SERVICE** (amarillo)", en: "**SERVICE** (amber)" }, { es: "Los trabajos del taller, con su nombre y su precio. Solo en modo Services.", en: "The shop's jobs, with their names and prices. Services mode only." }],
          [{ es: "4", en: "4" }, { es: "El buscador", en: "The search box" }, { es: "Aparece en modo Inventory. Ahí se escribe la medida.", en: "Appears in Inventory mode. This is where the size is typed." }],
          [{ es: "5", en: "5" }, { es: "**TICKET** (derecha)", en: "**TICKET** (right)" }, { es: "El ticket que va armando. **Se queda ahí todo el tiempo** mientras usted agrega cosas del lado izquierdo.", en: "The ticket you are building. **It stays there the whole time** while you add things from the left." }],
        ],
      },
      {
        kind: "warn",
        title: { es: "Lo más importante de esta pantalla", en: "The one thing to hold on to" },
        body: [
          {
            es: "El lado izquierdo **agrega**. El lado derecho **es el ticket**. Todo lo que toque a la izquierda cae a la derecha, en el mismo ticket, hasta que usted lo cobre. No se está haciendo un ticket nuevo cada vez que toca un botón.",
            en: "The left side **adds**. The right side **is the ticket**. Everything you press on the left drops onto the right, on the same ticket, until you charge it. You are not starting a new ticket each time you press a button.",
          },
        ],
      },
      {
        kind: "note",
        title: { es: "El número del ticket", en: "The ticket number" },
        body: [
          {
            es: "Arriba del lado derecho dice **TICKET** y un número, por ejemplo *S-2026-000118*. Ése número no cambia mientras esté armando ese ticket. Si cambia, es que empezó otro.",
            en: "The top of the right side says **TICKET** and a number, for example *S-2026-000118*. That number does not change while you are building that ticket. If it changes, you started a different one.",
          },
        ],
      },
    ],
  },

  {
    title: { es: "Dos llantas en un solo ticket", en: "Two tires on one ticket" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Un ticket **no es una cosa**. Es una lista. En un solo ticket caben todas las llantas y todos los trabajos que se le hicieron a un carro, y al final se cobra **una sola vez**.",
          en: "A ticket is **not one thing**. It is a list. One ticket holds every tire and every job done to a car, and at the end it is charged **once**.",
        },
      },
      { kind: "ui", specimen: "two-tires" },
      { kind: "h3", text: { es: "Cómo se ponen dos llantas iguales", en: "How to put two of the same tire on" } },
      {
        kind: "steps",
        items: [
          { es: "En el modo **Inventory**, busque la medida y toque la llanta. **Todavía no se agrega** — nada más queda cargada, con su precio.", en: "In **Inventory** mode, search the size and tap the tire. It is **not added yet** — it just loads, with its price." },
          { es: "En la casilla chiquita de la derecha, la que dice cuántas, **borre el 1 y escriba 2**.", en: "In the small box on the right — the how-many box — **clear the 1 and type 2**." },
          { es: "Escoja quién la montó.", en: "Pick who fitted it." },
          { es: "Toque **Add**. **Hasta ahora** se fue al ticket.", en: "Press **Add**. **Only now** does it go on the ticket." },
        ],
      },
      {
        kind: "note",
        title: { es: "Qué acaba de pasar", en: "What just happened" },
        body: [
          {
            es: "El renglón dice **2 ×** y su precio ya viene multiplicado. El Total de abajo también. Sigue siendo **un** ticket con **un** renglón — nada más que ese renglón vale por dos llantas, y el inventario va a descontar dos.",
            en: "The line reads **2 ×** with its price already multiplied. The Total below too. It is still **one** ticket with **one** line — that line just counts for two tires, and stock will take two off.",
          },
        ],
      },
      {
        kind: "warn",
        title: { es: "La cantidad se pone ANTES de Add", en: "The quantity goes in BEFORE Add" },
        body: [
          {
            es: "Ése es el orden y no se puede al revés desde aquí: busca, pone cuántas, y **luego** Add. Si ya lo agregó con la cantidad mal, se arregla desde el ticket del lado derecho tocando el renglón y usando [[How many]].",
            en: "That is the order, and it does not work the other way round from here: search, set how many, **then** Add. If it is already on with the wrong quantity, fix it from the ticket on the right by tapping the line and using [[How many]].",
          },
        ],
      },
      { kind: "h3", text: { es: "Y si son dos medidas distintas", en: "And if they are two different sizes" } },
      {
        kind: "p",
        text: {
          es: "Igual: busque la primera, ponga cuántas, **Add**. Después busque la segunda, ponga cuántas, **Add**. Quedan **dos renglones en el mismo ticket**. No hay que cerrar nada entre una y otra.",
          en: "The same: search the first, set how many, **Add**. Then search the second, set how many, **Add**. That leaves **two lines on the same ticket**. Nothing needs closing in between.",
        },
      },
      {
        kind: "warn",
        title: { es: "Nunca haga dos tickets para un solo carro", en: "Never make two tickets for one car" },
        body: [
          {
            es: "Es el error que más cuesta arreglar. Dos tickets quieren decir dos recibos, dos cobros y dos veces la misma plática con el cliente — y si uno se paga y el otro no, uno de los dos se queda en **Pending** para siempre sin que nadie sepa por qué.",
            en: "It is the costliest mistake to unpick. Two tickets means two receipts, two payments and having the same conversation with the customer twice — and if one gets paid and the other does not, one of them sits in **Pending** for ever with nobody knowing why.",
          },
          {
            es: "Un carro, una visita, **un ticket**. Aunque sean cuatro llantas, montaje, balanceo y una desechada.",
            en: "One car, one visit, **one ticket**. Even if it is four tires, mounting, balancing and a disposal.",
          },
        ],
      },
    ],
  },

  {
    title: { es: "Hacer un ticket, paso a paso", en: "Building a ticket, step by step" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Toque [[New sale]]. La pantalla se divide en dos: del lado izquierdo los botones para agregar cosas, del lado derecho el ticket que va armando.",
          en: "Press [[New sale]]. The screen splits in two: buttons for adding things on the left, the ticket you are building on the right.",
        },
      },
      { kind: "h3", text: { es: "Los botones de precio (azules)", en: "The price buttons (navy)" } },
      { kind: "ui", specimen: "quick-amounts" },
      {
        kind: "p",
        text: {
          es: "Son cantidades sueltas. Sirven para cobrar algo que no tiene nombre propio: una ayuda, un cobro rápido, lo que se acordó con el cliente. Toca el botón y ese monto se agrega al ticket.",
          en: "These are loose amounts. They are for charging something with no name of its own: a favour, a quick charge, whatever was agreed with the customer. Tap one and that amount goes on the ticket.",
        },
      },
      { kind: "h3", text: { es: "Los botones de servicio (amarillos)", en: "The service buttons (amber)" } },
      { kind: "ui", specimen: "quick-services" },
      {
        kind: "p",
        text: {
          es: "Éstos son los trabajos del taller, cada uno con su precio ya puesto. Un toque agrega el trabajo **con su nombre**, y por eso salen bien en los reportes: el sistema sabe que fue una **FLAT** y no “veinte dólares”.",
          en: "These are the shop's jobs, each with its price already set. One tap adds the job **with its name**, which is why they report properly: the system knows it was a **FLAT** and not \"twenty dollars\".",
        },
      },
      {
        kind: "warn",
        title: { es: "Azul y amarillo no son lo mismo", en: "Navy and amber are not the same" },
        body: [
          {
            es: "Si el trabajo tiene su botón amarillo, **use el amarillo**, aunque sepa el precio. Cobrar una FLAT con el botón azul de $16 le da lo mismo al cliente y le quita al taller la manera de saber cuántas flats hizo en el mes.",
            en: "If the job has an amber button, **use the amber one**, even when you know the price. Ringing a FLAT on the navy $16 button gives the customer the same total and takes away the shop's only way of knowing how many flats it did that month.",
          },
        ],
      },
      { kind: "h3", text: { es: "Agregar una llanta", en: "Adding a tire" } },
      {
        kind: "steps",
        items: [
          { es: "Escriba la medida en el buscador — por ejemplo *205 60 16*. No necesita guiones ni la R.", en: "Type the size in the search box — for example *205 60 16*. No dashes or R needed." },
          { es: "Aparece la lista de las que hay. Cada una dice cuántas quedan.", en: "The list of what is on the racks appears. Each says how many are left." },
          { es: "Toque la que va a vender. Se carga con su precio, **pero todavía no está en el ticket**.", en: "Tap the one you are selling. It loads with its price, **but is not on the ticket yet**." },
          { es: "Ponga cuántas y quién la montó, y toque **Add**.", en: "Set how many and who fitted it, then press **Add**." },
        ],
      },
      {
        kind: "note",
        title: { es: "Qué acaba de pasar", en: "What just happened" },
        body: [
          {
            es: "La llanta se agregó al ticket del lado derecho. **Todavía no sale del estante** — eso pasa hasta que se cobra o se cierra el ticket. Si se equivocó, quítela y no pasó nada.",
            en: "The tire went onto the ticket on the right. It has **not left the racks yet** — that happens when the ticket is paid or closed. If you picked the wrong one, take it off and nothing has happened.",
          },
        ],
      },
    ],
  },

  {
    title: { es: "El ticket del lado derecho", en: "The ticket on the right" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Cada cosa que agrega aparece como un renglón. Así se ve:",
          en: "Everything you add shows as a line. It looks like this:",
        },
      },
      { kind: "ui", specimen: "ticket-lines" },
      {
        kind: "list",
        items: [
          { es: "**Arriba, en negro:** qué es.", en: "**Top, in dark type:** what it is." },
          { es: "**Abajo, en gris:** cuántos, a cómo, y **quién lo hizo**.", en: "**Below, in grey:** how many, at what price, and **who did it**." },
          { es: "**A la derecha:** lo que suma ese renglón.", en: "**On the right:** what that line comes to." },
          { es: "**Hasta abajo:** el **Total** del ticket.", en: "**At the bottom:** the ticket **Total**." },
        ],
      },
      {
        kind: "warn",
        title: { es: "El renglón sin técnico", en: "The line with no technician" },
        body: [
          {
            es: "En el ejemplo de arriba, el segundo renglón dice **sin técnico** en rojo. Eso es un renglón al que nadie le puso nombre. Se puede cobrar así, pero ese trabajo no le cuenta a nadie: no sale en el tablero de la pared y no cuenta para propinas. Póngale el técnico antes de cobrar.",
            en: "In the example above the second line reads **sin técnico** in red. That is a line nobody has been put on. It can still be charged, but the work counts for nobody: it does not reach the wall board and it does not count towards tips. Name the technician before you charge.",
          },
        ],
      },
      { kind: "h3", text: { es: "Cambiar un renglón", en: "Changing a line" } },
      {
        kind: "table",
        head: [{ es: "Para", en: "To" }, { es: "Haga esto", en: "Do this" }, { es: "Qué pasa", en: "What happens" }],
        rows: [
          [{ es: "Cambiar la cantidad", en: "Change the quantity" }, { es: "Toque el renglón y use [[How many]]", en: "Tap the line and use [[How many]]" }, { es: "El renglón y el Total se recalculan solos.", en: "The line and the Total recalculate themselves." }],
          [{ es: "Cambiar el precio", en: "Change the price" }, { es: "[[Change the price]]", en: "[[Change the price]]" }, { es: "Queda anotado que se cambió, y sale en el corte de la noche.", en: "The change is recorded and appears on the night's close-out." }],
          [{ es: "Quitar el renglón", en: "Remove the line" }, { es: "Toque el renglón y quítelo", en: "Tap the line and remove it" }, { es: "Desaparece. Antes de cobrar, no deja rastro.", en: "It goes. Before the ticket is charged, it leaves no trace." }],
          [{ es: "Poner el técnico", en: "Set the technician" }, { es: "Toque el renglón y escoja el nombre", en: "Tap the line and pick the name" }, { es: "El nombre aparece en gris debajo del renglón.", en: "The name appears in grey under the line." }],
        ],
      },
    ],
  },

  {
    title: { es: "Cobrar", en: "Taking the money" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Cuando el ticket ya está completo, escoja **con qué va a pagar** el cliente. Los botones de forma de pago se ven así:",
          en: "Once the ticket is complete, pick **how the customer is paying**. The tender buttons look like this:",
        },
      },
      { kind: "ui", specimen: "tenders", caption: { es: "El azul oscuro es el que está escogido.", en: "The dark one is the one selected." } },
      {
        kind: "table",
        head: [{ es: "Botón", en: "Button" }, { es: "Cuándo se usa", en: "When to use it" }],
        rows: [
          [{ es: "Cash", en: "Cash" }, { es: "Billetes y monedas.", en: "Notes and coin." }],
          [{ es: "Credit Card", en: "Credit Card" }, { es: "Tarjeta en la terminal.", en: "A card on the terminal." }],
          [{ es: "SNAP", en: "SNAP" }, { es: "Financiamiento. El cliente se lleva las llantas y le paga a la financiera, no al taller.", en: "Financing. The customer takes the tires and pays the finance company, not the shop." }],
          [{ es: "PO Shop", en: "PO Shop" }, { es: "Orden de compra.", en: "Purchase order." }],
          [{ es: "Credit Account", en: "Credit Account" }, { es: "Se le carga a la cuenta del cliente. **Hoy no entra dinero.**", en: "Charged to the customer's account. **No money arrives today.**" }],
          [{ es: "Other", en: "Other" }, { es: "Cualquier otra cosa.", en: "Anything else." }],
        ],
      },
      { kind: "h3", text: { es: "Las tres maneras de terminar un ticket", en: "The three ways a ticket can end" } },
      { kind: "ui", specimen: "close-actions" },
      {
        kind: "steps",
        items: [
          { es: "**Complete sale** — el botón azul lleno. El cliente pagó todo. Es el caso normal.", en: "**Complete sale** — the solid navy button. The customer paid it all. This is the ordinary case." },
          { es: "**Split payment** — pagó con dos cosas, o pagó una parte nada más.", en: "**Split payment** — they paid with two things, or paid only part of it." },
          { es: "**Create the ticket to pay at the cashier** — no pagó nada todavía.", en: "**Create the ticket to pay at the cashier** — nothing collected yet." },
        ],
      },
      {
        kind: "note",
        title: { es: "Cómo saber cuál tocar", en: "Which one to press" },
        body: [
          {
            es: "Si el cliente le está dando el dinero completo en este momento, es el **azul lleno**. Los otros dos son bordeados, sin relleno, justamente para que no se confundan con el normal.",
            en: "If the customer is handing you the whole amount right now, it is the **solid navy** one. The other two are outlined rather than filled, precisely so they cannot be mistaken for the ordinary case.",
          },
        ],
      },
    ],
  },

  {
    title: { es: "Cuando paga con dos cosas", en: "When they pay two ways" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Ejemplo: el ticket es de $300 y el cliente da $100 en efectivo y el resto con tarjeta.",
          en: "Example: the ticket is $300 and the customer gives $100 cash and the rest on a card.",
        },
      },
      {
        kind: "steps",
        items: [
          { es: "Toque **Split payment, or take only part of it**.", en: "Press **Split payment, or take only part of it**." },
          { es: "Escoja **Cash** y escriba **100**.", en: "Pick **Cash** and type **100**." },
          { es: "Escoja la segunda forma de pago. El sistema ya puso solo lo que falta.", en: "Pick the second tender. The system has already filled in what is left." },
          { es: "Toque **Take both charges**.", en: "Press **Take both charges**." },
        ],
      },
      {
        kind: "note",
        title: { es: "Qué acaba de pasar", en: "What just happened" },
        body: [
          {
            es: "Se guardaron **dos pagos** contra el mismo ticket, y el ticket quedó cerrado. En el corte de la noche, $100 aparecen en efectivo y $200 en tarjeta — que es exactamente lo que va a haber en la caja y en la terminal.",
            en: "**Two payments** were recorded against the one ticket, and the ticket closed. On the night's count $100 shows under cash and $200 under card — which is exactly what will be in the drawer and on the terminal.",
          },
        ],
      },
      { kind: "h3", text: { es: "Si solo paga una parte", en: "If they only pay part" } },
      {
        kind: "p",
        text: {
          es: "Igual, pero escriba nada más lo que le dio y termine ahí. El ticket queda con **saldo** y aparece en **Pending** en [[Main]] hasta que pague el resto.",
          en: "The same, but enter only what they handed over and stop there. The ticket keeps a **balance** and appears under **Pending** on [[Main]] until the rest is paid.",
        },
      },
    ],
  },

  {
    title: { es: "Cerrar sin cobrar", en: "Closing without taking money" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Es para cuando el trabajo se escribe afuera y el cliente pasa a pagar adentro. Al tocar ese botón sale este aviso:",
          en: "For when the work is written up outside and the customer pays indoors. Pressing that button brings up this box:",
        },
      },
      { kind: "ui", specimen: "confirm-unpaid" },
      {
        kind: "p",
        text: {
          es: "**Léalo.** No es un aviso de adorno: dice las dos cosas que van a pasar en el momento en que toque **Create it**.",
          en: "**Read it.** It is not there for decoration: it states the two things that happen the moment you press **Create it**.",
        },
      },
      {
        kind: "list",
        items: [
          { es: "**Las llantas salen del estante ahora.** El inventario ya las descontó, aunque nadie haya pagado.", en: "**The tires leave the racks now.** Stock has already taken them off, even though nobody has paid." },
          { es: "**El total se congela.** Ya no se le puede cambiar el precio.", en: "**The total freezes.** The price can no longer be changed." },
        ],
      },
      {
        kind: "note",
        title: { es: "Qué acaba de pasar", en: "What just happened" },
        body: [
          {
            es: "El ticket se cerró sin dinero y se fue al recuadro **rojo** de [[Main]], el que dice **Pending**. Ahí se queda hasta que alguien cobre. Si nadie lo cobra hoy, ahí va a seguir mañana.",
            en: "The ticket closed with no money and went to the **red** box on [[Main]], the one headed **Pending**. It stays there until somebody takes the money. If nobody does today, it will still be there tomorrow.",
          },
        ],
      },
      {
        kind: "warn",
        title: { es: "El botón [[Go back]] no rompe nada", en: "[[Go back]] breaks nothing" },
        body: [
          {
            es: "Si no está seguro, toque **Go back**. El ticket se queda como estaba y nadie se entera. El botón gris siempre es el que no hace nada.",
            en: "If you are not sure, press **Go back**. The ticket stays exactly as it was and nothing is recorded. The grey button is always the one that does nothing.",
          },
        ],
      },
    ],
  },

  {
    title: { es: "Los dos recuadros de Main", en: "The two boxes on Main" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Ésta es la confusión más cara del sistema, así que despacio. En [[Main]] hay dos recuadros de colores, y **no son lo mismo**.",
          en: "This is the costliest confusion in the system, so slowly. [[Main]] has two coloured boxes and they are **not the same thing**.",
        },
      },
      { kind: "ui", specimen: "pending-vs-outstanding" },
      {
        kind: "table",
        head: [{ es: "", en: "" }, { es: "Rojo — Pending", en: "Red — Pending" }, { es: "Ámbar — Outstanding", en: "Amber — Outstanding" }],
        rows: [
          [{ es: "Qué es", en: "What it is" }, { es: "Trabajo hecho que nadie ha pagado.", en: "Work done that nobody has paid for." }, { es: "Tickets que nosotros mandamos a esperar.", en: "Tickets we ourselves sent to wait." }],
          [{ es: "Por qué está ahí", en: "Why it is there" }, { es: "Porque falta el dinero.", en: "Because the money is missing." }, { es: "Porque falta la llanta, o falta que venga el cliente.", en: "Because the tire is missing, or the customer is." }],
          [{ es: "Qué se hace", en: "What to do" }, { es: "Cobrarlo.", en: "Take the money." }, { es: "Hablarle al cliente y mover el estado.", en: "Ring the customer and move the status." }],
          [{ es: "Cómo llegó ahí", en: "How it got there" }, { es: "Solo, al cerrar sin cobrar.", en: "On its own, when a ticket closed unpaid." }, { es: "Alguien lo puso a propósito.", en: "Somebody put it there deliberately." }],
        ],
      },
      {
        kind: "warn",
        title: { es: "Un ticket no se cambia solo de recuadro", en: "A ticket never moves between them on its own" },
        body: [
          {
            es: "Si un ticket está en **Outstanding**, es porque alguien lo mandó ahí. Cobrarle una parte **no** lo pasa al otro recuadro. Son dos preguntas distintas: una es “¿quién nos debe?” y la otra es “¿a quién le falta su llanta?”.",
            en: "If a ticket is in **Outstanding**, somebody put it there. Taking part payment does **not** move it to the other box. They answer two different questions: one is \"who owes us\", the other is \"who is still waiting on a tire\".",
          },
        ],
      },
    ],
  },

  {
    title: { es: "El cajón del ticket", en: "The ticket drawer" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Cuando toca el número de un ticket — en [[Main]] o en [[Logs]] — se abre un panel por la derecha. Ése es **el cajón del ticket**, y es donde se hace todo lo que se le puede hacer a un ticket ya cerrado.",
          en: "Tapping a ticket number — on [[Main]] or in [[Logs]] — slides a panel in from the right. That is **the ticket drawer**, and it is where everything that can be done to a closed ticket is done.",
        },
      },
      { kind: "ui", specimen: "ticket-drawer-map" },
      {
        kind: "table",
        head: [{ es: "#", en: "#" }, { es: "Qué hace", en: "What it does" }, { es: "Quién", en: "Who" }],
        rows: [
          [{ es: "1 · Print receipt", en: "1 · Print receipt" }, { es: "Vuelve a imprimir el recibo del cliente. Se puede las veces que haga falta.", en: "Prints the customer's receipt again. As many times as needed." }, { es: "Cualquiera", en: "Anyone" }],
          [{ es: "2 · Details", en: "2 · Details" }, { es: "El cliente, el vehículo y la nota del trabajo. **Esta nota sí sale impresa** en el recibo.", en: "Customer, vehicle and the job note. **This note does print** on the receipt." }, { es: "Cajero", en: "Cashier" }],
          [{ es: "3 · Status", en: "3 · Status" }, { es: "Mover el ticket entre los estados de espera — vea la sección de órdenes.", en: "Move the ticket through the waiting statuses — see the orders section." }, { es: "Cajero", en: "Cashier" }],
          [{ es: "4 · Pin it", en: "4 · Pin it" }, { es: "Un recado para el que siga. **No sale en el recibo**, se queda adentro.", en: "A note for whoever is next. **Does not print**; it stays inside." }, { es: "Cualquiera", en: "Anyone" }],
          [{ es: "5 · Los renglones", en: "5 · The lines" }, { es: "Cada renglón trae [[Change the price]], [[How many]] y a quién se le acredita.", en: "Each line carries [[Change the price]], [[How many]] and who it credits." }, { es: "Ver abajo", en: "See below" }],
          [{ es: "6 · Take a payment", en: "6 · Take a payment" }, { es: "Cobrar lo que falta. **Solo aparece si el ticket debe algo.**", en: "Take what is owed. **Only appears if the ticket owes something.**" }, { es: "Cajero", en: "Cashier" }],
          [{ es: "7 · Tip added later", en: "7 · Tip added later" }, { es: "Agregar una propina que se olvidó, aunque sea de ayer.", en: "Add a tip that was missed, even from yesterday." }, { es: "Cajero", en: "Cashier" }],
          [{ es: "8 · Void", en: "8 · Void" }, { es: "Anular el ticket entero. Pide un motivo.", en: "Void the whole ticket. It asks for a reason." }, { es: "Gerente", en: "Manager" }],
        ],
      },
      { kind: "h3", text: { es: "Las dos notas no son la misma", en: "The two notes are not the same" } },
      {
        kind: "list",
        items: [
          { es: "**Details** → la nota del trabajo. **Sale impresa** en el recibo del cliente.", en: "**Details** → the job note. It **prints** on the customer's receipt." },
          { es: "**Pin it** → el recado amarillo. **No sale**; es para el personal.", en: "**Pin it** → the yellow note. It **does not print**; it is for staff." },
        ],
      },
      {
        kind: "warn",
        title: { es: "Cuidado con lo que escribe en cada una", en: "Mind which one you write in" },
        body: [
          {
            es: "Lo que escriba en **Details** se lo lleva el cliente en el papel. Si es un recado para el compañero — “no le quiso pagar hoy”, “hablarle a la esposa” — va en **Pin it**, nunca en Details.",
            en: "Whatever goes in **Details** leaves with the customer on paper. If it is a message for a workmate — \"would not pay today\", \"call his wife\" — it goes in **Pin it**, never in Details.",
          },
        ],
      },
      { kind: "h3", text: { es: "Corregir un renglón ya cobrado", en: "Correcting a line already charged" } },
      {
        kind: "p",
        text: {
          es: "Toque el renglón dentro del cajón. Ahí sale [[Fix a price that was rung wrong]]. Eso **no borra nada**: guarda el precio viejo, el nuevo, quién lo cambió y cuándo, y el cambio sale en el corte de esa noche.",
          en: "Tap the line inside the drawer. [[Fix a price that was rung wrong]] appears there. It **deletes nothing**: it keeps the old price, the new one, who changed it and when, and the change appears on that night's close-out.",
        },
      },
      {
        kind: "note",
        title: { es: "Si el cajón no le enseña un botón", en: "If the drawer is missing a button" },
        body: [
          {
            es: "Es su puesto, no el ticket. Anular y corregir precios cobrados son de gerente. Pídaselo — no busque otra manera de lograrlo.",
            en: "It is your role, not the ticket. Voiding and correcting charged prices are a manager's. Ask for it — do not look for another way round.",
          },
        ],
      },
    ],
  },

  {
    title: { es: "Vendido contra Cobrado", en: "Sold versus Collected" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "En [[Close-out]], arriba, salen cuatro números:",
          en: "At the top of [[Close-out]] there are four figures:",
        },
      },
      { kind: "ui", specimen: "day-stats" },
      {
        kind: "table",
        head: [{ es: "Número", en: "Figure" }, { es: "Qué es exactamente", en: "Exactly what it is" }],
        rows: [
          [{ es: "**Sold**", en: "**Sold**" }, { es: "Lo que **cobramos por el trabajo** de hoy. La suma de los tickets que se hicieron hoy.", en: "What we **charged for today's work**. The sum of the tickets rung today." }],
          [{ es: "**Tips**", en: "**Tips**" }, { es: "Las propinas de los técnicos.", en: "The technicians' tips." }],
          [{ es: "**Terminal tax**", en: "**Terminal tax**" }, { es: "Lo que cobra la terminal por sacar las propinas.", en: "What the terminal charges for paying tips out." }],
          [{ es: "**Collected**", en: "**Collected**" }, { es: "El **dinero que entró hoy**, venga de donde venga.", en: "The **money that came in today**, wherever it came from." }],
        ],
      },
      { kind: "h3", text: { es: "Por qué casi nunca son iguales", en: "Why they are almost never the same" } },
      {
        kind: "p",
        text: {
          es: "Porque miden cosas distintas, y la diferencia va para los dos lados:",
          en: "Because they measure different things, and the gap runs both ways:",
        },
      },
      {
        kind: "list",
        items: [
          { es: "**Entró dinero que no se vendió hoy:** un cliente vino a pagar un ticket de la semana pasada. Ese dinero está en **Collected**, pero el trabajo fue de otro día, así que no está en **Sold**.", en: "**Money came in that was not rung today:** somebody came in to settle last week's ticket. That money is in **Collected**, but the work was another day's, so it is not in **Sold**." },
          { es: "**Se vendió trabajo que no dejó dinero hoy:** un ticket que se fue a Pending, o uno que se cargó a cuenta. Está en **Sold**, pero no hay un peso de él en **Collected**.", en: "**Work was rung that brought no money today:** a ticket that went to Pending, or one charged to an account. It is in **Sold**, but not a cent of it is in **Collected**." },
          { es: "**Las propinas** también entran en **Collected** y no son venta del taller.", en: "**Tips** also land in **Collected**, and they are not the shop's sale." },
        ],
      },
      {
        kind: "note",
        title: { es: "La regla corta", en: "The short rule" },
        body: [
          {
            es: "**Sold** = lo que cobramos por trabajar. **Collected** = lo que entró a la caja. Para cuadrar el dinero de la noche, el que importa es **Collected**, porque ése es el que se puede contar con la mano.",
            en: "**Sold** = what we charged for working. **Collected** = what came into the till. To reconcile the night's money the one that matters is **Collected**, because that is the one you can count with your hands.",
          },
        ],
      },
    ],
  },

  {
    title: { es: "El corte del día", en: "The close-out" },
    blocks: [
      {
        kind: "p",
        text: { es: "Se hace en [[Close-out]], y el orden importa.", en: "Done in [[Close-out]], and the order matters." },
      },
      {
        kind: "steps",
        items: [
          { es: "**Cuente primero.** Saque el dinero de la caja y cuéntelo. Escriba lo que contó, y lo de cada terminal.", en: "**Count first.** Take the money out of the drawer and count it. Type what you counted, and each terminal's figure." },
          { es: "El sistema **no le enseña** lo que debería haber hasta que usted escriba. Eso es a propósito.", en: "The system **will not show you** what it expects until you have typed. That is deliberate." },
          { es: "Ya que escribió, aparece la columna de la diferencia.", en: "Once you have typed, the difference column appears." },
          { es: "Cierre el lote de la terminal de tarjetas y márquelo.", en: "Settle the card batch on the terminal and mark it here." },
          { es: "**Imprima y firme.**", en: "**Print and sign.**" },
        ],
      },
      {
        kind: "note",
        title: { es: "Por qué se cuenta a ciegas", en: "Why the count is blind" },
        body: [
          {
            es: "Si el sistema le enseñara primero cuánto debería haber, contar dejaría de ser contar y se volvería buscar ese número. Tapado, el conteo es de verdad. No es desconfianza: es la única manera de que el número sirva.",
            en: "If the system showed you the expected figure first, counting would stop being counting and become looking for that number. Covered, the count is a real one. It is not distrust: it is the only way the figure means anything.",
          },
        ],
      },
      { kind: "h3", text: { es: "Si no cuadra", en: "If it does not balance" } },
      { kind: "ui", specimen: "eod-flag" },
      {
        kind: "p",
        text: {
          es: "Ese recuadro negro sale impreso en la hoja. Le dice cuánto faltó o sobró, y en qué forma de pago. Cuando el efectivo falta exactamente lo que sobra en tarjeta, casi siempre es una venta cobrada con el botón equivocado — y el sistema hasta le dice cuáles tickets pudieron ser.",
            en: "That black box prints on the sheet. It says how much was over or short, and on which tender. When cash is short by exactly what card is over, it is nearly always one sale rung on the wrong button — and the system even names the tickets it might have been.",
        },
      },
      {
        kind: "warn",
        title: { es: "Nunca fuerce el conteo", en: "Never force the count" },
        body: [
          {
            es: "Si falta dinero, **escriba lo que de verdad contó** e imprima así. La hoja es el registro de lo que pasó, no de lo que nos habría gustado. Un número acomodado se ve bien esa noche y en tres semanas nadie lo puede explicar.",
            en: "If money is missing, **enter what you actually counted** and print it that way. The sheet is a record of what happened, not of what anybody wanted. A tidied number looks fine that night and cannot be explained three weeks later.",
          },
        ],
      },
    ],
  },

  {
    title: { es: "La hoja que sale impresa", en: "The sheet that comes out" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "El corte imprime **tres hojas**, y cada una es para algo distinto. Vale la pena saber cuál es cuál, porque la primera se firma y las otras dos se leen.",
          en: "The close-out prints **three sheets**, and each is for a different thing. It is worth knowing which is which, because the first gets signed and the other two get read.",
        },
      },
      { kind: "ui", specimen: "closeout-pages" },
      { kind: "h3", text: { es: "Hoja 1 — la que se firma", en: "Sheet 1 — the one you sign" } },
      {
        kind: "p",
        text: {
          es: "Siempre se ve igual, todas las noches. Trae lo del día — vendido, propinas, cobrado —, las dos gráficas de la semana, el desempeño del personal, el conteo por forma de pago, y hasta abajo las rayas para firmar.",
          en: "It looks the same every night. The day's figures — sold, tips, collected — the two week charts, staff performance, the count by tender, and the ruled signature lines at the foot.",
        },
      },
      {
        kind: "note",
        title: { es: "Por qué la firma siempre está hasta abajo", en: "Why the signature is always at the foot" },
        body: [
          {
            es: "Para que se note si falta una hoja. Si la firma sale a media página o en la segunda hoja, algo se imprimió mal — y esa hoja es la que se archiva.",
            en: "So a missing page shows. If the signature comes out halfway down, or on the second sheet, something printed wrong — and that sheet is the one that gets filed.",
          },
        ],
      },
      { kind: "h3", text: { es: "Hoja 2 — Financial Report", en: "Sheet 2 — Financial Report" } },
      {
        kind: "p",
        text: {
          es: "Es la hoja de las cosas que hay que revisar. Empieza con **los avisos** — todos juntos, arriba — y sigue con el movimiento de la caja, los cortes de media jornada, quién se fue a cuenta, quién cobró qué, y los precios que se cambiaron en el mostrador.",
          en: "The sheet of things to look at. It opens with **the warnings** — all of them together, at the top — then drawer movements, the midday counts, who went on account, who took what, and prices changed at the counter.",
        },
      },
      { kind: "h3", text: { es: "Hoja 3 — Logs Report", en: "Sheet 3 — Logs Report" } },
      {
        kind: "p",
        text: {
          es: "El detalle. Lo que se debe, lo que hay que reordenar, las llantas que salieron, lo que llegó del proveedor, y todos los movimientos del día en el orden en que pasaron.",
          en: "The detail. What is owed, what to reorder, the tires that went out, what arrived from the supplier, and every movement of the day in the order it happened.",
        },
      },
      {
        kind: "note",
        title: { es: "Las tres se archivan juntas", en: "All three are filed together" },
        body: [
          {
            es: "Cada hoja lleva arriba el nombre del taller, la fecha y quién la imprimió, precisamente porque se separan en el archivero. Si encuentra una hoja suelta, ahí dice de qué día es.",
            en: "Every sheet carries the shop, the date and who printed it at the top, precisely because they get separated in the filing cabinet. If you find a loose page, it says which day it belongs to.",
          },
        ],
      },
    ],
  },

  {
    title: { es: "Meter llantas nuevas al inventario", en: "Putting new tires into stock" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Cuando llega el camión, las llantas hay que **meterlas al sistema**. Si no, el inventario va a decir que no hay, y las va a estar viendo en el estante.",
          en: "When the van arrives, the tires have to be **entered into the system**. If they are not, stock will say there are none while you are looking at them on the rack.",
        },
      },
      {
        kind: "steps",
        items: [
          { es: "Entre a [[Inventory]].", en: "Open [[Inventory]]." },
          { es: "Arriba, toque **+ Receive stock**.", en: "At the top, press **+ Receive stock**." },
          { es: "Escoja la pestaña: **New tires** o **Used tires**.", en: "Pick the tab: **New tires** or **Used tires**." },
          { es: "Busque la llanta y tóquela. Va a aparecer arriba, para que confirme que agarró la correcta.", en: "Search the tire and tap it. It appears at the top so you can confirm you picked the right one." },
          { es: "Escriba **cuántas** llegaron y **a cómo** salió cada una.", en: "Enter **how many** arrived and **what each cost**." },
          { es: "Escriba el **proveedor** y el **número de factura**.", en: "Enter the **supplier** and the **invoice number**." },
          { es: "Guarde.", en: "Save." },
        ],
      },
      { kind: "ui", specimen: "receive-sheet" },
      {
        kind: "note",
        title: { es: "Qué acaba de pasar", en: "What just happened" },
        body: [
          {
            es: "Esas llantas ya están en el estante para el sistema. Si había 2 y metió 12, ahora dice 14, y ya se pueden vender. También quedó guardado **cuánto costaron** y **de quién**, que es lo que después deja cuadrar la factura del proveedor.",
            en: "Those tires are now on the rack as far as the system is concerned. If there were 2 and you entered 12, it now says 14 and they can be sold. It also recorded **what they cost** and **who from**, which is what lets the supplier's invoice be checked later.",
          },
        ],
      },
      {
        kind: "warn",
        title: { es: "Métalas el mismo día que llegan", en: "Enter them the day they arrive" },
        body: [
          {
            es: "Si las mete tres días después, esos tres días el sistema dijo que no había — y alguien pudo haberle dicho a un cliente que no teníamos, o vendió con aviso de que no había existencia. Es el error más fácil de evitar y el más caro de rastrear.",
            en: "Enter them three days later and for three days the system said there were none — somebody may have told a customer we did not have them, or sold one against a no-stock warning. It is the easiest mistake to avoid and the hardest to trace back.",
          },
        ],
      },
      { kind: "h3", text: { es: "Una llanta que el taller nunca ha vendido", en: "A tire the shop has never carried" } },
      {
        kind: "p",
        text: {
          es: "Si la busca y **no aparece en la lista**, es que esa marca o esa medida es nueva para el sistema. Dentro de la misma ventana de **Receive stock**, abajo, hay un enlace chiquito:",
          en: "If you search and it is **not in the list**, that brand or size is new to the system. Inside the same **Receive stock** panel, at the bottom, there is a small link:",
        },
      },
      {
        kind: "steps",
        items: [
          { es: "Toque **Not in the list? Add a tire**.", en: "Press **Not in the list? Add a tire**." },
          { es: "Escriba la **marca** (por ejemplo GOODYEAR), el **modelo** (TRAVEZA) y la **medida** (195-65-15) en sus casillas separadas.", en: "Enter the **brand** (say GOODYEAR), the **model** (TRAVEZA) and the **size** (195-65-15) in their separate boxes." },
          { es: "Póngale el **precio de venta**.", en: "Set the **selling price**." },
          { es: "Siga con la cantidad y el costo como siempre, y guarde.", en: "Carry on with quantity and cost as usual, and save." },
        ],
      },
      {
        kind: "warn",
        title: { es: "Marca y modelo van separados", en: "Brand and model go in separate boxes" },
        body: [
          {
            es: "No escriba *GOODYEAR TRAVEZA* todo junto en una casilla. Van en dos, y por eso hay dos. Escritas juntas, el buscador después no las encuentra bien y se termina creando la misma llanta dos veces con dos nombres distintos.",
            en: "Do not type *GOODYEAR TRAVEZA* into one box. They go in two, which is why there are two. Typed together, the search stops finding them properly and the same tire ends up created twice under two different names.",
          },
        ],
      },
      {
        kind: "note",
        title: { es: "Antes de crear una llanta nueva, búsquela otra vez", en: "Before creating one, search again" },
        body: [
          {
            es: "Búsquela solo por la **medida**, sin la marca. Muchas veces sí está, nada más escrita distinto. Crear una que ya existía deja dos renglones para la misma llanta, y a partir de ahí el conteo de esa medida ya no sirve.",
            en: "Search by **size** alone, without the brand. Very often it is there, just spelled differently. Creating one that already existed leaves two rows for the same tire, and from then on the count for that size is worthless.",
          },
        ],
      },
    ],
  },

  {
    title: { es: "Cuando la llanta no está", en: "When the tire is not there" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Llega un cliente pidiendo una medida y no la tenemos. Hay **tres situaciones distintas** y cada una se resuelve diferente. Lo primero es saber cuál es:",
          en: "A customer asks for a size and we do not have it. There are **three different situations** and each is handled differently. The first job is knowing which one you are in:",
        },
      },
      {
        kind: "table",
        head: [{ es: "La situación", en: "The situation" }, { es: "Qué hacer", en: "What to do" }],
        rows: [
          [
            { es: "**Sí la tenemos**, pero el sistema dice 0 — la está viendo en el estante.", en: "**We do have it**, but the system says 0 — it is in front of you on the rack." },
            { es: "Véndala normal. El sistema le va a avisar que no hay existencia; siga. Después avísele a un gerente para que cuadre el conteo.", en: "Sell it normally. The system warns there is no stock; carry on. Then tell a manager so the count gets straightened out." },
          ],
          [
            { es: "**No la tenemos** y el cliente la quiere — hay que pedirla.", en: "**We do not have it** and the customer wants it — it has to be ordered." },
            { es: "En [[New sale]], modo Inventory, toque **Not on the rack? Order it in**.", en: "In [[New sale]], Inventory mode, press **Not on the rack? Order it in**." },
          ],
          [
            { es: "**Ya llegó del proveedor** y hay que meterla al sistema.", en: "**It has arrived from the supplier** and needs entering." },
            { es: "[[Inventory]] → **+ Receive stock**. Vea la sección anterior.", en: "[[Inventory]] → **+ Receive stock**. See the previous section." },
          ],
        ],
      },
      { kind: "h3", text: { es: "Pedirla para el cliente", en: "Ordering it in for the customer" } },
      {
        kind: "steps",
        items: [
          { es: "En [[New sale]], cambie al modo **Inventory**.", en: "In [[New sale]], switch to **Inventory** mode." },
          { es: "Toque **Not on the rack? Order it in** — el enlace chiquito debajo del buscador.", en: "Press **Not on the rack? Order it in** — the small link under the search box." },
          { es: "Arme el ticket con lo que va a llevar y cobre el anticipo si lo hay.", en: "Build the ticket with what they are having and take a deposit if there is one." },
        ],
      },
      {
        kind: "note",
        title: { es: "Qué acaba de pasar", en: "What just happened" },
        body: [
          {
            es: "El ticket quedó marcado como **orden especial** y se fue al recuadro **ámbar** de [[Main]], con el estado en *Ordered*. A partir de ahí hay que irle moviendo el estado conforme pase algo — vea la sección de órdenes.",
            en: "The ticket is marked as a **special order** and moved to the **amber** box on [[Main]], with its status on *Ordered*. From there the status has to be moved along as things happen — see the orders section.",
          },
        ],
      },
      {
        kind: "warn",
        title: { es: "Vender sin existencia no está prohibido", en: "Selling with no stock is not forbidden" },
        body: [
          {
            es: "Si la llanta está en el estante, **véndala**, aunque el sistema diga que no hay. El aviso no es un “no puedes”: es un recado de que la cuenta del estante y la del sistema no coinciden, y alguien tiene que ir a ver cuál de las dos está mal. Lo que no se vale es no decirlo.",
            en: "If the tire is on the rack, **sell it**, whatever the system says. The warning is not a refusal: it is a note that the rack and the system disagree and somebody has to find out which is wrong. What is not acceptable is saying nothing.",
          },
        ],
      },
    ],
  },

  {
    title: { es: "Inventario y sus avisos", en: "Stock and its warnings" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "En [[Inventory]], cada medida trae una etiqueta de color que dice cómo anda:",
          en: "In [[Inventory]] each size carries a coloured tag saying how it stands:",
        },
      },
      { kind: "ui", specimen: "stock-pills" },
      {
        kind: "table",
        head: [{ es: "Etiqueta", en: "Tag" }, { es: "Qué significa", en: "What it means" }],
        rows: [
          [{ es: "Roja — *none left*", en: "Red — *none left*" }, { es: "No hay ninguna. Hay que pedirla.", en: "There are none. It needs ordering." }],
          [{ es: "Amarilla — *N left*", en: "Amber — *N left*" }, { es: "Ya van pocas. Sale también en el corte de la noche.", en: "Getting low. It also appears on the night's close-out." }],
          [{ es: "Dorada — *Discount!*", en: "Gold — *Discount!*" }, { es: "Esa medida está marcada con descuento.", en: "That size is flagged as discounted." }],
        ],
      },
      {
        kind: "warn",
        title: { es: "Vender algo que dice que no hay", en: "Selling stock it says is gone" },
        body: [
          {
            es: "Se puede, y a veces hay que hacerlo — la llanta está en el estante aunque el sistema diga que no. Pero queda marcado, porque significa que la cuenta del estante y la del sistema no coinciden, y alguien tiene que ir a ver cuál está mal. No es un regaño; es un recado.",
            en: "You can, and sometimes you must — the tire is on the rack even though the system says otherwise. It gets flagged, because it means the rack and the system disagree and somebody has to find out which is wrong. It is not a telling-off; it is a note.",
          },
        ],
      },
    ],
  },

  {
    title: { es: "Cuando se equivocó", en: "When you got it wrong" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Aquí nada se borra. Todo se corrige **agregando** la corrección, y las dos cosas quedan a la vista. Eso es lo que hace que en un mes se pueda explicar qué pasó.",
          en: "Nothing is deleted here. Everything is corrected by **adding** the correction, and both stay visible. That is what makes it possible to explain a ticket a month later.",
        },
      },
      {
        kind: "table",
        head: [{ es: "Se equivocó en…", en: "You got wrong…" }, { es: "Todavía no cobra", en: "Not charged yet" }, { es: "Ya cobró", en: "Already charged" }],
        rows: [
          [{ es: "El precio", en: "The price" }, { es: "[[Change the price]] — usted mismo.", en: "[[Change the price]] — you can." }, { es: "Un gerente lo corrige desde el ticket.", en: "A manager corrects it from the ticket." }],
          [{ es: "La cantidad", en: "The quantity" }, { es: "[[How many]] — usted mismo.", en: "[[How many]] — you can." }, { es: "Un gerente.", en: "A manager." }],
          [{ es: "La forma de pago", en: "The tender" }, { es: "No aplica.", en: "Does not apply." }, { es: "Un gerente. **Dígalo el mismo día.**", en: "A manager. **Say so the same day.**" }],
          [{ es: "Todo el ticket", en: "The whole ticket" }, { es: "Quítele los renglones.", en: "Take the lines off it." }, { es: "Un gerente lo anula.", en: "A manager voids it." }],
        ],
      },
      { kind: "h3", text: { es: "Dónde se arregla cada cosa", en: "Where each thing gets fixed" } },
      {
        kind: "p",
        text: {
          es: "Casi todo el mundo se atora en lo mismo: **no sabe dónde ir**. Ésta es la respuesta corta.",
          en: "Almost everybody gets stuck on the same thing: **not knowing where to go**. Here is the short answer.",
        },
      },
      {
        kind: "table",
        head: [{ es: "El error", en: "The mistake" }, { es: "A dónde ir", en: "Where to go" }, { es: "Qué tocar", en: "What to press" }],
        rows: [
          [{ es: "Un renglón mal, ticket todavía abierto", en: "A wrong line, ticket still open" }, { es: "La misma pantalla de venta", en: "The sale screen you are on" }, { es: "Toque el renglón → [[Change the price]] o [[How many]]", en: "Tap the line → [[Change the price]] or [[How many]]" }],
          [{ es: "Un renglón mal, ticket ya cobrado", en: "A wrong line, ticket already charged" }, { es: "[[Main]] o [[Logs]] → toque el número del ticket", en: "[[Main]] or [[Logs]] → tap the ticket number" }, { es: "En el cajón: [[Fix a price that was rung wrong]]", en: "In the drawer: [[Fix a price that was rung wrong]]" }],
          [{ es: "Forma de pago equivocada", en: "Wrong tender" }, { es: "[[Logs]] → toque el ticket", en: "[[Logs]] → tap the ticket" }, { es: "Corregir el pago (gerente)", en: "Correct the payment (manager)" }],
          [{ es: "Se olvidó la propina", en: "Forgot the tip" }, { es: "[[Logs]] → toque el ticket", en: "[[Logs]] → tap the ticket" }, { es: "[[Tip added later]]", en: "[[Tip added later]]" }],
          [{ es: "El ticket entero está mal", en: "The whole ticket is wrong" }, { es: "[[Logs]] → toque el ticket", en: "[[Logs]] → tap the ticket" }, { es: "Anularlo (gerente)", en: "Void it (manager)" }],
          [{ es: "El conteo del estante no cuadra", en: "The rack count is wrong" }, { es: "[[Inventory]] → busque la llanta", en: "[[Inventory]] → find the tire" }, { es: "[[Count]] en ese renglón (gerente)", en: "[[Count]] on that row (manager)" }],
          [{ es: "El precio o el nombre de una llanta está mal", en: "A tire's price or name is wrong" }, { es: "[[Inventory]] → busque la llanta", en: "[[Inventory]] → find the tire" }, { es: "[[Edit]] en ese renglón (gerente)", en: "[[Edit]] on that row (manager)" }],
        ],
      },
      { kind: "ui", specimen: "stock-row", caption: { es: "Los dos enlaces de la derecha: Edit cambia la llanta, Count cambia cuántas hay.", en: "The two links on the right: Edit changes the tire, Count changes how many there are." } },
      {
        kind: "note",
        title: { es: "Edit y Count no son lo mismo", en: "Edit and Count are different" },
        body: [
          {
            es: "**Edit** cambia lo que *es* la llanta — su nombre, su medida, su precio. **Count** cambia **cuántas hay**, y pide un motivo: descontada, dañada, mal contada. Si lo que está mal es el número, es Count; si lo que está mal es el nombre o el precio, es Edit.",
            en: "**Edit** changes what the tire *is* — its name, its size, its price. **Count** changes **how many there are**, and asks for a reason: miscount, damaged, sold off the books. If the number is wrong it is Count; if the name or price is wrong it is Edit.",
          },
        ],
      },
      { kind: "h3", text: { es: "Anular no es devolver", en: "Voiding is not refunding" } },
      {
        kind: "list",
        items: [
          { es: "**Anular** = este ticket no debió existir. Se regresa el dinero y **las llantas vuelven al estante**.", en: "**Void** = this ticket should never have existed. The money goes back and **the tires return to the racks**." },
          { es: "**Devolver** = la venta sí pasó, pero el cliente trajo la llanta después. La venta se queda; se registra la devolución aparte.", en: "**Refund** = the sale did happen, but the customer brought the tire back later. The sale stays; the return is recorded separately." },
        ],
      },
      {
        kind: "note",
        title: { es: "Lo peor que puede hacer", en: "The worst thing you can do" },
        body: [
          {
            es: "Tratar de arreglar un error haciendo otro ticket al revés, o cobrando de más en otro lado para que “cuadre”. Todo tiene su manera de corregirse y todas dejan constancia. Pida ayuda antes de inventar.",
            en: "Trying to fix a mistake by ringing an opposite ticket, or overcharging elsewhere to make it balance. Everything has a proper correction and all of them leave a record. Ask before inventing one.",
          },
        ],
      },
    ],
  },

  {
    title: { es: "Propinas", en: "Tips" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "La propina se guarda **sobre el pago**, no sobre el ticket. Suena a detalle y no lo es: quiere decir que una propina se puede agregar **después**, hasta al día siguiente, y de todos modos le llega al técnico correcto.",
          en: "A tip is recorded **against the payment**, not the ticket. That sounds like a detail and is not: it means a tip can be added **later**, even the next day, and it still reaches the right technician.",
        },
      },
      {
        kind: "note",
        title: { es: "Se le olvidó la propina", en: "You forgot the tip" },
        body: [
          {
            es: "No haga otro ticket. Abra el ticket original y agréguele la propina al pago. **Nunca** cobre una propina como si fuera una venta: eso mete dinero en la venta del día que no fue venta, y en la noche el corte no cuadra.",
            en: "Do not ring another ticket. Open the original and add the tip to its payment. **Never** ring a tip as a sale: that puts money into the day's sales that was not a sale, and the count will not come out at night.",
          },
        ],
      },
      {
        kind: "p",
        text: {
          es: "El cargo de la terminal se calcula solo, con la regla del taller. No hay que sacar cuentas a mano ni redondear nada.",
          en: "The terminal's charge is worked out automatically from the shop's rule. There is no arithmetic to do by hand and nothing to round.",
        },
      },
    ],
  },

  {
    title: { es: "Pedir una llanta para un cliente", en: "Ordering a tire in" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Cuando no hay la medida, se hace el ticket normal, se cobra el anticipo si lo hay, y el ticket se manda a esperar. Ahí es donde aparece en el recuadro **ámbar** de [[Main]].",
          en: "When the size is not on the racks, ring the ticket as normal, take a deposit if there is one, and send the ticket to wait. That is when it appears in the **amber** box on [[Main]].",
        },
      },
      {
        kind: "p",
        text: {
          es: "Cada ticket que está esperando tiene un estado. Se cambia desde el mismo recuadro, y los estados van en este orden:",
          en: "Every waiting ticket carries a status. It is changed from that same box, and the statuses run in this order:",
        },
      },
      { kind: "ui", specimen: "order-status", caption: { es: "El estado que está marcado es el de ahorita.", en: "The highlighted status is where it stands now." } },
      {
        kind: "table",
        head: [{ es: "Estado", en: "Status" }, { es: "Qué quiere decir", en: "What it means" }],
        rows: [
          [{ es: "Ordered", en: "Ordered" }, { es: "Ya se le pidió al proveedor.", en: "Ordered from the supplier." }],
          [{ es: "Arrived", en: "Arrived" }, { es: "Ya llegó al taller.", en: "It has arrived at the shop." }],
          [{ es: "Here — call them", en: "Here — call them" }, { es: "Está aquí y **falta hablarle al cliente**.", en: "It is here and **the customer has not been called**." }],
          [{ es: "Called — no answer", en: "Called — no answer" }, { es: "Ya se le habló y no contestó. Hay que volver a intentar.", en: "Called, no answer. Somebody has to try again." }],
          [{ es: "Ready for pick up — call them", en: "Ready for pick up — call them" }, { es: "Ya está montada o lista.", en: "Fitted or ready to hand over." }],
          [{ es: "Waiting for pickup", en: "Waiting for pickup" }, { es: "El cliente ya sabe y va a venir.", en: "The customer knows and is coming." }],
          [{ es: "Picked up", en: "Picked up" }, { es: "Ya se la llevó. **Sale de la lista.**", en: "Collected. **It leaves the list.**" }],
        ],
      },
      {
        kind: "warn",
        title: { es: "El estado es lo único que se acuerda por usted", en: "The status is the only thing that remembers for you" },
        body: [
          {
            es: "Nadie se va a acordar el jueves de que la llanta llegó el martes. El que abre en la mañana lee ese recuadro y hace las llamadas del día — y solo puede hacer las que el estado le diga. Un ticket que se quedó en *Ordered* tres semanas es un cliente que nadie volvió a llamar. **Muévalo en cuanto pase algo**, aunque sea para poner que no contestó.",
            en: "Nobody is going to remember on Thursday that the tire arrived on Tuesday. Whoever opens up reads that box and makes the day's calls — and can only make the ones the status tells them about. A ticket stuck on *Ordered* for three weeks is a customer nobody rang back. **Move it the moment anything happens**, even if it is only to say there was no answer.",
          },
        ],
      },
    ],
  },

  {
    title: { es: "Cuando llega la llanta que se pidió", en: "When the ordered tire arrives" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Al marcar un pedido como entregado, el sistema abre un recuadro y hace **una sola pregunta**: ¿esta llanta ya la metieron al inventario cuando llegó?",
          en: "When an order is marked delivered, a box opens and asks **one question**: was this tire already put into the stock count when it arrived?",
        },
      },
      {
        kind: "p",
        text: {
          es: "Tiene que preguntarlo porque en la base de datos las dos cosas se ven igual. Una llanta que llegó y se recibió con [[Receive stock]] es exactamente el mismo renglón que una llanta que llegó para un pedido. La computadora no puede distinguirlas. Usted sí: usted la tuvo en la mano.",
          en: "It has to ask, because in the database the two look identical. A tire that arrived and was booked in with [[Receive stock]] is exactly the same row as a tire that arrived for an order. The computer cannot tell them apart. You can — you were holding it.",
        },
      },
      { kind: "h3", text: { es: "Qué enseña el recuadro", en: "What the box shows you" } },
      {
        kind: "list",
        items: [
          { es: "Cada llanta del ticket, con **cuántas dice el sistema que hay** de esa medida ahorita.", en: "Every tire on the ticket, with **how many the count says are on hand** right now." },
          { es: "**Todos los movimientos** de esa llanta: cuándo entró, cuándo salió, quién y en qué ticket.", en: "**Every movement** that tire has had: when it came in, when it went out, who and on which ticket." },
          { es: "Una etiqueta ámbar que dice **added by hand** en las entradas que nadie amarró a un ticket. Ésa casi siempre es la que usted está buscando.", en: "An amber tag reading **added by hand** on any receipt with no ticket against it. That one is very probably the one you are looking for." },
        ],
      },
      {
        kind: "steps",
        items: [
          { es: "**Palomee** nada más las llantas que ya se habían metido al inventario.", en: "**Tick** only the tires that were already put into stock." },
          { es: "Lea el renglón de abajo. Le dice, con sus palabras, qué va a hacer el sistema.", en: "Read the line at the bottom. It says in plain words what is about to happen." },
          { es: "Palomee [[I'm sure]] y toque [[Fulfil the order]].", en: "Tick [[I'm sure]] and press [[Fulfil the order]]." },
        ],
      },
      {
        kind: "warn",
        title: { es: "Las dos respuestas se equivocan al revés", en: "The two wrong answers fail in opposite directions" },
        body: [
          {
            es: "Si palomea una que **no** se había metido, esa medida se queda **una de menos** en el sistema. Si **no** palomea una que sí se había metido, se queda **una de más** — y ésa es peor, porque el sistema le va a decir que tiene una llanta que no está, y alguien se la va a prometer a un cliente. Ninguna de las dos se arregla sola. Por eso hay que palomear [[I'm sure]].",
            en: "Tick one that was **not** booked in and that size ends up one **low**. Fail to tick one that **was** and it ends up one **high** — which is worse, because the system will tell you there is a tire that is not there and somebody will promise it to a customer. Neither fixes itself. That is why there is an [[I'm sure]] tick.",
          },
        ],
      },
      {
        kind: "note",
        title: { es: "Si no está seguro, no adivine", en: "If you are not sure, do not guess" },
        body: [
          {
            es: "Cancele, vaya a contar esa medida en el rack, y regrese. Le va a costar dos minutos. Adivinar le puede costar semanas de un número equivocado que nadie encuentra.",
            en: "Cancel, go and count that size on the rack, and come back. It costs two minutes. Guessing can cost weeks of a wrong number nobody can find.",
          },
        ],
      },
    ],
  },

  {
    title: { es: "Buscar un ticket viejo", en: "Finding an old ticket" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Todo está en [[Logs]]. Se busca de tres maneras:",
          en: "Everything is in [[Logs]]. There are three ways to search:",
        },
      },
      {
        kind: "list",
        items: [
          { es: "Por **número de ticket** — por ejemplo *145*, no hace falta escribirlo completo.", en: "By **ticket number** — for example *145*, you do not need the whole thing." },
          { es: "Por **nombre del cliente** o su **teléfono**.", en: "By **customer name** or **phone**." },
          { es: "Por **fecha**. El segundo calendario abre un rango, para buscar entre dos días.", en: "By **date**. The second date picker opens a range, to search between two days." },
        ],
      },
      { kind: "ui", specimen: "logs-search" },
      {
        kind: "warn",
        title: { es: "Si busca un nombre y no sale nada", en: "If a name finds nothing" },
        body: [
          {
            es: "Casi siempre es esto: **la búsqueda solo mira los días que están en pantalla**. Si el ticket es de hace un mes y la pantalla dice hoy, no lo va a encontrar aunque el nombre esté bien escrito. Abra primero las fechas, luego busque. El sistema le pone ese recuadro amarillo justo para recordárselo.",
            en: "It is nearly always this: **the search only looks at the days on screen**. If the ticket is a month old and the screen says today, it will not be found even with the name spelled correctly. Widen the dates first, then search. The system shows that amber box for exactly this reason.",
          },
        ],
      },
    ],
  },

  {
    title: { es: "Lo que Logs esconde y lo que pinta de rojo", en: "What Logs hides, and what it paints red" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "[[Logs]] es la lista de todo lo que pasó, renglón por renglón, en el orden en que pasó. Pero no todo lo que pasó vale la pena leerse dos veces, y la pantalla lo separa en tres.",
          en: "[[Logs]] is the list of everything that happened, row by row, in the order it happened. But not everything that happened is worth reading twice, and the screen sorts it into three.",
        },
      },
      { kind: "h3", text: { es: "El ojito", en: "The little eye" } },
      {
        kind: "p",
        text: {
          es: "A la izquierda del botón [[Today]] hay un **ojito**. Cuando está tachado — así viene siempre que abre la pantalla — la lista **no le enseña los renglones que se pusieron y se quitaron del mismo ticket**.",
          en: "To the left of the [[Today]] button there is a **little eye**. When it has a line through it — which is how the screen always opens — the list is **hiding the lines that were rung and struck off the same ticket**.",
        },
      },
      {
        kind: "p",
        text: {
          es: "Eso no es esconder nada: es que un renglón que alguien escribió mal y corrigió diez segundos después **no es un suceso del día**, es alguien usando la caja. En una tarde ocupada eran la mitad de la lista, y entre ellos se perdían los renglones que sí importan. Toque el ojito y salen todos.",
            en: "That is not hiding anything: a line somebody typed wrong and corrected ten seconds later **is not an event of the day** — it is somebody using the register. On a busy afternoon they were half the list, and the rows that matter got lost among them. Press the eye and they all come back.",
        },
      },
      { kind: "h3", text: { es: "Los tickets anulados salen en rojo", en: "Voided tickets come out red" } },
      {
        kind: "p",
        text: {
          es: "Un **ticket anulado** es otra cosa completamente: es un trabajo que no pasó. Ésos **nunca** se esconden, y ahora salen con el renglón pintado de **rojo claro**, no nada más tachados. Cuando la caja no cuadra en la noche, un ticket anulado es la explicación más común que hay — la lista tiene que enseñárselo desde el otro lado de la pantalla.",
          en: "A **voided ticket** is a different thing entirely: it is a job that did not happen. Those are **never** hidden, and they now come out with the row tinted **light red** rather than merely struck through. When the drawer is short at night a void is the commonest explanation there is — the list has to show it to you from across the screen.",
        },
      },
      {
        kind: "p",
        text: {
          es: "La casilla [[Show voided]] sigue ahí y sigue siendo suya. El ojito y esa casilla **no son lo mismo**: el ojito es para los renglones sueltos, la casilla es para los tickets completos.",
          en: "The [[Show voided]] tickbox is still there and still yours. The eye and that box are **not the same switch**: the eye is about single lines, the box is about whole tickets.",
        },
      },
      {
        kind: "note",
        title: { es: "El dueño puede quitar un renglón de la lista", en: "The owner can take a row off the list" },
        body: [
          {
            es: "Nada más el dueño, y nada más en renglones que ya están muertos — un ticket anulado, un renglón tachado, un pago que ya se revirtió. Sirve para limpiar los tickets de prueba y las correcciones que ya no le dicen nada a nadie. **No mueve ni un centavo**: si el renglón todavía trae dinero vivo, el sistema no lo deja y le dice por qué. Y no se borra nada — el dueño lo sigue viendo en rojo con una etiqueta que dice **deleted**, y lo puede volver a poner con un toque.",
            en: "Only the owner, and only on rows that are already dead — a voided ticket, a struck line, a payment that has been reversed. It is for clearing away test tickets and corrections that no longer tell anybody anything. **It moves no money**: if the row still carries live money the system refuses and says why. And nothing is destroyed — the owner still sees it in red with a **deleted** tag on it, and can put it back with one press.",
          },
        ],
      },
    ],
  },

  {
    title: { es: "El libro de clientes", en: "The customer book" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Desde [[Logs]], el botón [[Customers]] abre el libro de clientes: todos los que alguna vez dejaron su nombre. La lista está a la izquierda, y al tocar un nombre sale todo lo suyo a la derecha.",
          en: "From [[Logs]], the [[Customers]] button opens the customer book: everybody who has ever left a name. The list is on the left, and pressing a name opens everything about them on the right.",
        },
      },
      {
        kind: "list",
        items: [
          { es: "**Sus carros** — año, marca, modelo, color, placas y medida de llanta.", en: "**Their cars** — year, make, model, colour, plate and tire size." },
          { es: "**Todos sus tickets**, del más nuevo al más viejo. Se toca uno y se abre.", en: "**Every ticket of theirs**, newest first. Press one and it opens." },
          { es: "**Un recado clavado**, igual que el de [[Main]]: lo escribe cualquiera y lo ve todo el mundo.", en: "**A pinned note**, exactly like the one on [[Main]]: anybody writes it and everybody sees it." },
        ],
      },
      { kind: "h3", text: { es: "Las tres casillas de arriba", en: "The three tickboxes" } },
      {
        kind: "table",
        head: [{ es: "Casilla", en: "Box" }, { es: "Qué deja en la lista", en: "What it leaves on the list" }],
        rows: [
          [{ es: "Owes money", en: "Owes money" }, { es: "Nada más los que deben algo de algún ticket.", en: "Only the people who still owe on a ticket." }],
          [{ es: "Credit account", en: "Credit account" }, { es: "Nada más los que tienen cuenta abierta con el taller, y de ellos nada más sus tickets de cuenta.", en: "Only the people running a tab with the shop, and of those only their account tickets." }],
          [{ es: "Not approved", en: "Not approved" }, { es: "Los que tienen cuenta y **nadie les autorizó crédito**. Ésa es la lista corta que importa.", en: "The people running a tab that **nobody approved for credit**. That is the short list that matters." }],
        ],
      },
      {
        kind: "note",
        title: { es: "La estrellita", en: "The little star" },
        body: [
          {
            es: "Un gerente puede marcar a un cliente como **Credit approved** desde adentro de su ficha. A partir de ahí le sale una **estrella** enfrente del nombre en la lista, y cuando lo escogen en un ticket nuevo sale un recuadro verde que dice *Store Credit Approved*. Es para que el de la caja no tenga que preguntar.",
            en: "A manager can mark a customer **Credit approved** from inside their card. From then on a **star** appears in front of their name on the list, and when they are picked on a new ticket a green box says *Store Credit Approved*. It is so the person at the counter does not have to go and ask.",
          },
        ],
      },
      {
        kind: "p",
        text: {
          es: "Un gerente puede **corregir** el nombre, el teléfono y los carros, y puede **borrar un carro** que ya vendieron. Borrar al cliente completo es solo del dueño: sus tickets se quedan con su nombre, pero deja de existir para todo el que lo busque.",
          en: "A manager can **correct** the name, the phone and the cars, and can **delete a car** that has been sold on. Deleting the customer outright is the owner's only: their tickets keep their name, but they stop existing for anybody looking them up.",
        },
      },
    ],
  },

  {
    title: { es: "Cuentas de casa", en: "House accounts" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Hay clientes que no pagan en la caja: se les apunta y pagan a fin de mes. Eso se cobra con la forma de pago **Credit Account**, y el ticket queda **pagado** — la caja cuadra en la noche, porque para la caja ese dinero ya no está pendiente.",
          en: "Some customers do not pay at the counter: it goes on the tab and they settle at the end of the month. That is rung against the **Credit Account** tender, and the ticket reads **paid** — the drawer balances at night, because as far as the till is concerned that money is no longer pending.",
        },
      },
      {
        kind: "warn",
        title: { es: "Cuenta de casa no es lo mismo que ticket pendiente", en: "A house account is not an unpaid ticket" },
        body: [
          {
            es: "Un ticket **pendiente** se cobra en la caja, sale en el recuadro de [[Main]] y lo persigue quien esté en el mostrador. Una **cuenta de casa** no: se junta durante semanas, se paga contra el total y no contra ningún ticket, y la lleva una sola persona que no está en el piso. Son dos cosas distintas y no se mezclan.",
            en: "An **unpaid ticket** is settled at the register, sits in the box on [[Main]], and is chased by whoever is at the counter. A **house account** is not: it builds up over weeks, is paid against the total rather than against any one ticket, and is handled by one person who is not on the floor. They are two different things and they do not mix.",
          },
        ],
      },
      { kind: "h3", text: { es: "Quién le puede mover", en: "Who can touch it" } },
      {
        kind: "p",
        text: {
          es: "Nada más el **dueño** y la **contadora**. Un gerente lleva el piso y no tiene nada que ver con lo que alguien debe de un mes.",
          en: "The **owner** and the **accountant**, and nobody else. A manager runs the floor and has no part in what somebody owes over a month.",
        },
      },
      { kind: "h3", text: { es: "Apuntar un pago", en: "Recording a payment" } },
      {
        kind: "steps",
        items: [
          { es: "Abra al cliente y toque [[Record a payment]].", en: "Open the customer and press [[Record a payment]]." },
          { es: "**Cuánto** entró.", en: "**How much** came in." },
          { es: "**Cuándo se pagó** — no cuándo lo está escribiendo. Un cheque con fecha del 3 que llegó al escritorio el 11 es dinero del 3.", en: "**When it was paid** — not when you are typing it. A cheque dated the 3rd that reached the desk on the 11th is the 3rd's money." },
          { es: "**Cómo** — *Cheque 4471*, *efectivo en persona*, *tarjeta por teléfono*.", en: "**How** — *Cheque 4471*, *cash in person*, *card over the phone*." },
          { es: "**A qué cuenta** — *Frost checking*, *la caja*.", en: "**To what account** — *Frost checking*, *the register*." },
        ],
      },
      {
        kind: "note",
        title: { es: "Si se equivocó de cliente", en: "If it went on the wrong customer" },
        body: [
          {
            es: "Toque [[Show payments]], busque el renglón y toque [[Void]]. No se borra: se escribe el contrario. El pago equivocado se queda como constancia de que se hizo, porque la cuenta que quedó baja **de verdad estuvo baja** hasta que alguien lo notó, y un rastro que borra eso vale menos que ningún rastro.",
            en: "Press [[Show payments]], find the row and press [[Void]]. It is not erased: its opposite is written. The wrong payment stays as the record that it was made, because the account it wrongly credited **really did read low** until somebody noticed, and a trail that erases that is worth less than no trail.",
          },
        ],
      },
      { kind: "h3", text: { es: "Lo que se le cargó a la cuenta", en: "What went on the tab" } },
      {
        kind: "p",
        text: {
          es: "Debajo del saldo está la lista de los tickets que se le cargaron. Los cargos que **se cancelaron solos** — un ticket anulado, o una venta que se apuntó a la cuenta y luego se corrigió a la tarjeta que de verdad usó el cliente — **vienen escondidos**, porque son un cargo y su contrario que se anulan entre ellos. El renglón chiquito que dice *show 2 cancelled* los saca.",
          en: "Under the balance is the list of tickets that went on the tab. Charges that **cancelled themselves out** — a voided ticket, or a sale rung to the account and then corrected to the card the customer actually used — are **hidden**, because they are a charge and its opposite that net to nothing. The small *show 2 cancelled* link brings them back.",
        },
      },
      {
        kind: "p",
        text: {
          es: "En el papel **nunca** salen, esté como esté ese botón. Un estado de cuenta que le da al cliente un cargo de $210 y un −$210 al lado le está dando una cuenta que resolver antes de poder leer lo que debe.",
          en: "On paper they **never** appear, whichever way that link is left. A statement that hands the customer a $210 charge and a −$210 beside it has handed them arithmetic to do before they can read what they owe.",
        },
      },
      { kind: "h3", text: { es: "El estado de cuenta", en: "The statement" } },
      {
        kind: "p",
        text: {
          es: "[[Print statement]] saca la hoja del cliente: el membrete del taller, su nombre, el saldo, lo que se le cargó y todos sus pagos. Sale completa aunque los pagos estén escondidos en la pantalla.",
          en: "[[Print statement]] produces that customer's sheet: the shop's letterhead, their name, the balance, what went on and every payment. It comes out whole even when the payments are folded away on screen.",
        },
      },
      { kind: "h3", text: { es: "El mes completo", en: "The whole month" } },
      {
        kind: "p",
        text: {
          es: "El botón [[Accounts this month]], junto a [[← Logs]], abre la hoja del mes: **una línea por cuenta, con cuatro columnas**.",
          en: "The [[Accounts this month]] button, next to [[← Logs]], opens the month's sheet: **one line per account, with four columns**.",
        },
      },
      {
        kind: "table",
        head: [{ es: "Columna", en: "Column" }, { es: "Qué es", en: "What it is" }],
        rows: [
          [{ es: "Owed at the 1st", en: "Owed at the 1st" }, { es: "Lo que debía antes de que empezara el mes.", en: "What they owed before the month started." }],
          [{ es: "Went on", en: "Went on" }, { es: "Lo que se le cargó durante el mes.", en: "What went onto the tab during the month." }],
          [{ es: "Came in", en: "Came in" }, { es: "Lo que pagó durante el mes.", en: "What they paid during the month." }],
          [{ es: "Owed at the end", en: "Owed at the end" }, { es: "Lo que debe ahora.", en: "What they owe now." }],
        ],
      },
      {
        kind: "note",
        title: { es: "Las cuatro columnas se revisan solas", en: "The four columns check each other" },
        body: [
          {
            es: "La primera más la segunda menos la tercera **tiene** que dar la cuarta, en cada renglón y en el total de abajo. Por eso son cuatro y no una: una lista de saldos no se puede revisar contra nada. Si algún día no cuadra, la hoja se lo dice en rojo y no hay que archivarla hasta que alguien la vea.",
            en: "The first plus the second less the third **must** equal the fourth, on every line and on the total at the foot. That is why there are four and not one: a list of balances cannot be checked against anything. If it ever fails to add up the sheet says so in red, and it should not be filed until somebody has looked.",
          },
        ],
      },
      {
        kind: "p",
        text: {
          es: "Abajo va la lista de **todos los pagos del mes** — fecha, cliente, cómo, a qué cuenta y quién lo apuntó. Arriba hay un selector de mes y el botón [[Print]].",
          en: "Below it is the list of **every payment in the month** — date, customer, how, to what account and who recorded it. At the top there is a month picker and a [[Print]] button.",
        },
      },
    ],
  },

  {
    title: { es: "Las hojas de llantas del mes", en: "The month's tire sheets" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Desde [[Logs]], el botón [[Tire movements]] abre el registro de todo lo que ha entrado y salido de los racks. Arriba de esa pantalla hay dos botones que sacan las dos hojas que se piden cada mes.",
          en: "From [[Logs]], the [[Tire movements]] button opens the record of everything that has come in and out of the racks. At the top of that screen are two buttons that produce the two sheets asked for every month.",
        },
      },
      {
        kind: "table",
        head: [{ es: "Botón", en: "Button" }, { es: "Qué saca", en: "What it gives you" }],
        rows: [
          [
            { es: "Sold this month", en: "Sold this month" },
            { es: "Todas las **llantas nuevas vendidas** en el mes, con el total y con el impuesto ya descontado.", en: "Every **new tire sold** in the month, with the total and with the tax backed out." },
          ],
          [
            { es: "Stocked this month", en: "Stocked this month" },
            { es: "Todas las **llantas nuevas que entraron**, con lo que se pagó por ellas y el impuesto descontado.", en: "Every **new tire booked in**, with what was paid for them and the tax backed out." },
          ],
        ],
      },
      {
        kind: "p",
        text: {
          es: "Las dos traen una **pastilla** en cada renglón que dice si esa llanta fue **para un pedido de un cliente** o **del rack**, y abajo un resumen que lo cuenta. Al tocar un botón se pone azul y el registro largo de abajo se esconde, para que la hoja salga sola en el papel. Otro toque y regresa.",
          en: "Both carry a **pill** on each row saying whether that tire was **for a customer's order** or **off the rack**, with a summary at the foot that counts them. Pressing a button turns it blue and folds away the long log underneath, so the sheet prints on its own. Press it again and it comes back.",
        },
      },
      {
        kind: "warn",
        title: { es: "La hoja vale lo que valen los costos capturados", en: "The sheet is only as good as the costs typed in" },
        body: [
          {
            es: "La hoja de lo que entró suma los costos que alguien escribió al recibir la mercancía. Si un costo se capturó mal, el total sale mal, y la hoja no tiene manera de saberlo. Por eso trae ese recuadro ámbar arriba del resumen.",
            en: "The stocked sheet adds up the costs somebody typed when receiving. If a cost was entered wrong the total is wrong, and the sheet has no way to know. That is what the amber box above the summary is for.",
          },
        ],
      },
    ],
  },

  {
    title: { es: "El tablero de Performance del corte", en: "The Performance board on the close-out" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "En el [[Close-out]], el renglón que dice **HOW THE WEEK IS GOING** abre las dos gráficas y el tablero de los técnicos. Viene cerrado a propósito: el corte es una secuencia — contar, registrar, cerrar el lote, firmar — y esas dos cosas no son un paso de esa secuencia, son para leerse cuando el dinero ya está guardado.",
          en: "On the [[Close-out]], the line reading **HOW THE WEEK IS GOING** opens the two charts and the technicians' board. It comes shut on purpose: the close-out is a sequence — count, log, settle, sign — and neither of those is a step in it. They are for reading once the money is away.",
        },
      },
      {
        kind: "p",
        text: {
          es: "Adentro hay un selector con cuatro maneras de leerlo:",
          en: "Inside there is a picker with four ways to read it:",
        },
      },
      {
        kind: "table",
        head: [
          { es: "Opción", en: "Option" },
          { es: "Compara el trabajo contra…", en: "Compares the work against…" },
          { es: "Y en la columna de propinas enseña…", en: "And the tips column shows…" },
        ],
        rows: [
          [
            { es: "Default", en: "Default" },
            { es: "La semana pasada.", en: "Last week." },
            { es: "Las propinas **de hoy**. Es exactamente lo que sale impreso.", en: "**Today's** tips. This is exactly what prints." },
          ],
          [
            { es: "By day", en: "By day" },
            { es: "El **último día que ese técnico estuvo**, no ayer.", en: "The **last day that technician was in**, not yesterday." },
            { es: "Las de hoy contra las de ese día.", en: "Today's against that day's." },
          ],
          [
            { es: "By week", en: "By week" },
            { es: "La semana pasada.", en: "Last week." },
            { es: "Las de esta semana contra las de la pasada.", en: "This week's against last week's." },
          ],
          [
            { es: "By month", en: "By month" },
            { es: "Los mismos días del mes pasado.", en: "The same days of last month." },
            { es: "Las de este mes contra las del pasado.", en: "This month's against last month's." },
          ],
        ],
      },
      {
        kind: "note",
        title: { es: "Por qué **By day** no compara contra ayer", en: "Why **By day** does not compare against yesterday" },
        body: [
          {
            es: "Porque no todos vienen todos los días. Medido contra el día de ayer, el que descansó sale en rojo con −100% al lado de los que sí vinieron — y eso no dice nada de él más que en qué días le tocó descansar. Cada quien se compara contra **su** último día de trabajo, que es la pregunta que sí se puede contestar.",
            en: "Because not everybody is in every day. Measured against yesterday, anyone who was off shows red at −100% beside the people who were there — which says nothing about them except which days they had off. Each person is measured against **their own** last shift, which is the question that can actually be answered.",
          },
        ],
      },
      {
        kind: "warn",
        title: { es: "El selector no cambia el papel", en: "The picker does not change the paper" },
        body: [
          {
            es: "La hoja impresa **siempre** sale en Default — la semana, con las propinas de hoy — esté como esté el selector. Un corte se archiva y se compara contra otros cortes: una columna que un día dijera *este mes* y otro día *hoy* haría ilegible el montón entero. Y en el papel la columna de propinas contesta *qué se lleva cada quien esta noche*, que no es un total de la semana.",
            en: "The printed sheet **always** comes out on Default — the week, with today's tips — whatever the picker says. A close-out is filed and compared against other close-outs: a column that said *this month* on one night and *today* on another would make the whole stack unreadable. And on paper that column answers *what is going home in whose pocket tonight*, which is not a weekly total.",
          },
        ],
      },
    ],
  },

  {
    title: { es: "El tablero de la pared", en: "The wall board" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Es la pantalla que se cuelga donde la vea el taller. No pide PIN, se actualiza sola cada medio minuto, y no hay nada que apretarle.",
          en: "The screen hung where the floor can see it. No PIN, refreshes itself every half minute, and there is nothing on it to press.",
        },
      },
      {
        kind: "list",
        items: [
          { es: "**Arriba:** quién va adelante, en la categoría que esté escogida.", en: "**Top:** who is ahead, in whichever category is selected." },
          { es: "**Abajo a la izquierda:** las propinas de hoy.", en: "**Bottom left:** today's tips." },
          { es: "**Abajo a la derecha:** los últimos tickets cobrados.", en: "**Bottom right:** the last tickets rung." },
        ],
      },
      {
        kind: "note",
        title: { es: "Por qué las propinas salen en porcentaje", en: "Why tips show as a share" },
        body: [
          {
            es: "Porque los clientes también ven esa pantalla, y un cliente que se entera de cuánto ganaron los técnicos en propinas hoy bien puede decidir quedarse con sus cinco dólares. El botón [[Show the dollars]] enseña los montos **un minuto** y se apaga solo — a propósito, porque el error de ese botón es apretarlo e irse.",
            en: "Because customers can see that screen too, and a customer who learns what the technicians made in tips today may well decide to keep his five dollars. [[Show the dollars]] puts the amounts up for **one minute** and takes them down by itself — deliberately, because the failure of that button is pressing it and walking off.",
          },
        ],
      },
      {
        kind: "p",
        text: {
          es: "Un ticket con propina se ve con **orilla dorada** y el monto en un recuadro dorado, para que se distinga desde el otro lado del taller.",
          en: "A tipped ticket carries a **gold edge** and the amount in a gold badge, so it reads from the far side of the shop.",
        },
      },
    ],
  },

  {
    title: { es: "Quién puede hacer qué", en: "Who can do what" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Cada persona ve nada más lo que le toca. Si una pestaña o un botón no le aparece, **no está descompuesto**: su puesto no lo tiene.",
          en: "Each person sees only what belongs to them. If a tab or a button is not there, **nothing is broken**: your role does not have it.",
        },
      },
      {
        kind: "table",
        head: [
          { es: "Puede…", en: "Can…" },
          { es: "Técnico", en: "Technician" },
          { es: "Writer", en: "Writer" },
          { es: "Cajero", en: "Cashier" },
          { es: "Contadora", en: "Accountant" },
          { es: "Gerente", en: "Manager" },
        ],
        rows: [
          [{ es: "Ver inventario y precios", en: "See stock and prices" }, { es: "Sí", en: "Yes" }, { es: "Sí", en: "Yes" }, { es: "Sí", en: "Yes" }, { es: "Sí", en: "Yes" }, { es: "Sí", en: "Yes" }],
          [{ es: "Hacer tickets y cobrar", en: "Ring tickets and take money" }, { es: "No", en: "No" }, { es: "Sí", en: "Yes" }, { es: "Sí", en: "Yes" }, { es: "Sí", en: "Yes" }, { es: "Sí", en: "Yes" }],
          [{ es: "Ver Main", en: "See Main" }, { es: "No", en: "No" }, { es: "Sí", en: "Yes" }, { es: "Sí", en: "Yes" }, { es: "Sí", en: "Yes" }, { es: "Sí", en: "Yes" }],
          [{ es: "Ver Logs", en: "See Logs" }, { es: "No", en: "No" }, { es: "No", en: "No" }, { es: "Sí", en: "Yes" }, { es: "Sí", en: "Yes" }, { es: "Sí", en: "Yes" }],
          [{ es: "Hacer el corte", en: "Run the close-out" }, { es: "No", en: "No" }, { es: "No", en: "No" }, { es: "Sí", en: "Yes" }, { es: "Sí", en: "Yes" }, { es: "Sí", en: "Yes" }],
          [{ es: "Anular y devolver", en: "Void and refund" }, { es: "No", en: "No" }, { es: "No", en: "No" }, { es: "No", en: "No" }, { es: "No", en: "No" }, { es: "Sí", en: "Yes" }],
          [{ es: "Corregir un pago ya cobrado", en: "Correct a payment already taken" }, { es: "No", en: "No" }, { es: "No", en: "No" }, { es: "No", en: "No" }, { es: "No", en: "No" }, { es: "Sí", en: "Yes" }],
          [{ es: "Recibir mercancía", en: "Receive stock" }, { es: "No", en: "No" }, { es: "No", en: "No" }, { es: "No", en: "No" }, { es: "No", en: "No" }, { es: "Sí", en: "Yes" }],
          [{ es: "Sacar dinero de la caja", en: "Take cash out of the drawer" }, { es: "No", en: "No" }, { es: "No", en: "No" }, { es: "No", en: "No" }, { es: "No", en: "No" }, { es: "Sí", en: "Yes" }],
          [{ es: "Corregir clientes y sus carros", en: "Correct customers and their cars" }, { es: "No", en: "No" }, { es: "No", en: "No" }, { es: "No", en: "No" }, { es: "Sí", en: "Yes" }, { es: "Sí", en: "Yes" }],
          [{ es: "Ver y cobrar cuentas de casa", en: "See and settle house accounts" }, { es: "No", en: "No" }, { es: "No", en: "No" }, { es: "No", en: "No" }, { es: "Sí", en: "Yes" }, { es: "No", en: "No" }],
        ],
      },
      {
        kind: "note",
        title: { es: "La contadora", en: "The accountant" },
        body: [
          {
            es: "Es el único puesto que **no** es una escalera. Para el piso vale lo mismo que un cajero — hace tickets, cobra, hace el corte — y en la pestaña de clientes puede todo lo que puede el dueño. En cambio no anula tickets ni recibe mercancía, porque nada de eso es su trabajo. Es a propósito: **el dinero de las cuentas de casa lo tocan dos personas y nada más**, ella y el dueño.",
            en: "The one role that is **not** a rung on the ladder. On the floor it is worth exactly what a cashier is worth — rings tickets, takes money, runs the close-out — and in the customer tab it can do everything the owner can. It cannot void tickets or receive stock, because neither is its job. That is deliberate: **house-account money is touched by two people and no more**, the accountant and the owner.",
          },
        ],
      },
      {
        kind: "note",
        title: { es: "Arriba de gerente", en: "Above manager" },
        body: [
          {
            es: "Hay unas cuantas cosas que solo el dueño puede hacer — costos, sueldos, dar de alta gente y los ajustes del sistema. No están en este manual a propósito: si le hace falta alguna, es porque hay que pedírsela a él.",
            en: "A few things only the owner can do — costs, pay, adding people and the system settings. They are deliberately not in this manual: if you need one of them, it is because it has to be asked for.",
          },
        ],
      },
      {
        kind: "note",
        title: { es: "Si necesita algo que no le aparece", en: "If you need something that is not there" },
        body: [
          {
            es: "Pídaselo a un gerente. No le pida a nadie que le preste su cuenta — vea la sección 1.",
            en: "Ask a manager. Do not ask anybody to lend you their sign-in — see section 1.",
          },
        ],
      },
    ],
  },

  {
    title: { es: "Problemas comunes", en: "Common problems" },
    blocks: [
      {
        kind: "table",
        head: [{ es: "Si pasa esto…", en: "If this happens…" }, { es: "Haga esto", en: "Do this" }],
        rows: [
          [{ es: "La pantalla se trabó o se ve rara", en: "The screen is stuck or looks wrong" }, { es: "Mantenga **Ctrl** y **Shift** y toque **R**. Se vuelve a cargar sin perder nada.", en: "Hold **Ctrl** and **Shift** and press **R**. It reloads without losing anything." }],
          [{ es: "No reconoce mi PIN", en: "It will not take my PIN" }, { es: "Revise que haya tocado su nombre **primero**. Ése es el error de siempre.", en: "Check you tapped your name **first**. That is the usual mistake." }],
          [{ es: "No me aparece una pestaña", en: "A tab is missing" }, { es: "Su puesto no la tiene. Vea la sección de permisos.", en: "Your role does not have it. See the permissions section." }],
          [{ es: "Cobré con la forma de pago equivocada", en: "I took money on the wrong tender" }, { es: "Dígale a un gerente **hoy mismo**. Se corrige desde el ticket.", en: "Tell a manager **today**. It is corrected from the ticket." }],
          [{ es: "Cobré de más o de menos", en: "I charged the wrong amount" }, { es: "Si todavía no cierra el ticket, corríjalo usted. Si ya cerró, un gerente.", en: "If the ticket is not closed yet, fix it yourself. If it is closed, a manager." }],
          [{ es: "Se fue la luz", en: "The power went out" }, { es: "Prenda y entre normal. Los tickets ya cobrados no se pierden.", en: "Switch on and sign in as normal. Tickets already taken are not lost." }],
          [{ es: "El recibo sale cortado", en: "The receipt prints cut off" }, { es: "En la ventana de imprimir, papel **Letter** y escala **100%**.", en: "In the print dialog: paper **Letter**, scale **100%**." }],
          [{ es: "No sé qué acabo de apretar", en: "I do not know what I just pressed" }, { es: "Si salió un aviso, toque el botón **gris**. Ése nunca hace nada.", en: "If a box appeared, press the **grey** button. That one never does anything." }],
        ],
      },
    ],
  },

  {
    title: { es: "Palabras que hay que saber", en: "Words worth knowing" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Si una palabra de la pantalla no le suena, búsquela aquí:",
          en: "If a word on the screen does not mean anything to you, it is here:",
        },
      },
      {
        kind: "table",
        head: [{ es: "Palabra", en: "Word" }, { es: "Qué quiere decir aquí", en: "What it means here" }],
        rows: [
          [{ es: "Sold", en: "Sold" }, { es: "Lo que cobramos por el trabajo de hoy.", en: "What we charged for today's work." }],
          [{ es: "Collected", en: "Collected" }, { es: "El dinero que entró hoy.", en: "The money that came in today." }],
          [{ es: "Pending", en: "Pending" }, { es: "Trabajo hecho que nadie ha pagado.", en: "Work done that nobody has paid for." }],
          [{ es: "Outstanding", en: "Outstanding" }, { es: "Ticket que está esperando algo — llanta o cliente.", en: "A ticket waiting on something — a tire or a customer." }],
          [{ es: "Tender", en: "Tender" }, { es: "La forma de pago.", en: "The way something was paid." }],
          [{ es: "Void", en: "Void" }, { es: "Anular: el ticket no debió existir.", en: "The ticket should never have existed." }],
          [{ es: "Refund", en: "Refund" }, { es: "Devolución: la venta pasó, y después se regresó.", en: "The sale happened, and was returned afterwards." }],
          [{ es: "Balance / Balance due", en: "Balance due" }, { es: "Lo que todavía debe el cliente.", en: "What the customer still owes." }],
          [{ es: "Expected", en: "Expected" }, { es: "Lo que el sistema calcula que debería haber.", en: "What the system works out should be there." }],
          [{ es: "Counted", en: "Counted" }, { es: "Lo que usted contó con la mano.", en: "What you counted by hand." }],
          [{ es: "Difference", en: "Difference" }, { es: "La diferencia entre las dos de arriba.", en: "The gap between those two." }],
          [{ es: "Batch", en: "Batch" }, { es: "El lote de la terminal de tarjetas, que se cierra en la noche.", en: "The card terminal's batch, settled at night." }],
          [{ es: "Credit Account / House account", en: "Credit Account / house account" }, { es: "La cuenta abierta de un cliente que paga a fin de mes. No es un ticket pendiente.", en: "A customer's running tab, settled at the end of the month. Not an unpaid ticket." }],
          [{ es: "Statement", en: "Statement" }, { es: "La hoja de una cuenta: saldo, cargos y pagos.", en: "One account's sheet: balance, charges and payments." }],
          [{ es: "Approved / Credit approved", en: "Approved / Credit approved" }, { es: "Que un gerente sí autorizó a ese cliente a llevar cuenta. Sale una estrella junto a su nombre.", en: "That a manager did agree to carry this customer on a tab. A star appears by their name." }],
          [{ es: "Audited", en: "Audited" }, { es: "Que alguien revisó **ese** cargo y quedó conforme. No autoriza al cliente.", en: "That somebody looked at **that one** charge and was satisfied. It does not approve the customer." }],
          [{ es: "Fulfil", en: "Fulfil" }, { es: "Cerrar un pedido: la llanta ya está en el carro del cliente.", en: "Close out an order: the tire is on the customer's car." }],
        ],
      },
    ],
  },

  {
    title: { es: "Las tres reglas", en: "The three rules" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Si no se acuerda de nada más de este manual, acuérdese de estas tres.",
          en: "If nothing else here stays with you, keep these three.",
        },
      },
      {
        kind: "steps",
        items: [
          { es: "**El botón gris nunca hace nada.** Cuando salga un aviso y no esté seguro, toque el gris. Siempre se puede volver a empezar.", en: "**The grey button never does anything.** When a box appears and you are not sure, press the grey one. You can always start again." },
          { es: "**Escriba lo que de verdad pasó.** Nunca acomode un número para que cuadre. El sistema aguanta un error; no aguanta un error escondido.", en: "**Write down what actually happened.** Never tidy a number to make it balance. The system copes with a mistake; it does not cope with a hidden one." },
          { es: "**Dígalo el mismo día.** Casi todo se corrige fácil hoy y se vuelve un problema en dos semanas.", en: "**Say so the same day.** Almost everything is easy to correct today and a problem in a fortnight." },
        ],
      },
    ],
  },
  {
    title: { es: "Cuentas de empresa (flotillas)", en: "Company accounts (fleets)" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Una **empresa** es un cliente que paga la cuenta de varios choferes. Williams Insulation es una empresa; sus choferes llegan con las trocas de la compañía y lo que se cobra va a la cuenta de Williams, no a la de cada quien. Un chofer que tiene su propio crédito y no trabaja para nadie sigue igual que siempre — esto no lo cambia.",
          en: "A **company** is a customer whose account several drivers charge to. Williams Insulation is a company; its drivers come in with company trucks and what they spend goes on the Williams account, not on their own. A driver with his own credit who works for nobody stays exactly as he is — none of this changes him.",
        },
      },
      {
        kind: "note",
        title: { es: "La regla, en una línea", en: "The rule, in one line" },
        body: [
          {
            es: "**Si un cliente está asignado a una empresa, todo lo que cargue a cuenta es de la empresa.** Por eso no hay que escoger nada al cobrar: se escoge una sola vez, cuando se da de alta al chofer. Un chofer que debe facturarse aparte simplemente NO se asigna a la empresa.",
            en: "**If a customer is assigned to a company, everything they put on account belongs to the company.** That is why there is nothing to choose when you take payment: it is chosen once, when the driver is set up. A driver who must be billed separately is simply not assigned to a company.",
          },
        ],
      },
      { kind: "h3", text: { es: "Paso 1 · Marcar la empresa", en: "Step 1 · Mark the company" } },
      {
        kind: "steps",
        items: [
          { es: "Vaya a [[Customers]] y busque la empresa — por ejemplo *Williams Insulation*. Si todavía no existe (como *Carrillo Construction*), tóquele [[New customer]] y créela primero con el nombre de la compañía.", en: "Go to [[Customers]] and find the company — say *Williams Insulation*. If it does not exist yet (like *Carrillo Construction*), press [[New customer]] and create it first, under the company's name." },
          { es: "Con la empresa abierta, palomee **[[This is a company others can be billed to]]**.", en: "With the company open, tick **[[This is a company others can be billed to]]**." },
          { es: "Asegúrese de que tenga palomeado **[[Store credit approved]]**. Eso es lo que dice que el taller sí le fía a esa compañía.", en: "Make sure **[[Store credit approved]]** is ticked as well. That is what says the shop carries that company." },
        ],
      },
      {
        kind: "note",
        title: { es: "Qué acaba de pasar", en: "What just happened" },
        body: [
          {
            es: "Esa compañía ya aparece en la lista de **[[Billed to]]** en todas las pantallas donde se da de alta un cliente. Todavía no cambió ningún saldo — nada más quedó lista para recibir choferes.",
            en: "That company now appears in the **[[Billed to]]** list on every screen where a customer is set up. No balance has changed yet — it is simply ready to take drivers." },
        ],
      },
      { kind: "h3", text: { es: "Paso 2 · Dar de alta al chofer", en: "Step 2 · Add the driver" } },
      {
        kind: "p",
        text: {
          es: "Hay dos caminos y los dos dejan lo mismo. Use el que le quede a la mano en el momento.",
          en: "There are two ways in and they leave the same result. Use whichever is in front of you at the time.",
        },
      },
      {
        kind: "steps",
        items: [
          { es: "**Desde el libro de clientes.** [[Customers]] → [[New customer]]. Escriba el nombre del chofer y su teléfono, y en **[[Billed to]]** escoja la empresa. Toque [[Add them]].", en: "**From the customer book.** [[Customers]] → [[New customer]]. Type the driver's name and phone, and under **[[Billed to]]** pick the company. Press [[Add them]]." },
          { es: "**Desde una venta.** Cobre normal: ponga el nombre del chofer y su troca en el ticket, y al escoger **[[Credit Account]]** aparece un recuadro azul que dice [[Billed to]]. Escoja ahí la empresa. Se queda guardado para siempre — no hay que volver a hacerlo el mes que entra.", en: "**From a sale.** Ring it as normal: put the driver's name and truck on the ticket, and when you choose **[[Credit Account]]** a blue box appears saying [[Billed to]]. Pick the company there. It is remembered for good — you do not do it again next month." },
        ],
      },
      {
        kind: "note",
        title: { es: "Qué acaba de pasar", en: "What just happened" },
        body: [
          {
            es: "El chofer quedó **asignado a la empresa**. Desde ese momento cada cargo suyo a cuenta se suma al saldo de la compañía — y el ticket **sigue llevando el nombre del chofer y su troca**, que es lo que después permite decirle a la empresa exactamente quién gastó qué.",
            en: "The driver is now **assigned to the company**. From that moment every account charge of his adds to the company's balance — and the ticket **still carries the driver's name and his truck**, which is what later lets you tell the company exactly who spent what.",
          },
        ],
      },
      {
        kind: "note",
        title: { es: "La troca también entra", en: "The truck comes with him" },
        body: [
          {
            es: "El vehículo que se capture en el ticket del chofer aparece también en la hoja de la empresa. No hay que capturarlo dos veces ni darlo de alta aparte.",
            en: "A vehicle captured on the driver's ticket also shows on the company's sheet. There is no second place to enter it and nothing to register separately.",
          },
        ],
      },
      { kind: "h3", text: { es: "Paso 3 · Cobrar como siempre", en: "Step 3 · Ring it as normal" } },
      {
        kind: "p",
        text: {
          es: "No hay ningún paso nuevo al cobrar. Se pone al chofer en el ticket, se escoge [[Credit Account]], y listo. El cargo se va solo a la cuenta de la empresa.",
          en: "There is no new step when taking payment. Put the driver on the ticket, choose [[Credit Account]], and that is it. The charge goes to the company's account on its own.",
        },
      },
      {
        kind: "warn",
        title: { es: "El saldo del chofer ya no es suyo", en: "The driver's balance is not his any more" },
        body: [
          {
            es: "Si busca al chofer en [[Customers]], su renglón dice a qué empresa se le carga y **no muestra un saldo aparte** — porque no lo tiene. El dinero se ve en la empresa. Si alguien pide \"cuánto debe este chofer\", la respuesta honesta es cuánto ha cargado él a la cuenta de la compañía, y eso está en la hoja de la empresa, renglón por renglón.",
            en: "If you look the driver up in [[Customers]], his row says which company he is billed to and **shows no separate balance** — because he has none. The money lives on the company. If somebody asks \"how much does this driver owe\", the honest answer is how much he has put on the company's account, and that is on the company's sheet, line by line.",
          },
        ],
      },
      { kind: "h3", text: { es: "Paso 4 · La hoja de la empresa", en: "Step 4 · The company's sheet" } },
      {
        kind: "steps",
        items: [
          { es: "[[Customers]] → busque la empresa → toque **[[Statement]] →**.", en: "[[Customers]] → find the company → press **[[Statement]] →**." },
          { es: "Escoja el mes arriba a la derecha y toque [[Print]].", en: "Pick the month at the top right and press [[Print]]." },
        ],
      },
      {
        kind: "p",
        text: {
          es: "La hoja trae cuatro números que cuadran entre sí — **lo que debía al empezar, lo que se cargó, lo que pagó, lo que debe ahora** — y abajo cada cargo con la fecha, el ticket, **el chofer** y la troca. Un cargo hecho directo a nombre de la compañía dice *on the account* en lugar de un chofer.",
          en: "The sheet carries four figures that reconcile — **owed at the start, charged, paid, owed now** — and under them every charge with its date, ticket, **driver** and truck. A charge rung on the company itself says *on the account* where a driver's name would be.",
        },
      },
      {
        kind: "note",
        title: { es: "Para qué sirve la columna del chofer", en: "What the driver column is for" },
        body: [
          {
            es: "Es la diferencia entre mandar un número y mandar un documento. Una empresa que recibe \"$4,200 de marzo\" tiene que confiar; una que recibe la lista con chofer, troca y ticket la puede checar contra sus propios papeles. Un pleito por un cargo se vuelve una consulta de cinco minutos.",
            en: "It is the difference between sending a number and sending a document. A company that receives \"$4,200 for March\" has to take it on trust; one that receives the list with driver, truck and ticket can check it against their own records. An argument about a charge becomes a five-minute lookup.",
          },
        ],
      },
      { kind: "h3", text: { es: "Cosas que va a necesitar", en: "Things you will need" } },
      {
        kind: "table",
        head: [
          { es: "Situación", en: "Situation" },
          { es: "Qué hacer", en: "What to do" },
        ],
        rows: [
          [
            { es: "El chofer se cambió de empresa", en: "The driver moved companies" },
            { es: "Ábralo en [[Customers]] y cambie **[[Billed to]]**. Lo viejo NO se mueve: lo que ya cargó a la empresa anterior sigue siendo de ella, porque así fue.", en: "Open him in [[Customers]] and change **[[Billed to]]**. The past does NOT move: what he already charged to the old company stays theirs, because that is what happened." },
          ],
          [
            { es: "El chofer se va y ahora paga él", en: "The driver leaves and now pays himself" },
            { es: "Cambie **[[Billed to]]** a *Themselves* y palomee su propio [[Store credit approved]] si se le va a fiar.", en: "Change **[[Billed to]]** to *Themselves*, and tick his own [[Store credit approved]] if he is to be carried." },
          ],
          [
            { es: "El dueño de la empresa viene en su carro particular", en: "The company's owner comes in his own car" },
            { es: "Si su cuenta personal está asignada a la empresa, ese cargo también es de la empresa. Si quiere separarlos, haga dos clientes: la persona y la compañía.", en: "If his personal record is assigned to the company, that charge is the company's too. To keep them apart, make two customers: the person and the company." },
          ],
          [
            { es: "La empresa paga", en: "The company pays" },
            { es: "Se recibe en la cuenta de la **empresa**, igual que cualquier abono. Baja el saldo de todos sus choferes de un solo golpe, porque es un solo saldo.", en: "Take it against the **company's** account, like any other payment. It brings down the balance for all its drivers at once, because it is one balance." },
          ],
        ],
      },
      {
        kind: "warn",
        title: { es: "Una empresa no puede estar dentro de otra", en: "A company cannot sit inside another" },
        body: [
          {
            es: "El sistema no lo deja, a propósito. Un solo nivel — empresa y sus choferes — es lo que hace que un saldo se pueda calcular sin ambigüedad. Si de verdad hace falta, hable con quien lleva el sistema antes de inventar un arreglo.",
            en: "The system refuses it, on purpose. One level — a company and its drivers — is what keeps a balance unambiguous. If it is genuinely needed, raise it before inventing a workaround.",
          },
        ],
      },
    ],
  },
];