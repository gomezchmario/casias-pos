import type { Section } from "./manual";

/**
 * The time clock manual, rewritten to the same depth as the register draft.
 *
 * Same three habits as its twin: show the control, say what just happened,
 * define the word. The audience is the same and the failure is the same —
 * somebody presses a thing, nothing visibly changes, and they press it again.
 *
 * Unlike the register manual this one keeps the owner's sections. The clock's
 * admin is one password rather than a ladder of roles, so there is no level to
 * cut it at: whoever has the password sees all of it, and a manual that stopped
 * short would just be a manual with a hole where Settings is.
 */
export const TIMECLOCK_SECTIONS: Section[] = [
  {
    title: { es: "La pantalla del reloj", en: "The clock screen" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Es la pantalla oscura con la hora grande. Está prendida todo el día y no hay que abrirle nada: siempre está lista.",
          en: "The dark screen with the big clock on it. It is on all day and there is nothing to open: it is always ready.",
        },
      },
      { kind: "figure", src: "clock.png", alt: { es: "La pantalla del reloj", en: "The time clock screen" },
        callouts: [
          { x: 50, y: 30, text: { es: "**La cámara.** Se ve usted. La foto se toma sola al marcar.", en: "**The camera.** You see yourself. The photo is taken automatically." } },
          { x: 50, y: 45.5, text: { es: "**Los cuatro puntos.** Se llenan conforme escribe el PIN.", en: "**The four dots.** They fill as you type the PIN." } },
          { x: 50, y: 69, text: { es: "**El teclado.** Los números.", en: "**The keypad.** The digits." } },
          { x: 60.3, y: 90.5, text: { es: "**La tecla ↵.** Se prende con los cuatro números puestos.", en: "**The ↵ key.** It lights up once all four are in." } },
          { x: 91.5, y: 98, text: { es: "**Los enlaces.** Tablero, inventario, este manual y Admin.", en: "**The links.** Board, stock, this manual and Admin." } },
        ] },
      {
        kind: "note",
        title: { es: "No hay que escoger su nombre", en: "There is no name to pick" },
        body: [
          {
            es: "A diferencia de la caja, aquí **no hay lista de nombres**. El PIN por sí solo dice quién es usted. Escríbalo y ya.",
            en: "Unlike the register, there is **no list of names** here. The PIN alone says who you are. Type it and that is all.",
          },
        ],
      },
    ],
  },

  {
    title: { es: "Marcar", en: "Punching" },
    blocks: [
      {
        kind: "steps",
        items: [
          { es: "Escriba su **PIN** de cuatro números.", en: "Type your four-digit **PIN**." },
          { es: "Toque la tecla **↵**.", en: "Press the **↵** key." },
          { es: "El reloj le contesta con su nombre y le dice cómo está:", en: "The clock answers with your name and says where you stand:" },
        ],
      },
      { kind: "ui", specimen: "clock-greeting", caption: { es: "Esto es la confirmación. Si no sale, no marcó.", en: "This is the confirmation. If it does not appear, you did not punch." } },
      {
        kind: "p",
        text: {
          es: "Debajo del saludo salen los botones — **solo los que usted puede usar en ese momento**:",
          en: "Under the greeting come the buttons — **only the ones you can use right now**:",
        },
      },
      { kind: "ui", specimen: "clock-actions" },
      {
        kind: "table",
        head: [{ es: "Botón", en: "Button" }, { es: "Cuándo aparece", en: "When it appears" }, { es: "Qué hace", en: "What it does" }],
        rows: [
          [{ es: "🟢 Check In", en: "🟢 Check In" }, { es: "Cuando está fuera.", en: "When you are out." }, { es: "Empieza su día.", en: "Starts your day." }],
          [{ es: "☕ Take a Break", en: "☕ Take a Break" }, { es: "Cuando está trabajando.", en: "When you are working." }, { es: "Empieza el descanso.", en: "Starts a break." }],
          [{ es: "🟡 End Break", en: "🟡 End Break" }, { es: "Cuando está en descanso.", en: "When you are on a break." }, { es: "Regresa a trabajar.", en: "Puts you back to work." }],
          [{ es: "🔵 Check Out", en: "🔵 Check Out" }, { es: "Cuando está trabajando.", en: "When you are working." }, { es: "Termina su día.", en: "Ends your day." }],
        ],
      },
      {
        kind: "note",
        title: { es: "Qué acaba de pasar", en: "What just happened" },
        body: [
          {
            es: "Se guardó la hora exacta, con su nombre y su foto. **No se puede marcar dos veces seguidas**: si ya está adentro, el botón de entrar ni siquiera aparece. Por eso no hay manera de equivocarse de botón.",
            en: "The exact time was saved, with your name and your photo. **You cannot punch the same thing twice**: if you are already in, the check-in button is not even there. That is why there is no wrong button to press.",
          },
        ],
      },
      {
        kind: "warn",
        title: { es: "Se toma una foto cada vez", en: "A photo is taken every time" },
        body: [
          {
            es: "No es para vigilar a nadie. Es para que, el día que dos personas compartan un PIN o alguien marque por un compañero, se vea. Las fotos se borran solas después de un tiempo.",
            en: "It is not there to watch anybody. It is so that the day two people share a PIN, or somebody punches for a workmate, it shows. The photos delete themselves after a while.",
          },
        ],
      },
    ],
  },

  {
    title: { es: "Descansos", en: "Breaks" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Se marca igual: PIN, **↵**, y luego ☕ **Take a Break**. Al regresar: PIN, **↵**, y 🟡 **End Break**.",
          en: "Punched the same way: PIN, **↵**, then ☕ **Take a Break**. Coming back: PIN, **↵**, and 🟡 **End Break**.",
        },
      },
      {
        kind: "warn",
        title: { es: "Si se le olvidó cerrar el descanso", en: "If you forget to end a break" },
        body: [
          {
            es: "**No** lo arregle marcando salida y entrada. Eso deja el día partido en pedazos que después nadie puede leer. Dígale al dueño: se corrige desde Admin, en [[Time Entries]], con una nota de por qué.",
            en: "Do **not** fix it by punching out and back in. That leaves the day in pieces nobody can read afterwards. Tell the owner: it is corrected in Admin under [[Time Entries]], with a note saying why.",
          },
        ],
      },
    ],
  },

  {
    title: { es: "Si se le olvidó marcar", en: "If you forgot to punch" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Pasa, y tiene arreglo. Lo único que importa es decirlo **el mismo día**, mientras alguien todavía se acuerda de la hora de verdad.",
          en: "It happens, and it is fixable. The only thing that matters is saying so **the same day**, while somebody still remembers the real time.",
        },
      },
      {
        kind: "list",
        items: [
          { es: "**No marque una hora falsa** para emparejar. Queda grabado quién marcó y a qué hora, y se ve peor que el olvido.", en: "**Do not punch a made-up time** to even it out. Who punched and when is recorded, and it looks worse than the mistake." },
          { es: "Dígale al dueño. Él lo corrige y la corrección queda anotada con **su** nombre, no con el de usted.", en: "Tell the owner. They correct it, and the correction is recorded under **their** name, not yours." },
        ],
      },
      {
        kind: "note",
        title: { es: "El reloj cierra solo en la noche", en: "The clock closes itself at night" },
        body: [
          {
            es: "Si alguien se va sin marcar salida, el sistema le cierra el día a la hora de cierre del taller. Eso evita turnos de veinte horas en el reporte — pero la hora que queda escrita es la del cierre, **no la que usted se fue**. Si le pasó, dígalo, o le van a pagar de menos o de más.",
            en: "If somebody leaves without clocking out, the system closes their day at the shop's closing hour. That stops twenty-hour shifts appearing in the report — but the time written is the closing hour, **not when you actually left**. If it happened to you, say so, or you will be paid wrong.",
          },
        ],
      },
    ],
  },

  {
    title: { es: "Los enlaces de abajo", en: "The links at the bottom" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Abajo a la derecha hay cuatro enlaces chiquitos. Tres no piden nada; el último sí.",
          en: "Bottom right there are four small links. Three ask for nothing; the last one does.",
        },
      },
      {
        kind: "table",
        head: [{ es: "Enlace", en: "Link" }, { es: "Qué abre", en: "What it opens" }, { es: "Pide clave", en: "Asks for a password" }],
        rows: [
          [{ es: "[[Leaderboard]]", en: "[[Leaderboard]]" }, { es: "El tablero de la pared.", en: "The wall board." }, { es: "No", en: "No" }],
          [{ es: "[[Inventory]]", en: "[[Inventory]]" }, { es: "Qué llantas hay y de qué medida.", en: "What tires are on the racks." }, { es: "No", en: "No" }],
          [{ es: "[[Help]]", en: "[[Help]]" }, { es: "Este manual.", en: "This manual." }, { es: "No", en: "No" }],
          [{ es: "[[Admin]]", en: "[[Admin]]" }, { es: "La administración del reloj.", en: "The clock's admin side." }, { es: "Sí", en: "Yes" }],
        ],
      },
      {
        kind: "note",
        title: { es: "Por qué esos tres están abiertos", en: "Why those three are open" },
        body: [
          {
            es: "Porque atrás de una clave nadie los usaría. “¿Tenemos una 215 55 17?” se pregunta veinte veces al día, casi siempre con las manos ocupadas, y la respuesta que sirve es la que se consigue sin parar. Ninguno de los tres enseña costos ni el dinero de nadie.",
            en: "Because behind a password nobody would use them. Whether we have a 215 55 17 gets asked twenty times a day, usually by somebody with their hands full, and the answer that gets used is the one you can get without stopping. None of the three shows costs or anybody's pay.",
          },
        ],
      },
    ],
  },

  {
    title: { es: "Admin — qué hay adentro", en: "Admin — what is in it" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "Admin es la administración del reloj. Se entra con **usuario y contraseña**, no con PIN — es otra puerta a propósito. Del lado izquierdo está el menú:",
          en: "Admin is the clock's management side. It takes a **username and password**, not a PIN — a different door on purpose. The menu is down the left:",
        },
      },
      { kind: "ui", specimen: "admin-nav", caption: { es: "El renglón más claro es en el que está.", en: "The lighter row is where you are." } },
      {
        kind: "table",
        head: [{ es: "Sección", en: "Section" }, { es: "Qué hace ahí", en: "What you do there" }],
        rows: [
          [{ es: "▦ Dashboard", en: "▦ Dashboard" }, { es: "Quién está adentro ahorita y cómo va la semana. Es la pantalla de llegar.", en: "Who is in right now and how the week is going. The screen you land on." }],
          [{ es: "👥 Employees", en: "👥 Employees" }, { es: "Dar de alta gente, cambiar PIN, dar acceso a la caja, dar de baja.", en: "Add people, change PINs, grant register access, deactivate." }],
          [{ es: "🔑 Permissions", en: "🔑 Permissions" }, { es: "Qué puede hacer cada nivel y quién tiene cuál.", en: "What each level can do and who has which." }],
          [{ es: "🕒 Time Entries", en: "🕒 Time Entries" }, { es: "Ver y corregir las marcas del reloj.", en: "See and correct clock punches." }],
          [{ es: "📈 Reports", en: "📈 Reports" }, { es: "Horas de la semana por empleado.", en: "Weekly hours by employee." }],
          [{ es: "📜 Audit Log", en: "📜 Audit Log" }, { es: "Todo lo que se cambió, quién y cuándo.", en: "Everything that changed, by whom and when." }],
          [{ es: "⚙ Settings", en: "⚙ Settings" }, { es: "Los ajustes del taller y la contraseña de Admin.", en: "Shop settings and the Admin password." }],
        ],
      },
    ],
  },

  {
    title: { es: "Empleados", en: "Employees" },
    blocks: [
      { kind: "h3", text: { es: "Dar de alta a alguien", en: "Adding somebody" } },
      {
        kind: "steps",
        items: [
          { es: "Entre a [[Employees]] y agregue el empleado.", en: "Open [[Employees]] and add the employee." },
          { es: "Nombre y puesto — por ejemplo *Tech* o *Front Desk*.", en: "Name and title — for example *Tech* or *Front Desk*." },
          { es: "Un **PIN de cuatro números**. Con ése va a marcar en el reloj.", en: "A **four-digit PIN**. That is what they punch with." },
          { es: "Si además va a usar la caja, préndale **POS access** y escójale su puesto.", en: "If they will also use the register, switch on **POS access** and pick their role." },
        ],
      },
      {
        kind: "note",
        title: { es: "Qué acaba de pasar", en: "What just happened" },
        body: [
          {
            es: "Esa persona ya puede marcar en el reloj con su PIN. Si le dio **POS access**, también puede entrar a la caja — ahí sí le va a aparecer su nombre en la lista.",
            en: "That person can now punch the clock with their PIN. If you gave them **POS access**, they can also sign into the register — and there their name does appear in the list.",
          },
        ],
      },
      {
        kind: "warn",
        title: { es: "Nunca borre a un empleado", en: "Never delete an employee" },
        body: [
          {
            es: "Désele de baja cambiando su estado. Borrarlo se llevaría también **las horas que trabajó y los tickets que hizo**, y ésos son el registro del taller, no del empleado. Dado de baja ya no puede marcar ni entrar, y todo lo que hizo sigue ahí.",
            en: "Deactivate them by changing their status. Deleting would take **their hours and their tickets** with them, and those are the shop's record, not the employee's. Deactivated, they can no longer punch or sign in, and everything they did stays.",
          },
        ],
      },
      { kind: "h3", text: { es: "Cambiar un PIN", en: "Changing a PIN" } },
      {
        kind: "p",
        text: {
          es: "Desde la ficha del empleado. Hágalo el mismo día que alguien sospeche que otro se lo aprendió: el PIN es lo que le pone nombre a cada marca y a cada ticket, así que un PIN prestado es un registro que ya no prueba nada.",
          en: "From the employee's record. Do it the day anybody suspects somebody else has learned it: the PIN is what puts a name on every punch and every ticket, so a borrowed PIN is a record that no longer proves anything.",
        },
      },
    ],
  },

  {
    title: { es: "Corregir horas", en: "Correcting hours" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "En [[Time Entries]] están todas las marcas: entrada, salida, inicio y fin de descanso — cada una con su hora, su foto y sus notas.",
          en: "[[Time Entries]] holds every punch: check in, check out, break start and break end — each with its time, its photo and its notes.",
        },
      },
      {
        kind: "steps",
        items: [
          { es: "Busque el día y el empleado.", en: "Find the day and the employee." },
          { es: "Corrija la hora que está mal.", en: "Correct the time that is wrong." },
          { es: "**Escriba una nota** diciendo por qué. Ésta es la parte que importa.", en: "**Write a note** saying why. This is the part that matters." },
        ],
      },
      {
        kind: "warn",
        title: { es: "La nota no es papeleo", en: "The note is not paperwork" },
        body: [
          {
            es: "Una hora cambiada sin explicación se ve **exactamente igual** que una hora cambiada por conveniencia, y en tres meses nadie va a poder distinguirlas — ni usted. La nota es lo único que convierte una corrección en un registro.",
            en: "A time changed with no reason looks **exactly like** a time changed for convenience, and in three months nobody will tell them apart — including you. The note is the only thing that turns a correction into a record.",
          },
        ],
      },
      {
        kind: "note",
        title: { es: "Qué acaba de pasar", en: "What just happened" },
        body: [
          {
            es: "La hora quedó corregida y el cambio se anotó en [[Audit Log]] con su nombre y la hora en que lo hizo. La marca original no se borra: queda el antes y el después.",
            en: "The time is corrected and the change is written into [[Audit Log]] with your name and when you did it. The original punch is not deleted: the before and the after both stay.",
          },
        ],
      },
    ],
  },

  {
    title: { es: "Reportes de horas", en: "Hours reports" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "[[Reports]] da las horas de la semana: **trabajadas**, **de descanso**, y el desglose día por día. Se puede ver a una persona o a todas.",
          en: "[[Reports]] gives the week's hours: **worked**, **on break**, and the day-by-day breakdown. One person or everybody.",
        },
      },
      {
        kind: "warn",
        title: { es: "La semana empieza el día que usted diga", en: "The week starts when you say" },
        body: [
          {
            es: "En [[Settings]] se escoge con qué día empieza la semana. **Póngalo igual que como paga.** Si el reporte empieza en domingo y usted paga de lunes a lunes, los totales nunca van a coincidir con la nómina y va a parecer que el reloj está mal.",
            en: "[[Settings]] is where the week's first day is chosen. **Set it to match how you pay.** If the report starts on Sunday and you pay Monday to Monday, the totals will never line up with payroll and it will look as though the clock is wrong.",
          },
        ],
      },
    ],
  },

  {
    title: { es: "Ajustes", en: "Settings" },
    blocks: [
      {
        kind: "p",
        text: { es: "Lo que se cambia en [[Settings]] y por qué importa:", en: "What [[Settings]] changes and why it matters:" },
      },
      {
        kind: "table",
        head: [{ es: "Ajuste", en: "Setting" }, { es: "Qué hace", en: "What it does" }, { es: "Si lo pone mal", en: "Get it wrong and" }],
        rows: [
          [{ es: "Nombre, dirección, teléfono", en: "Name, address, phone" }, { es: "Lo que sale impreso en los recibos.", en: "What prints on receipts." }, { es: "Los recibos salen con datos viejos.", en: "Receipts go out with stale details." }],
          [{ es: "Día en que empieza la semana", en: "Week start day" }, { es: "Cómo se agrupan las horas.", en: "How hours are grouped." }, { es: "El reporte no cuadra con la nómina.", en: "The report will not match payroll." }],
          [{ es: "Hora de cierre automático", en: "Auto-close hour" }, { es: "A qué hora se cierra a quien no marcó salida.", en: "When anybody who did not clock out is closed." }, { es: "Turnos larguísimos, o cerrados antes de tiempo.", en: "Enormous shifts, or people closed too early." }],
          [{ es: "Descanso descontado", en: "Break auto-deduct" }, { es: "Minutos que se quitan solos. En cero no se quita nada.", en: "Minutes taken off automatically. At zero, nothing." }, { es: "Se paga de más o de menos, todos los días.", en: "Everybody is paid wrong, every day." }],
          [{ es: "Días que se guardan las fotos", en: "Photo retention" }, { es: "Cuánto tardan en borrarse las fotos del reloj.", en: "How long the clock's photos are kept." }, { es: "Se llena el disco, o se borran antes de servir.", en: "The disk fills, or they go before they are useful." }],
          [{ es: "Contraseña de Admin", en: "Admin password" }, { es: "La clave de esta sección.", en: "The password for this section." }, { es: "Cámbiela si alguien más la supo.", en: "Change it if anybody else learns it." }],
        ],
      },
    ],
  },

  {
    title: { es: "El registro de cambios", en: "The audit log" },
    blocks: [
      {
        kind: "p",
        text: {
          es: "[[Audit Log]] guarda **todo** lo que se cambió: qué se hizo, sobre qué, quién y cuándo. No se puede borrar ni editar, ni siquiera desde ahí.",
          en: "[[Audit Log]] keeps **everything** that changed: what was done, to what, by whom and when. It cannot be deleted or edited, not even from inside it.",
        },
      },
      {
        kind: "p",
        text: {
          es: "Sirve para una sola cosa, y con eso basta: contestar **“¿quién le movió a esto?”** sin que sea la palabra de uno contra la del otro.",
          en: "It is good for one thing, and that is enough: answering **\"who changed this\"** without it being one person's word against another's.",
        },
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
          [{ es: "El reloj no acepta mi PIN", en: "The clock will not take my PIN" }, { es: "Revise que sean cuatro números. Si sigue, puede que le hayan dado de baja — dígale al dueño.", en: "Check it is four digits. If it still fails you may have been deactivated — tell the owner." }],
          [{ es: "Marqué y no pasó nada", en: "I punched and nothing happened" }, { es: "Si no salió el saludo con su nombre, **no marcó**. Vuelva a intentar.", en: "If the greeting with your name did not appear, you **did not punch**. Try again." }],
          [{ es: "Quiero marcar entrada y no aparece el botón", en: "The check-in button is not there" }, { es: "Es porque ya está adentro. El reloj solo enseña lo que le toca.", en: "Because you are already in. The clock only offers what applies." }],
          [{ es: "Se me olvidó marcar salida", en: "I forgot to clock out" }, { es: "El sistema le cerró el día a la hora de cierre. Dígale al dueño la hora real.", en: "The system closed your day at the closing hour. Tell the owner the real time." }],
          [{ es: "La cámara no prende", en: "The camera does not start" }, { es: "La marca se guarda de todos modos. Avísele al dueño.", en: "The punch is saved anyway. Let the owner know." }],
          [{ es: "Un empleado ya no trabaja aquí", en: "Somebody left the shop" }, { es: "Désele de baja en [[Employees]]. **Nunca lo borre.**", en: "Deactivate them in [[Employees]]. **Never delete them.**" }],
          [{ es: "Las horas no cuadran con la nómina", en: "Hours do not match payroll" }, { es: "Revise el día en que empieza la semana en [[Settings]].", en: "Check the week start day in [[Settings]]." }],
        ],
      },
    ],
  },
];
