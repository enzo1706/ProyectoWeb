# Pruebas: Prompt 4 (Stock) + Prompt 5 (Catálogo) + Prompt 6 (Ventas) + Prompt 7 (Borradores) + Prompt 9 (Clientas)

Esta rama (`prompt-9-clientas`) incluye los Prompts 4, 5, 6, 7 y 9 completos, uno arriba del
otro — se prueban juntos porque cada uno depende del anterior (el Prompt 9 agrega pagos
parciales sobre las cuotas y ventas que armó el Prompt 6, y notas/filtros sobre la ficha de
clienta).

## Cómo levantarlo

1. `git fetch origin`
2. `git checkout prompt-9-clientas`
3. Variables de entorno: copiá el `.env` que ya tengas, con `DATABASE_URL` apuntando a tu
   Postgres local (no hace falta `TEST_DATABASE_URL` para levantar la app con `npm run dev`).
4. Si no tenés la base local levantada: `npm run db:dev:up` y después `npm run db:push`
   (el Prompt 7 agregó la tabla `drafts` y el Prompt 9 agregó `client_notes`,
   `client_payments`, `payment_allocations` y la columna `amount_paid` — `db:push` las aplica
   solas).
5. `npm run dev` y abrí `http://localhost:5000` (o el puerto que indique la consola).
6. Entrá con una cuenta de consultora de prueba (o creá una) y una clienta de prueba. Si el
   catálogo está vacío, en Stock aparece el botón "Cargar catálogo de prueba" — tiene
   productos con tonos, útil para probar el agrupamiento.

## Stock (Prompt 4)

- Header: "N productos · M unidades" (ya no dice "en catálogo") y la card "Valor de tu stock"
  con 3 números (venta, costo, ganancia posible) — "≈" si hay algún producto sin costo real.
- Tildar/destildar "Ver precio de venta al público": cambia precio ↔ costo en cada fila. Al
  salir de Stock y volver a entrar, el tilde vuelve a estar marcado (es el comportamiento
  esperado, no un bug).
- Botón "Agregar" (dropdown): "Cargar desde el catálogo" y "Cargar producto manualmente", cada
  uno con su descripción abajo.
- Nombres completos sin "…", "1 unidad" / "3 unidades", puntos como "12 pts" (nada si es 0).
- Ícono naranja de poco stock al lado de las unidades: al tocarlo muestra "Stock bajo" — es
  solo informativo, a propósito no tiene botón para posponer el aviso (se sacó la franja
  masiva que hacía eso; por ahora esa función queda sin UI, es una decisión tomada, no un bug).
- Agrupamiento por tono: un producto con varios tonos se ve como una fila expandible con el
  total de unidades; uno de un solo tono se ve como fila normal.
- Editar un producto de **catálogo** (lápiz): se puede cambiar el precio propio (queda
  guardado como precio de esa consultora, sin tocar el catálogo general), el costo, las
  unidades y el umbral de aviso. "Usar el precio del catálogo" tiene que volver al precio
  base. Nombre, categoría, tono, puntos y código se ven pero no se editan.
- Editar un producto **manual** (lápiz): se puede cambiar todo, incluido "Eliminar producto".
  - Con un producto manual SIN ventas: se borra.
  - Con un producto manual CON al menos una venta: tiene que aparecer "Este producto tiene
    ventas registradas, no se puede eliminar." y no borrarlo.
- Cargar un producto manual nuevo con los 3 modos de costo: por % (35/40/45, muestra "Te
  costó $X"), directo en pesos, y sin cargar ninguno (tiene que salir el aviso con el
  descuento habitual antes de guardar igual). Selector de categoría con "+ Nueva categoría" y
  desplegable "Más datos (opcional)" con línea/tono/puntos/código.

## Cargar desde el catálogo (Prompt 5)

- Se abre a pantalla completa, en el celular y en la compu.
- Paso 2 ("Elegí los productos del pedido"): los productos con tonos aparecen como una sola
  fila desplegable ("N tonos"), no repetidos uno por tono. Un producto de un solo tono se ve
  como fila normal.
- Elegir cantidades con +/− directamente en la fila (ya no hay botón "Agregar" por producto).
  Las filas con cantidad > 0 quedan con fondo rosado y el número en negrita. El "−" se ve
  apagado en 0.
- Con el descuento ya elegido: precio al público tachado y debajo el precio con descuento. Sin
  descuento elegido ("Elegir después"): solo el precio al público, con el aviso y el link
  "Elegir ahora" arriba de la lista.
- Buscar el nombre de un producto O el nombre de un tono (ej. un color específico) tiene que
  encontrar la familia y mostrarla ya desplegada.
- Si una familia tiene algún tono con cantidad elegida, se ve destacada y con "N unidades
  elegidas" aunque esté plegada.
- Abajo de todo, el contador fijo ("N productos · M unidades · $ total", o "Todavía no
  elegiste productos" si no hay nada). Al tocarlo se abre "Tu pedido hasta ahora" (de solo
  lectura, con "Seguir eligiendo" para cerrarla).
- "Importar desde Excel, CSV o PDF" sigue funcionando y suma sobre lo que ya habías elegido a
  mano (no lo reemplaza).
- Paso 3 ("Revisá tu pedido"): cada renglón tiene lápiz (cambiar cantidad, mínimo 1, con
  Guardar/Cancelar) y tacho (quitar, con confirmación "¿Querés quitar [producto] de tu
  pedido?"). Si se quitan todos los productos: "Tu pedido está vacío" con un botón que vuelve
  al paso 2.
- Si se eligió "Elegir después" en el paso 1, en "Revisá tu pedido" hay que elegir el
  descuento ahí para poder confirmar.
- Al confirmar: el stock sube y el costo promedio se recalcula (esto no cambió, es el mismo
  endpoint de siempre).

## Nueva venta y detalle de venta (Prompt 6)

### El error que esto arregla
Antes, una venta en efectivo en un solo pago quedaba "Pendiente" con una cuota que vencía el
mismo día — al día siguiente aparecía como "Cuota vencida" aunque la clienta ya había pagado
en el momento. Probar específicamente que esto ya NO pasa (ver primer punto de "Pago" abajo).

### Paso "¿A quién le vendés?" (solo al crear)
- Buscar y elegir una clienta, o crear una nueva clienta inline — funciona como antes.
- Botón nuevo "Completar después": avanza sin elegir clienta. Si más adelante la venta
  termina con algo pendiente de cobro, el paso de confirmar lo va a frenar (ver abajo).

### Paso "Productos"
- Arriba, un buscador por nombre o tono.
- Sin buscar nada, se ve en este orden: "Tus productos en stock" (los que tienen unidades),
  "Más vendidos" (los 6 más vendidos de los últimos 3 meses) y "Todas las categorías" (el
  grid de siempre). Si alguna sección queda vacía, simplemente no aparece.
- El botón final dice "Agregar a la venta" (antes decía "al carrito").

### Paso "Pago" (reemplaza a "Ajustes del total" + "¿Cómo paga?" de antes — ahora son 4 pasos en total, no 5)
- Método de pago: Efectivo / Transferencia / Tarjeta, como antes.
- Botón "Agregar descuento, recargo o envío" (plegable, con un "+"): al abrirlo aparecen
  Descuento %, Recargo %, "Envío que le cobrás ($)" y "Envío que pagás vos ($)". Si ya hay
  algo cargado, el botón muestra un resumen corto en vez de "+" ("Descuento 10% · Envío
  $1.500 — Editar").
- "¿En cuántos pagos?" con los montos editables cuando son 2 o más (igual que antes, pero ya
  **no hay** selector de frecuencia semanal/mensual — se sacó porque no cambiaba nada real).
- Con **efectivo o transferencia**: casilla "La clienta paga en el momento".
  - Con 1 pago: viene tildada por defecto. Tildada, la venta queda cobrada ahí mismo — **ya no
    aparece como vencida al día siguiente**.
  - Con 2 pagos o más: viene destildada por defecto. Si la tildás, la primera cuota queda
    cobrada y las demás vencen cada 30 días desde la fecha de la venta.
  - Destildada (con 1 pago o más): aparece "¿Cuándo te paga?" / "¿Cuándo vence la primera
    cuota?" con las opciones "En 7 días" (por defecto), "En 15 días", "En 30 días" o "Elegir
    fecha".
- Con **tarjeta**: no aparece la casilla — se ve el texto "Con tarjeta, la venta queda
  cobrada". Elegir varias "cuotas" ahí es solo un dato (quedan con el banco), nunca generan
  cuotas pendientes en la app.

### Paso "Revisá y confirmá"
- Si la venta quedaría pendiente de cobro y no hay clienta elegida (por haber tocado
  "Completar después"), aparece el aviso "Para dejar una venta pendiente de cobro tenés que
  elegir la clienta" con el buscador y "Nueva clienta" ahí mismo, y no deja confirmar hasta
  resolverlo.
- La línea "Pago" muestra "Pagó en el momento" o "Te debe $X — vence el [fecha]", según
  corresponda.

### Detalle de una venta
- Dos etiquetas separadas arriba: pago ("Cobrada" / "Te debe $X") y entrega ("Entregada" /
  "Pendiente de entrega").
- Un botón para cambiar la entrega a mano entre "Entregada" y "Pendiente de entrega".
- Si hay cuotas pendientes, aparecen destacadas arriba de todo con un botón "Marcar como
  pagada" por cada una.
- **"Editar" tiene que verse siempre** (antes se ocultaba si la venta tenía alguna cuota
  pagada — con "paga en el momento" tildado, eso pasa a ser el caso más común, así que ya no
  se oculta). Al editar una venta que ya tiene una cuota cobrada:
  - esa cuota no cambia (mismo monto, sigue "Pagada", misma fecha);
  - se puede seguir cambiando productos/precio/ajustes con normalidad;
  - si el nuevo total queda por debajo de lo ya cobrado, el guardado se rechaza con un error
    claro en vez de romper algo.
- "Cancelar Venta" se ve con menos peso visual que antes (borde y texto rojo, no un bloque
  rojo lleno) y sigue pidiendo confirmación antes de cancelar.

### Lista de Ventas
- Filtro nuevo: "Todas", "Te deben", "Pendientes de entrega", "Cobradas", "Canceladas" (antes
  tenía "Pendientes"/"Entregados"/"Pagados", que ya no significaban nada real).
- El contador de arriba usa singular/plural correcto ("1 venta registrada" / "2 ventas
  registradas").
- Una venta creada con "Completar después" muestra el botón "Asignar clienta" en su tarjeta.
  Al tocarlo se abre un buscador (igual que en el wizard) + "Nueva clienta"; al elegir una, la
  tarjeta pasa a mostrar su nombre y el botón desaparece.

## Borradores de ventas y pedidos (Prompt 7)

### El problema que esto arregla
Antes, tocar la X en "Nueva venta" o "Cargar pedido" con algo ya cargado lo perdía todo sin
avisar.

### Guardado automático
- Empezá una venta nueva (elegí una clienta, o agregá un producto) y dejala sin confirmar.
  Esperá unos segundos (el guardado es automático, no hace falta ningún botón) y cambiá de
  pestaña o cerrá el navegador. Al volver a entrar a Ventas, tiene que aparecer arriba de todo
  en "Ventas sin terminar (1)", con la clienta (o "Sin clienta"), la cantidad de productos y
  "hoy" como fecha.
- Mismo caso con "Cargar pedido" desde Stock — tiene que aparecer en "Pedidos sin terminar".
- Abrir el wizard y cerrarlo SIN cargar nada (ni clienta, ni producto) no debe crear ningún
  borrador — ni en la lista ni en la base.
- Mientras el borrador está sin confirmar, el stock NO se modificó (para un pedido) y la venta
  no aparece en Reportes ni afecta el saldo de ninguna clienta (para una venta).

### Al cerrar con algo cargado
- Tocar la X (o la tecla Escape, o hacer click afuera del diálogo) con algo ya cargado tiene
  que mostrar la pregunta "¿Querés guardar lo que cargaste?" con tres botones: "Guardar
  borrador", "Descartar" y "Seguir cargando".
  - "Seguir cargando": vuelve al wizard, sin perder nada.
  - "Guardar borrador": cierra y el borrador queda en la lista de "sin terminar".
  - "Descartar": cierra y NO queda ningún borrador.
- Sin nada cargado, la X cierra directo, sin preguntar nada.

### Retomar
- Desde "Ventas sin terminar" (o "Pedidos sin terminar"), tocar "Retomar" abre el wizard
  exactamente en el paso donde quedó, con todo lo que ya se había cargado.
- Retomar una venta en borrador que tenía un producto que mientras tanto se borró del catálogo:
  tiene que sacarlo solo y avisar "Quitamos [producto] porque ya no está disponible." — nunca
  romper el wizard.
- En una venta, los precios que ya se habían puesto (ajustes manuales incluidos) se mantienen
  al retomar. En un pedido, los precios se recalculan con el catálogo actual (pueden haber
  cambiado desde que se guardó el borrador).
- Si la clienta de una venta en borrador se eliminó mientras tanto, al retomar la venta queda
  "Sin clienta" en vez de romper o mostrar datos viejos.
- Confirmar una venta (o un pedido) retomado tiene que hacer que su borrador desaparezca de la
  lista — nunca puede quedar un borrador de algo que ya se confirmó.
- El tacho de cada fila de la lista descarta ese borrador, con la confirmación "¿Querés
  descartar esta venta/pedido sin terminar?".

### Varios borradores a la vez
- Dejá dos ventas (o dos pedidos) sin terminar a la vez — tienen que convivir en la lista, cada
  una con su propio "Retomar" y su propio tacho, sin mezclarse entre sí.

### Aislamiento entre consultoras
Este punto se probó a nivel de servidor (tests automáticos contra Postgres real, incluidos en
el repo) — no hace falta reproducirlo a mano, pero si se quiere confirmar: con dos cuentas de
consultora distintas, ningún borrador de una tiene que aparecer, poder retomarse ni poder
borrarse desde la otra.

## Clientas: alta, filtros y ficha (Prompt 9)

### Alta y edición de clienta
- El nombre es obligatorio (no se puede guardar sin nombre). El teléfono ahora es **opcional**
  — se puede guardar una clienta sin teléfono.
- Si cargás un teléfono, admite cualquier formato razonable (con espacios, guiones, "+54",
  con o sin el "9" de celular) y se guarda normalizado. Un teléfono incompleto o con todos los
  dígitos iguales se rechaza con un error claro.
- Cumpleaños: se eligen por separado "Día" y "Mes" (ya no hay campo de año en ningún lado del
  formulario).
- En Chrome para Android aparece un botón para importar nombre y teléfono desde los contactos
  del celular (Contact Picker). En cualquier otro navegador/dispositivo, ese botón simplemente
  no aparece — no es un bug.

### Cumpleaños: nunca se muestra el año ni se calcula la edad
Revisar las 5 pantallas que muestran un cumpleaños y confirmar que **ninguna** diga el año ni
la edad, solo día y mes:
- Ficha de la clienta.
- Lista de clientas.
- Inicio ("Cumple hoy" / próximos cumpleaños).
- Agenda.
- Reportes (tanto en pantalla como en el Excel/CSV que se exporta).

### Filtro único de la lista de clientas
- El botón "Filtros" abre una sola pantalla con 3 opciones grandes para tocar: "Debe dinero",
  "Hace tiempo que no compra" (60 días sin compras) y "Cumple años este mes" — más "Ver
  todas". Ya no están los dos desplegables viejos, y el filtro de "más de 3 meses" se sacó.
- Con un filtro activo aparece un chip arriba de la lista con el nombre del filtro y una X
  para sacarlo.
- "Cumple años este mes" ordena por día del mes (el que cumple más pronto, primero).

### Ficha de la clienta
- Si debe dinero, aparece una card "Te debe $X" con el botón "Registrar pago" y el botón de
  WhatsApp. Si no debe nada, esa card no aparece.
- "Registrar pago": el monto viene precargado con lo que debe, se puede bajar pero no se puede
  poner en 0 ni superar lo que debe. Al confirmar, se reparte solo entre sus cuotas más viejas
  primero (si debe de varias ventas a la vez).
- El botón "Eliminar" quedó chico y abajo del todo (ya no es un botón grande). Al tocarlo pide
  confirmación con el texto exacto "¿Seguro que querés eliminar a [nombre]? Esta acción no se
  puede deshacer." — **ya no hay botón de "Deshacer"** después de borrar.
- Eliminar una clienta que tiene ventas o citas registradas tiene que bloquearse con el mensaje
  "No podés eliminar a [nombre] porque tiene ventas o citas registradas." — sin ningún texto
  técnico ni código de error.
- Pestaña "Notas": se pueden agregar varias notas (no una sola), cada una con su fecha y un
  tacho para borrarla con confirmación. Una nota migrada de antes de este cambio (si la
  clienta ya tenía algo escrito en el campo de notas viejo) aparece como "Nota anterior", sin
  ninguna fecha inventada.
- Pestaña "Historial": muestra las ventas Y los pagos recibidos mezclados por fecha — un pago
  parcial se ve como "Pago recibido" con su monto, fecha y forma de pago.

### Pagos parciales (en cualquier venta con cuotas)
- Dentro del detalle de una venta con una cuota pendiente: "Marcar como pagada" sigue
  funcionando igual que antes (un clic, queda pagada entera) — por abajo ahora también genera
  un registro de pago real, pero el botón no cambió.
- Si una cuota tiene un pago parcial (por ejemplo, pagaron $4.000 de una cuota de $10.000), el
  detalle de la venta tiene que mostrar "$6.000 de $10.000 (pago parcial)" en vez de solo el
  monto total — en todos lados donde se ve esa cuota (detalle de venta, lista de cuotas
  pendientes de Reportes/Inicio).
- Editar una venta que tiene una cuota con pago parcial (sin estar pagada del todo): esa cuota
  no se puede borrar ni perder — el guardado tiene que preservarla igual que a una cuota ya
  pagada entera.
- Reportes → "Total cobrado": tiene que sumar exactamente lo cobrado en el mes, sin importar
  si viene de tarjeta (automático), "Marcar como pagada" o un pago parcial — nunca contar dos
  veces el mismo cobro. Cancelar una venta que ya tenía algo cobrado tiene que sacar ese monto
  del total.

### Aislamiento entre consultoras
Este punto (igual que los borradores del Prompt 7) se probó a nivel de servidor con tests
automáticos contra Postgres real — no hace falta reproducirlo a mano: ninguna consultora puede
ver, pagar, anotar ni marcar como pagada una cuota de una clienta que no es suya.

## En los cinco: a 375 px de ancho (celular)

Probar todo lo de arriba también con el DevTools en modo responsive a 375 px (iPhone SE o
similar):
- Ningún nombre de producto se corta con "…".
- El header, la card de valor, los filtros y el dropdown "Agregar" entran sin desbordar.
- El diálogo de "Cargar desde el catálogo" ocupa toda la pantalla y el contador fijo de abajo
  queda visible sin tapar contenido ni quedar tapado por la barra del navegador/teclado.
- Los diálogos chicos (Cambiar cantidad, confirmaciones, Editar producto) se ven completos y
  usables con el teclado del celular abierto.
- El wizard de "Nueva venta" (los 4 pasos) y el detalle de venta (con las dos etiquetas y los
  botones nuevos de entrega/cuotas) se ven completos, sin texto cortado ni botones superpuestos.
- Las secciones "Ventas sin terminar" / "Pedidos sin terminar" y la pregunta de 3 botones al
  cerrar se ven completas, sin que los botones se corten ni se superpongan.
- La pantalla de "Filtros" de Clientas (las 3 opciones grandes) y la ficha de la clienta
  (cards, pestañas, diálogo de "Registrar pago") se ven completas, sin botones superpuestos ni
  texto cortado.

## Qué avisar si algo falla

Para cada cosa que no coincida con lo de arriba: pantalla, pasos para reproducirlo, y si hay
algo en la consola del navegador (F12 → Console) en rojo.
