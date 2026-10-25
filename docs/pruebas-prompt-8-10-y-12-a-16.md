# Pruebas: Prompts 8 (Partes 1 a 3), 10 y 12 a 16

Rama `prompt-16-velocidad` (acumula, en orden, los Prompts 8, 9, 10, 11, 12, 13, 14, 15 y 16
sobre `staging`). El Prompt 11 ya tiene su propio checklist (`docs/pruebas-prompt-11.md`) —
este documento cubre el resto del tramo, pensado para correrse junto con ese, contra staging
(nunca `localhost`), como parte de la Ronda 2 del plan de deploy
(`docs/LEEME-proximos-pasos.md`).

La Parte 4 del Prompt 8 (notificaciones push) NO está acá — todavía no está implementada, queda
para cuando staging esté levantado (ver el paso 6 del LEEME).

## Cómo levantarlo

1. `git fetch origin && git checkout prompt-16-velocidad` (o, si ya se mergeó, `staging`).
2. `npm run dev`, o contra el dominio de staging si ya está arriba.
3. Entrar con una consultora con clientas, ventas, cuotas y citas cargadas — o la cuenta de
   demo de esta revisión.

## Prompt 8 (Partes 1 a 3) — Venta sin stock y día de pedido

- **Vender sin stock**: en "Nueva venta", elegir un producto con 0 unidades — aparece "No
  contás con stock de este producto. ¿Querés continuar con la venta?" ("Sí, continuar" /
  "Cancelar"). Elegir más unidades de las que hay (ej. tiene 2, vender 5) — aparece "Tenés 2
  unidades de este producto. Las 3 que faltan quedan pendientes para tu próximo pedido..." —
  confirmar la venta: el stock queda en 0 (nunca negativo), y la venta queda "Pendiente de
  entrega" con "Se pide el [próximo día de pedido]" (o, sin día configurado, el link a
  Configuración). El pago sigue siendo independiente de la entrega (puede quedar cobrada y
  pendiente de entregar, o al revés).
- **Cuando llega el pedido**: confirmar un pedido desde el catálogo que trae ese producto — las
  unidades nuevas se asignan solas a la venta pendiente más vieja primero (no se suman al stock
  disponible, ya están vendidas). En Inicio aparece "Ya podés entregarle a [clienta]: [producto]
  x[cantidad]" con el botón "Marcar como entregado" — al tocarlo, ese renglón queda entregado y,
  cuando todos los de la venta lo están, la venta pasa a "Entregada" y el aviso desaparece.
- **Recordatorio del día de pedido**: con un día de pedido configurado para hoy (Configuración),
  entrar a Inicio y ver la tarjeta "Hoy es tu día de pedido" con la lista de productos (los
  vendidos en el período con poco stock, más las unidades pendientes de ventas sin stock de
  cualquier período) y los botones "Armar pedido con estos productos" y "Listo, ya lo pedí".
  "Armar pedido con estos productos" abre "Cargar desde el catálogo" con esos productos y
  cantidades ya cargados (pasando igual por el paso de descuento). "Listo, ya lo pedí" cierra la
  tarjeta. Si la lista de productos queda vacía, la tarjeta no aparece.
- Cancelar o editar una venta con unidades pendientes nunca queda bloqueado por el límite de 10
  productos del plan gratis (Prompt 14) — es una corrección de stock, no una carga nueva.

## Prompt 10 — Inicio: objetivo del mes y avisos

- **Objetivo del mes**: con un objetivo cargado en Configuración y ventas parciales, Inicio
  muestra "Vas $ X de $ Y", la barra de progreso con el porcentaje y "Te faltan $ Z · quedan N
  días". Al llegar o superar el objetivo: "¡Llegaste a tu objetivo del mes! 🎉". Sin objetivo
  cargado: "Este mes vendiste $ X" y el botón "Definir mi objetivo" (lleva a Configuración).
- **Tres bloques de avisos**, cada uno oculto si no tiene nada, hasta 3 ítems con "Ver más" para
  el resto, textos completos sin cortar con "…" (probar en un celular de 375 px):
  - **"Para hacer hoy"**: "Ya podés entregarle a…" (Prompt 8), "Hoy es tu día de pedido" (Prompt
    8), citas de hoy ("Hoy a las [hora]: [tipo] con [clienta]" → "Ver"), cumpleaños de hoy
    ("Hoy cumple [clienta] 🎂" → "WhatsApp", solo con celular cargado).
  - **"Pendientes"**: cuotas vencidas o que vencen hoy ("[Clienta] te debe $ X (venció el
    [fecha])" / "(vence hoy)") con botones "Cobrada" (pide confirmación "¿[Clienta] te pagó los
    $ [saldo]?") y "WhatsApp"; "Tenés N ventas/pedidos sin terminar" → "Retomar"; "Tenés N
    ventas sin clienta" → "Asignar clienta" (lleva a Ventas ya filtrado).
  - **"Para mejorar tu negocio"**: límite del plan gratis (solo cuentas gratis con 10+ productos
    con stock), poco stock, clientas inactivas (hace más de 2 meses que no compran), productos
    sin costo, clientas sin celular, "Completá tu perfil" (Prompt 14) — en ese orden. Cada ítem
    tiene "Ocultar"; probar que vuelve a aparecer a los 7 días si la condición sigue vigente (o
    confiar en el test automatizado si no se puede esperar una semana de verdad).
- Si los tres bloques y el recordatorio del día de pedido están vacíos: "Estás al día. No tenés
  nada pendiente." (nunca el texto viejo "No hay nada pendiente por ahora").
- Los números de cada aviso coinciden con los que muestran Clientas/Stock/Reportes para lo
  mismo (ej. "clientas inactivas" cuenta igual que el filtro de Clientas) — no debería verse un
  número distinto entre Inicio y la pantalla de destino al tocar el aviso.

## Prompt 12 — Agenda: tipos, eventos automáticos y WhatsApp

- El filtro de Agenda y el formulario "Nueva Cita" muestran la misma lista de tipos: Sesión de
  belleza, Entrega de productos, Visita, Demostración, Capacitación, Seguimiento y "Crear
  evento" — sin "Venta" en el filtro. "Crear evento" pide un nombre propio (ej. "Reunión de
  unidad"), obligatorio.
- La clienta es opcional en cualquier tipo de cita — una cita sin clienta se ve en el calendario
  y en la tarjeta sin ningún hueco vacío (ej. "Hoy a las 15:00: Reunión de unidad", sin "con
  ...").
- Una cuota que vence hoy aparece sola en el calendario como "Cobrar a [clienta] $ X", en su
  fecha ORIGINAL de vencimiento (nunca se mueve a "hoy" aunque esté vencida — solo cambia de
  color/marca). Botones "WhatsApp" y "Cobrada" — "Cobrada" pide la misma confirmación que ya usa
  Inicio ("¿[Clienta] te pagó los $ [saldo]?") y el monto es el saldo, no el total de la cuota.
- El cumpleaños de cada clienta aparece solo en su día, todos los años — probar con una clienta
  con cumpleaños el 29 de febrero: en un año no bisiesto tiene que aparecer el 28.
- Los días de pedido configurados en Configuración aparecen marcados en el calendario; solo el
  PRÓXIMO (o el actual si el recordatorio sigue abierto) muestra, al tocarlo, la lista de
  productos para pedir — los demás (pasados o de meses futuros) no abren nada especial.
- Los puntitos del calendario son como máximo 4 por día (uno por grupo: Citas, Cobros,
  Cumpleaños, Días de pedido — nunca uno por cada uno de los 9 tipos), con una referencia de
  colores + ícono debajo del calendario (billetera/torta/caja/calendario).
- El contador de arriba ("N citas este mes") cuenta solo citas cargadas a mano — no sube al
  haber cobros, cumpleaños o días de pedido ese mes.
- El botón de WhatsApp aparece en toda cita con clienta-con-celular y en Cobro/Cumpleaños, nunca
  en Día de pedido; abre el chat sin mensaje precargado.

## Prompt 13 — Menú, navegación y sesión

- **En un celular de 375 px**: barra inferior fija con 5 botones — Inicio, Clientas, "Vender"
  (centro, redondo, resaltado), Stock y "Más", en ese orden. El botón de la sección actual se ve
  resaltado. "Más" abre el menú lateral con Ventas, Agenda, Reportes, Configuración,
  Suscripción y, al final y separado, "Cerrar sesión". Ya no está el ícono de cerrar sesión
  arriba (solo quedan logo, ojo y luna).
- Al enfocar un campo de texto (teclado virtual abierto), la barra inferior se oculta por
  completo — confirmar que no queda flotando sobre el teclado.
- Cerrar sesión pide confirmación ("¿Querés cerrar sesión?" / "Sí, cerrar sesión" / "Cancelar")
  en cualquier tamaño de pantalla.
- El ícono de Stock es un labial (de línea, sin relleno), no un cubo — en el menú lateral, la
  barra inferior y cualquier otro lugar donde aparezca Stock. El menú dice "Clientas", nunca
  "Clientes".
- **Sesión de 10 días**: cerrar el navegador, esperar un par de días (o adelantar el reloj del
  sistema/revisar el test automatizado si no se puede esperar de verdad) y confirmar que la
  sesión sigue iniciada — cada visita renueva el plazo. Si la sesión se cerró por pasar más de
  10 días sin entrar, Ingreso muestra: "Por seguridad cerramos tu sesión porque pasaron más de
  10 días sin entrar."
- "Nueva venta" es una sola instancia compartida: abrirla desde Inicio, navegar a otra sección
  sin cerrarla, y confirmar que sigue abierta con lo que ya se había cargado (no se pierde el
  progreso al cambiar de pantalla).

## Prompt 14 — Ingreso, registro y prueba gratis

- Ingreso: campo "Email o WhatsApp" (placeholder "tu@email.com o 261 555 1234"), botón de ojo en
  "Contraseña", botón principal "Iniciar sesión" y, debajo, "Crear cuenta" (ancho completo, con
  borde) en vez del link chico. Probar que entra con email, con WhatsApp y con un usuario viejo
  (cuenta creada antes de este prompt).
- Crear cuenta: Nombre y apellido, Email, WhatsApp, Contraseña y "Repetí la contraseña" (las dos
  con ojo) — sin campo "Usuario". Si las contraseñas no coinciden: "Las contraseñas no
  coinciden", sin enviar el formulario. Email y WhatsApp no se pueden repetir entre cuentas
  (409). Si lo escrito en WhatsApp tiene forma de teléfono pero está mal formado: "Escribí tu
  WhatsApp sin el 0 y sin el 15. Por ejemplo: 261 555 1234." — antes de mandar nada al servidor.
- Ya no aparece ninguna fecha de vencimiento de prueba en ningún lado (Suscripción, Configuración,
  avisos de Inicio).
- Con una cuenta gratis: Stock muestra "Prueba gratis: N de 10 productos." Al llegar a 10 y
  intentar sumar un producto 11 (desde "Cargar desde el catálogo" o carga manual, con unidades),
  aparece el cartel "Llegaste al límite de la prueba gratis (10 productos)..." con "Ver planes"
  y "Ahora no" — y el producto NO se suma. Sumar unidades a un producto que YA tiene stock sigue
  sin límite. Cancelar o editar una venta que devuelve stock nunca queda bloqueado por este
  límite, aunque ya esté en 10.
- "Para mejorar tu negocio" (Inicio) tiene el aviso "Completá tu perfil" si falta ciudad, edad o
  cargo — abre un formulario con esos tres campos. Configuración tiene un bloque "Tus datos"
  donde se ven y editan nombre, email, WhatsApp, ciudad, edad y cargo; cambiar email o WhatsApp
  pide la contraseña actual.
- Suscripción: para cuentas gratis, "Estás usando la prueba gratis: podés cargar hasta 10
  productos. Tenés N."; la lista de beneficios es la nueva (productos ilimitados, ganancia por
  venta, cobros, recordatorio de pedido, historial, Agenda, WhatsApp) y termina en "Sin
  permanencia: cancelás cuando quieras."

## Prompt 15 — Textos y formatos

- Montos: nunca con un solo decimal (siempre 0 o 2) — revisar un precio con centavos y uno
  redondo en la misma pantalla (ej. Reportes, detalle de venta). Separador de miles con punto,
  decimales con coma (formato argentino).
- Fechas: "hoy"/"ayer"/"hace N días" para el pasado reciente, "mañana"/"en N días" para el
  futuro cercano, fecha completa en palabras más allá de una semana — nunca en inglés ni con el
  locale `es-MX` (meses/días en español rioplatense).
- Revisar que el catálogo de Stock ya no muestra un "Código" donde antes podía salir un slug
  generado automáticamente en vez de un código real (ver `docs/textos-prompt-15.md` para el
  detalle completo de qué se sacó y por qué).
- Barrido general de "vos"/voseo en los textos de la app y los emails — ningún "tú"/"tienes"
  suelto.

## Prompt 16 — Velocidad de carga

- **Primera carga de cada sección** (Inicio, Stock, Clientas, Ventas, Agenda, Reportes): se ve
  una grilla de tarjetas grises con la forma del contenido real (nunca un círculo girando) —
  probar con la red limitada desde las DevTools (Network → Slow 3G) para que el estado de carga
  se note.
- **Volver a una sección ya visitada** (navegar a otra pantalla y volver) muestra el contenido
  anterior al instante, sin pantalla de carga — y si pasó más de un minuto, se actualiza solo
  por detrás sin parpadeo visible.
- **Invalidaciones**: registrar una venta nueva, registrar un pago, cancelar una venta y cargar
  un pedido — después de cada una, Inicio (totales y saldo pendiente) y Agenda (cobros del mes)
  tienen que reflejar el cambio sin recargar la página a mano.
- **Stock**: la vista normal (con stock) carga liviano — las imágenes de la lista son
  miniaturas, no las originales (confirmar con DevTools → Network → Img que el archivo que pide
  la lista es más chico que el de la ficha/detalle de un producto). "Ver productos sin stock" y
  "Cargar desde el catálogo" siguen mostrando el catálogo completo.
- **Pestaña Network → Timing** de cualquier `/api/*`: aparece el valor `Server-Timing` con la
  duración real del lado del servidor.
- El tamaño de las respuestas y de los archivos estáticos (JS/CSS) viene comprimido — confirmar
  en DevTools → Network que la columna "Size" (comprimido) es bastante menor que "Content"
  (sin comprimir) en la carga inicial de la página.

## Qué no cambia (verificado, no se tocó)

- El wizard de "Nueva venta", el carrito y el flujo de pago/cuotas siguen igual en todos los
  Prompts de este tramo — ningún endpoint que usan se borró ni se les cambió el contrato.
- Los datos de ventas, clientas y stock de antes de este tramo se siguen viendo igual (ningún
  Prompt de acá migra ni reescribe datos existentes, salvo los backfills ya documentados en
  `docs/migracion-deploy-3.md`).

## Si corrés `npm test` y falla algo de timing

`server/tests/auth-anti-enumeration.test.ts` mide milisegundos reales, y su `beforeAll` corre
`createApp()` por primera vez en el proceso — con la máquina cargada puede fallar por un
timeout de arranque o por unos milisegundos de margen en el timing, sin ser una regresión real
(confirmado corriendo la suite completa en un contenedor Linux limpio — ver
`docs/LEEME-proximos-pasos.md`). Si falla justo ahí: volvé a correr ese archivo solo antes de
preocuparte.

## En un celular de 375 px

- La barra inferior (Prompt 13), las tarjetas de carga (Prompt 16) y los formularios de Ingreso/
  Crear cuenta (Prompt 14) se ven completos, sin texto cortado ni botones superpuestos.
- El calendario de Agenda (Prompt 12) se desplaza sin romper el layout.
- Los avisos de Inicio (Prompt 10) y la tarjeta del día de pedido (Prompt 8) se leen completos.

## Qué avisar si algo falla

Pantalla, pasos para reproducirlo, y si hay algo en la consola del navegador (F12 → Console) en
rojo — mismo criterio que el resto de los checklists de este proyecto.
