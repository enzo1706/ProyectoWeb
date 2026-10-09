# Impulsa · Prompts para Claude Code

Mejoras de experiencia de uso · 4 de octubre de 2026 · versión 2

## Cómo usar este documento

1. Abrí Claude Code en la carpeta del proyecto.
2. Pegá primero el **Prompt 0**. Tip: si lo guardás como un archivo **CLAUDE.md** en la raíz del proyecto, Claude Code lo lee solo en cada sesión y no hace falta volver a pegarlo.
3. Enviá un prompt por vez, en el orden del documento. Cuando termine, probá el cambio en el celular y recién ahí pasá al siguiente.
4. Copiá solo el texto del recuadro gris.
5. Cuando Claude Code te muestre un plan de cambios en la base de datos, leelo antes de aprobarlo.

## Decisiones que tomé: revisalas antes de enviar

1. **Descuento habitual:** lo calcula la app sola con los pedidos de los últimos 3 meses (promedio ponderado por monto). Si no hay pedidos en ese período usa el del último pedido, y si nunca cargó uno, 35%. Se ve en Configuración y no se edita.
2. **Costo de un producto comprado con descuentos distintos:** promedio ponderado por unidades. Ejemplo: 2 unidades a $ 14.960 y 3 a $ 16.320 dan un costo de $ 15.776.
3. **Nombres del envío:** "Envío cobrado" pasa a "Envío que le cobrás" y "Costo real del envío" pasa a "Envío que pagás vos".
4. **Tarjeta en cuotas:** las cuotas son con el banco, así que la clienta no le debe a la consultora. Con tarjeta la venta queda cobrada y no se muestra la casilla "La clienta paga en el momento".
5. **Entrega:** las ventas con stock quedan entregadas al confirmarlas; solo lo vendido sin stock queda "Pendiente de entrega". En el detalle de la venta se puede cambiar a mano.
6. **Venta fiada en un pago:** "¿Cuándo te paga?" viene con "En 7 días" elegido. En 2 pagos o más, la casilla "La clienta paga en el momento" viene destildada.
7. **Notificaciones al celular:** llegan a las 9:00. En iPhone solo funcionan si agregan la app a la pantalla de inicio (es un requisito de Apple); en Android funcionan desde Chrome.
8. **Stock:** mantuve la foto chica de cada producto porque ayuda a reconocerlo. Cada tono cuenta como un producto, tanto en el título como en el límite de la prueba gratis.
9. **Inicio:** los avisos se agrupan en "Para hacer hoy", "Pendientes" y "Para mejorar tu negocio" (este último se puede ocultar).
10. **Reportes:** el diseño está en el Prompt 11. La comparación con el período anterior aparece sola debajo de cada número, en lugar del botón "Comparar".
11. **Clientas inactivas:** "Hace tiempo que no compran" y "Clientas para recontactar" usan el mismo criterio: al menos una compra y más de 2 meses sin comprar.
12. **Agenda:** la clienta es opcional en todos los tipos de cita.
13. **Ingreso:** "Iniciar sesión" y "Crear cuenta" quedan como dos botones visibles. Tu frase sobre esos botones quedó cortada; si querías otra cosa, avisame.
14. **Perfil:** ciudad, edad y cargo se piden con un aviso en Inicio y se editan en Configuración → "Tus datos".
15. **Cambio de precio:** al guardar un precio nuevo, el admin elige si se aplica solo a las nuevas suscripciones o también a las actuales (con fecha y aviso en la app).
16. **Cupones:** un uso cuenta recién cuando se aprueba el pago. Si un cupón deja el precio en $ 0, la suscripción se activa sin pasar por Mercado Pago.

## Orden sugerido

| # | Prompt | Sección | Puntos |
|---|---|---|---|
| 0 | Contexto e instrucciones generales | Antes de empezar | — |
| U | Precio de la suscripción y cupones (urgente) | Admin y Suscripción | Nuevo |
| 1 | Configuración: campos nuevos | Configuración | Nuevo, P1, P7, P23, P26 |
| 2 | Costos y ganancia | Stock, Ventas y Reportes | P1, P7, P14 |
| 3 | Diagnóstico: tonos repetidos en el pedido | Stock | P15 |
| 4 | Stock: lista, filtros y edición | Stock | P13, P14, P18, P24 |
| 5 | Cargar desde el catálogo | Stock | P16, P17 |
| 6 | Nueva venta y detalle de venta | Ventas | P2, P5, P6, P7, P10 |
| 7 | Borradores de ventas y pedidos | Ventas y Stock | P4 |
| 8 | Venta sin stock y día de pedido | Ventas, Inicio, Configuración y Agenda | P3 y nuevo |
| 9 | Clientas | Clientas | P10, P19, P20, P21 |
| 10 | Inicio | Inicio | P23 |
| 11 | Reportes | Reportes | P24 |
| 12 | Agenda | Agenda | P25 |
| 13 | Menú, navegación y sesión | Toda la app | P11, P12, P26 |
| 14 | Ingreso, registro y prueba gratis | Ingreso y Suscripción | P29, P30 |
| 15 | Textos y formatos | Toda la app | P26, P27 |
| 16 | Velocidad de carga | Toda la app | P28 |

## Antes de empezar

### Prompt 0 · Contexto e instrucciones generales

_Pegalo al inicio de cada sesión de Claude Code, o guardalo como CLAUDE.md en la raíz del proyecto._

```text
Contexto del proyecto (tenelo en cuenta en todas las tareas que te voy a pasar):

Impulsa (en la app todavía figura como "Mary Kay Manager") es una plataforma web para consultoras de venta directa tipo Mary Kay: stock, ventas, clientas, agenda y reportes. Es multi-consultora: cada consultora ve solo sus datos. Está publicada en impulsaweb.ar. Lo que sé del stack: React + TypeScript con Tailwind y componentes tipo shadcn/ui, y base de datos PostgreSQL con Drizzle (esquema en shared/schema.ts).

Público: mujeres adultas y mayores, con poca afinidad con la tecnología y poco tiempo. Usan la app sobre todo desde el celular. La app tiene que potenciar sus ventas, no ser una tarea más.

Reglas de diseño y textos:
- Mantené el estilo actual: color principal magenta (#D01673), tarjetas blancas con bordes redondeados e íconos de línea (estilo lucide). No inventes un estilo nuevo.
- Pensá primero en el celular: probá cada cambio a 375 px de ancho y también en compu.
- Botones y zonas táctiles de al menos 44 px de alto. Letra de al menos 16 px en el celular. Los nombres importantes no se cortan con "…".
- Textos en español rioplatense con voseo ("vendés", "elegí", "tenés"), simples y sin palabras técnicas.
- Montos siempre en pesos con formato argentino: $ 20.100.

Forma de trabajo:
1. Antes de cambiar código, revisá las partes involucradas y contame en pocas líneas qué encontraste y qué vas a hacer.
2. Si un cambio necesita tocar la base de datos (columnas, tablas o migraciones), mostrame el plan y esperá mi OK antes de aplicarlo. Ninguna migración puede perder datos.
3. Respetá el aislamiento entre consultoras: toda consulta nueva filtra por la consultora que inició sesión.
4. Si existen dos implementaciones del almacenamiento (una en memoria para los tests y otra con PostgreSQL), aplicá los cambios en las dos.
5. Si algo de lo que pido no se puede hacer como está escrito, choca con otra parte de la app o te genera dudas, frená y preguntame antes de seguir.
6. No cambies nada que no esté pedido. No cambies el nombre de la marca: eso se hace en otra tarea.
7. Al terminar cada tarea, corré el build y los tests, revisá que no haya errores en la consola del navegador y pasame un resumen: qué cambiaste, qué archivos tocaste, cómo lo pruebo y si quedó algo pendiente.
8. Hacé un commit por tarea, con un mensaje claro.

Cada tarea indica entre paréntesis los números de punto (P1, P2…) de mi lista de mejoras, para que podamos referirnos a ellos.
```

## Urgente: precio de la suscripción y cupones

### Prompt urgente · Precio de la suscripción y cupones

_Puntos: nuevo · Hacelo antes que el resto, después del Prompt 0._

```text
Tarea urgente: precio de la suscripción editable desde el perfil de administrador y cupones de descuento. Hacela antes que las demás tareas de mejoras.

Cómo está hoy: la pantalla de Suscripción muestra un precio fijo ($ 20.000 ARS / mes) y el botón "Continuar" para pagar con Mercado Pago. No hay forma de cambiar el precio sin tocar el código ni de aplicar descuentos.

Antes de empezar, revisá cómo funciona hoy el cobro (¿suscripción automática de Mercado Pago o un pago por mes?, ¿dónde está el precio?, ¿qué pasa cuando se aprueba un pago?) y contame en pocas líneas. Si hacen falta tablas o columnas nuevas, mostrame el plan de migración y esperá mi OK.

Parte 1 — Precio editable (perfil de administrador)
- En el panel de administrador, una sección nueva "Suscripción y cupones" con dos pestañas: "Precio" y "Cupones". Solo el rol administrador la puede ver y usar; validá el permiso también en el servidor.
- Pestaña "Precio": muestra el precio mensual actual y permite cambiarlo (campo con formato de pesos y botón "Guardar precio").
- Al cambiarlo, el admin elige a quiénes se aplica:
  - "Solo a las nuevas suscripciones" (viene marcada): las que ya pagan mantienen su precio.
  - "También a las suscripciones actuales": se elige desde qué fecha (por defecto, dentro de 30 días). Desde que se guarda, las consultoras suscriptas ven en la app el aviso "Desde el [fecha], tu suscripción pasa a $ X por mes", y el cobro cambia desde esa fecha.
- Guardá un historial de cambios de precio (fecha, precio anterior, precio nuevo y a quiénes se aplicó) y mostralo debajo.
- El precio tiene que salir de un solo lugar (la base), no estar escrito en el código: la pantalla de Suscripción, el cobro y cualquier texto que lo muestre lo leen de ahí.

Parte 2 — Cupones (perfil de administrador)
- Pestaña "Cupones": lista con código, descuento, usos ("3 de 5"), vencimiento, duración y estado ("Activo", "Agotado", "Vencido" o "Desactivado"), y un botón "Crear cupón".
- Formulario del cupón:
  - "Código": lo escribe el admin (ej.: CONSULTORA123). Sin espacios; se guarda en mayúsculas y no se puede repetir. Al usarlo no importan las mayúsculas o minúsculas.
  - "Tipo de descuento": "Porcentaje (%)" o "Monto fijo ($)". El porcentaje va de 1 a 100; el monto fijo no puede ser mayor que el precio.
  - "Duración del descuento": "Solo el primer pago", "Una cantidad de meses" (se elige cuántos) o "Para siempre" (mientras siga suscripta).
  - "Límite de usos" (opcional): cuántas consultoras pueden usarlo como máximo. Vacío = sin límite.
  - "Vence el" (opcional): último día en que se puede usar (hora de Argentina). Vacío = no vence.
  - "Activo": se puede desactivar en cualquier momento.
- Detalle de cada cupón: quiénes lo usaron, cuándo se suscribieron y hasta cuándo tienen el descuento.
- Un cupón que ya se usó no se puede borrar, solo desactivar. Si se edita, los cambios valen para las próximas consultoras; las que ya lo usaron conservan las condiciones con las que se suscribieron.
- Dejá la lógica de condiciones preparada para sumar otras más adelante (por ejemplo, ciudad o fecha de registro).

Reglas de uso:
- Un cupón se usa una sola vez por consultora y solo al suscribirse: no se aplica a una suscripción que ya está activa.
- Un uso cuenta cuando se aprueba el pago de la suscripción. Así, un pago rechazado o abandonado no ocupa un lugar.
- Evitá que se supere el límite si varias consultoras pagan al mismo tiempo (por ejemplo, reservando el lugar unos minutos mientras paga y liberándolo si el pago no se aprueba).
- El descuento se calcula sobre el precio vigente de la suscripción. Cuando termina la duración, el cobro vuelve solo al precio normal.
- Si el descuento deja el precio en $ 0, la suscripción se activa sin pasar por Mercado Pago.
- Si con la forma en que hoy se cobra en Mercado Pago no se puede bajar el monto por unos meses y después volver al precio normal, explicame las opciones antes de implementarlo.

Parte 3 — Pantalla de Suscripción (consultora)
- Debajo del precio, un link visible "¿Tenés un cupón de descuento?" que despliega un campo y el botón "Aplicar".
- Si el cupón es válido, el precio se muestra tachado y al lado el precio con descuento, con una explicación según la duración. Ejemplo: "¡Cupón aplicado! Pagás $ 10.000 por mes durante 3 meses. Después, $ 20.000." Hay un botón para quitar el cupón.
- Si no es válido, un mensaje claro según el caso: "Ese cupón no existe", "Ese cupón ya venció", "Ese cupón ya alcanzó el límite de usos", "Ya usaste este cupón" o "Ese cupón no está activo".
- Al tocar "Continuar", el cobro se hace con el precio con descuento.
- Con la suscripción activa, la pantalla muestra el descuento vigente: "Tenés un 50% de descuento hasta el [fecha]" (o "para siempre").

Cómo verifico que quedó bien:
- Cambio el precio desde el admin y la pantalla de Suscripción muestra el nuevo valor sin tocar el código.
- Creo el cupón CONSULTORA123 (50% y límite de 5 usos). Una consultora lo aplica, ve el precio con descuento y, cuando se aprueba el pago, el cupón queda en "1 de 5".
- Con los 5 usos completos, una sexta consultora recibe "Ese cupón ya alcanzó el límite de usos".
- La misma consultora no puede usar el cupón dos veces.
- Un cupón vencido o desactivado no se puede aplicar.
- Cuando termina la duración del descuento, el siguiente cobro es al precio normal.
```

## Configuración

### Prompt 1 · Configuración: campos nuevos

_Puntos: recordatorio nuevo, P1, P7, P23 y P26 · Hacelo después del Prompt 0._

```text
Tarea: reorganizar la pantalla Configuración y agregar campos nuevos (recordatorio del día de pedido, P1, P7, P23 y P26).

Cómo está hoy: "Nombre del negocio", "Moneda" (código ISO), "Objetivo mensual de ventas", "Umbral de stock bajo predeterminado" y el botón "Guardar cambios".

Cómo tiene que quedar, en bloques con título y en este orden:

Bloque "Tu negocio"
- "Nombre del negocio": igual que hoy.
- "Objetivo de ventas del mes": es el campo actual "Objetivo mensual de ventas". Se mantiene, porque lo vamos a mostrar en Inicio. Formato de pesos mientras se escribe ($ 200.000).
- Eliminá el campo "Moneda" de la pantalla. La app siempre trabaja en pesos argentinos: dejá ARS fijo internamente, sin mostrarlo.

Bloque "Pedidos y stock"
- Campo nuevo "Días de pedido". Título: "¿Qué día del mes hacés tu pedido?". Ayuda: "Ese día te recordamos qué productos vendiste que tienen poco stock, para que los sumes a tu pedido."
  - Un selector de día del mes (1 a 31). Es opcional: si queda vacío, no hay recordatorios.
  - Debajo, un botón "+ Agregar otro día" que muestra un segundo selector. Máximo 2 días; con 1 alcanza. El segundo se puede agregar en cualquier momento y quitar con un ícono de tacho.
  - No se puede elegir el mismo día dos veces.
  - Ayuda extra: "Si elegís 29, 30 o 31 y el mes tiene menos días, te avisamos el último día del mes."
  - En esta tarea solo se guardan los días, por consultora. El recordatorio en sí se hace en otra tarea.
- "Aviso de poco stock": es el campo actual "Umbral de stock bajo predeterminado", con el mismo funcionamiento. Texto: "Avisarme cuando un producto tenga menos de [ 2 ] unidades". Ayuda: "Para un producto puntual lo podés cambiar desde Stock, editando el producto."
- "Tu descuento de compra habitual": solo lectura (no se edita). Muestra el porcentaje calculado con la lógica de abajo. Ayuda: "Lo calculamos con tus pedidos de los últimos 3 meses. Lo usamos para estimar tu ganancia cuando un producto no tiene el costo cargado."

Bloque "Impuestos"
- Campo nuevo "Ingresos Brutos (%)". Opcional. Acepta decimales con coma o con punto (3,5 o 3.5), entre 0 y 20. Ayuda: "Si pagás Ingresos Brutos, poné el porcentaje y lo descontamos de tu ganancia. Si no pagás, dejalo vacío." El cálculo en las ventas se hace en la tarea de costos y ganancia.

Al final, el botón "Guardar cambios", con el mensaje de confirmación "Cambios guardados".

Lógica del descuento de compra habitual (dejala en una función reutilizable, porque la van a usar Stock, Ventas y Reportes):
- Se calcula con los pedidos confirmados de los últimos 3 meses que tengan descuento elegido (35, 40 o 45%).
- Fórmula (promedio ponderado por monto): (valor al público de esos pedidos − lo que pagó por ellos) ÷ valor al público de esos pedidos.
- Si no hay pedidos en los últimos 3 meses, se usa el descuento de su último pedido. Si nunca cargó un pedido, se usa 35% (el más bajo, para no exagerar la ganancia).
- En pantalla se muestra sin decimales (ej.: 41%); en los cálculos se usa el valor exacto.

Cómo verifico que quedó bien:
- Puedo guardar 0, 1 o 2 días de pedido, y no me deja repetir el mismo día.
- El campo "Moneda" ya no aparece y todo sigue en pesos.
- "Ingresos Brutos" acepta 3,5 y 3.5.
- La pantalla se ve bien en un celular de 375 px.
```

## Costos y ganancia (Stock, Ventas y Reportes)

### Prompt 2 · Costos y ganancia

_Puntos: P1, P7 y P14 · Hacelo después del Prompt 1._

```text
Tarea: corregir cómo se calcula el costo de los productos y la ganancia de las ventas (P1, P7 y P14). Es la base de Stock, Ventas y Reportes. Usá la función del "descuento de compra habitual" que se creó en la tarea de Configuración.

Problema actual: cuando un producto no tiene costo (por ejemplo, se cargó a mano con "Sin descuento"), la app usa el precio de venta como costo y la ganancia da $ 0. Caso real: venta #100, "Bálsamo para labios At Play", precio $ 20.100, "Costo de mercadería $ 20.100", "Ganancia $ 0".

Lo que ya funciona bien y se mantiene: al cargar un pedido desde el catálogo, la consultora elige el descuento que le dieron (35, 40 o 45%) y el costo es el precio al público × (1 − descuento). Ejemplo: Base TimeWise 3D a $ 27.200 con 45% → costo $ 14.960.

Cambios:

1. Costo desconocido no es igual al precio de venta
- Un producto puede no tener costo cargado. Nunca uses el precio de venta como costo.
- Si se vende un producto sin costo, estimalo con el descuento habitual: costo estimado = precio al público × (1 − descuento habitual).
- Esas ganancias se marcan como estimadas. En pantalla se muestran con "≈" delante (≈ $ 8.040) y, donde haya lugar, con la aclaración "Ganancia estimada: falta el costo de algún producto".

2. Costo promedio ponderado (mismo producto comprado con descuentos distintos)
- Cada producto guarda un solo costo unitario: el promedio ponderado por unidades.
- Al confirmar un pedido: costo nuevo = (unidades en stock × costo actual + unidades compradas × costo de esta compra) ÷ (unidades en stock + unidades compradas).
- Si el producto tenía 0 unidades (o menos) o no tenía costo, el costo nuevo es directamente el de esta compra.
- Vender no cambia el costo promedio. Corregir las unidades a mano tampoco.

3. Cada venta guarda el costo del momento
- Al confirmar una venta, guardá en cada renglón el costo unitario usado y si era real o estimado. Así, la ganancia de una venta vieja no cambia cuando entra un pedido nuevo.
- Única excepción: si la consultora carga a mano el costo de un producto que no tenía (desde "Editar producto"), recalculá las ventas anteriores de ese producto que tenían costo estimado; esas ventas dejan de ser estimadas.

4. Ingresos Brutos (porcentaje cargado en Configuración)
- Monto de IIBB = total que paga la clienta × porcentaje. El total es el que queda después de descuentos y recargos, con el envío que se le cobra incluido.
- Ganancia de la venta = total que paga la clienta − costo de los productos − envío que pagó la consultora − IIBB.
- Cada venta guarda el porcentaje de IIBB vigente al confirmarla; si después lo cambian, las ventas viejas no se recalculan.
- Quitá de la venta el campo "Ingresos Brutos" en pesos que hoy está en el paso "Ajustes del total": lo reemplaza este porcentaje.

5. Datos que ya existen
- Productos cuyo costo hoy es igual a su precio de venta porque se cargaron "Sin descuento": pasalos a "sin costo".
- Ventas ya registradas con esos productos: pasalas a ganancia estimada con el descuento habitual.
- Mostrame el plan de migración y esperá mi OK antes de aplicarlo.

6. Aviso de productos sin costo
- Prepará el dato "cantidad de productos sin costo cargado" para el aviso de Inicio "Tenés N productos sin costo cargado", con el botón "Completarlos", que lleva a Stock mostrando solo esos productos. El diseño de Inicio se hace en otra tarea.

Cómo verifico que quedó bien:
- Nunca más aparece "Ganancia $ 0" por falta de costo.
- Un producto con 2 unidades a $ 14.960 y 3 unidades a $ 16.320 queda con costo $ 15.776.
- Al vender ese producto se usa $ 15.776, y esa venta no cambia si después entra otro pedido.
- Con IIBB del 3%, una venta de $ 20.000 con costo $ 12.000 y sin envío muestra ganancia $ 7.400.
```

## Stock

### Prompt 3 · Diagnóstico: tonos repetidos en el pedido

_Punto: P15 · Solo investiga y propone; no cambia código hasta que lo apruebes._

```text
Tarea: diagnóstico (P15). En esta tarea no cambies código: investigá y contame.

Problema: en Stock → "Cargar pedido" → paso 2 "Elegí los productos del pedido", algunos productos aparecen repetidos con el mismo nombre y sin indicar el tono. Por ejemplo, "Base de Maquillaje TimeWise 3D" aparece 2 veces y "Corrector para Ojos Multi-Beneficios" aparece 3 veces. Si se eligen esas opciones y se confirma el pedido, en Stock sí aparecen diferenciados por tono (Base TimeWise 3D → "Luminosa (N/S)" y "Mate (C/G)"; Corrector → "Light 3", "Medium 1" y "Medium 2"). O sea, el dato del tono existe, pero el listado del pedido no lo muestra.

Necesito que:
1. Encuentres el origen: cómo se guardan los productos y sus tonos en la base (¿un registro por tono?, ¿un campo de tono aparte?), qué consulta o endpoint alimenta la lista del pedido, qué componente la dibuja y por qué no muestra el tono.
2. Verifiques si además hay duplicados reales (el mismo producto con el mismo tono cargado dos veces).
3. Revises si pasa lo mismo en otros lugares: el buscador del pedido, la importación desde Excel, CSV o PDF, y el paso de productos de "Nueva venta".
4. Me expliques la causa en palabras simples y me propongas cómo corregirla. Si no hay impedimentos, prefiero que en la lista del pedido los productos con tonos se agrupen igual que en Stock: una fila con el nombre del producto y, debajo, una fila por tono, cada una con su precio y sus botones − y +.

Esperá mi OK antes de aplicar la corrección.
```

### Prompt 4 · Stock: lista, filtros y edición

_Puntos: P13, P14, P18 y P24 (valor del stock) · Hacelo después de los Prompts 1 y 2._

```text
Tarea: reestructurar la sección Stock (P13, P14, P18 y el valor del stock que pasa desde Reportes, P24). Usá la lógica de costos de la tarea de costos y ganancia.

Cómo está hoy:
- Encabezado "Stock", subtítulo "182 productos en catálogo" y botón "Cargar" con dos opciones: "Cargar producto" y "Cargar pedido".
- Buscador, filtros "Categoría" y "Estado", y el tilde "Ver productos sin stock".
- Cada producto muestra: foto, nombre (se corta), línea, precio, "X uds" con un lápiz que edita en el mismo renglón el stock y el umbral, un ícono de bolsa ("Agregar") que abre un diálogo para agregar el producto a una venta (tocar el nombre abre lo mismo) y un menú ⋮ con "Marcar como discontinuado".
- Los productos con tonos se agrupan: una fila con el nombre ("Color · 2 tonos" y el total de unidades) y debajo una fila por tono.
- El aviso "Poco stock" es una franja que queda debajo del producto y parece del producto de abajo.
- El precio que se muestra parece ser el costo: Base TimeWise 3D figura a $ 17.680 y su precio al público es $ 27.200 (27.200 − 35% = 17.680).

Cambios:

1. Encabezado
- Título "Stock" y debajo: "12 productos · 47 unidades" (cantidad de productos con unidades y la suma de las unidades de todos). Cada tono cuenta como un producto, con el mismo criterio que el límite de la prueba gratis.
- Sacá "182 productos en catálogo": la consultora no necesita ver cuántos productos hay en la base.
- Debajo, una tarjeta compacta "Valor de tu stock" (pasa desde Reportes) con tres datos chicos en fila: "A precio de venta $ X", "A costo $ Y" (con "≈" si hay costos estimados) y "Ganancia posible $ Z".

2. Botón "Agregar" (P18)
- El botón "Cargar" pasa a llamarse "Agregar" y abre dos opciones, cada una con una línea de explicación:
  - "Cargar desde el catálogo": "Productos del catálogo que compraste en tu pedido". Abre el flujo actual de "Cargar pedido" (descuento → productos → confirmar).
  - "Cargar producto manualmente": "Productos que no están en el catálogo". Abre el formulario del punto 6.

3. Filtros y precio
- "Discontinuos" es una categoría más, al mismo nivel que "At Play" o "Fragancias femeninas". La cargamos nosotros desde la base cuando la empresa da de baja un producto; la consultora no decide qué es discontinuo.
- Eliminá el filtro "Estado". En el filtro "Categoría" quedan todas las categorías, incluida "Discontinuos".
- Eliminá la acción "Marcar como discontinuado" y cualquier estado "activo/discontinuado" que maneje la consultora. Si alguna consultora marcó productos así, tienen que volver a verse normalmente (no pueden quedar ocultos).
- En la misma fila que "Ver productos sin stock", agregá un tilde nuevo: "Ver precio de venta al público". Viene marcado siempre al entrar a Stock. Marcado: cada producto muestra su precio de venta. Desmarcado: muestra su costo (con "≈" si es estimado).

4. Cada producto (P13)
- Solo se ve: foto chica, nombre, precio (según el tilde), unidades, puntos y el botón de editar (lápiz).
- El nombre se ve completo: el renglón crece en alto lo que haga falta. Nunca se corta con "…".
- Unidades con singular y plural: "1 unidad", "3 unidades".
- Puntos: los que tiene cada producto en la base, como "12 pts". Si el producto no tiene puntos, no se muestra nada.
- Eliminá el menú ⋮.
- Eliminá el lápiz actual (la edición de stock y umbral en el mismo renglón).
- Eliminá el ícono de bolsa y el diálogo para agregar el producto a una venta. Tocar el producto ya no abre nada. La venta rápida desde Stock la vamos a pensar más adelante.
- Poco stock: sacá la franja. Al lado de las unidades, en el mismo renglón, mostrá solo el ícono de alerta (triángulo con "!", color naranja). Al tocarlo aparece un cartelito "Stock bajo". En la fila agrupadora de un producto con tonos, el ícono aparece si algún tono tiene poco stock (como hoy).
- Productos con tonos: se mantiene el agrupamiento actual. La fila agrupadora conserva "X tonos", el total de unidades y la flecha para desplegar; cada tono muestra nombre del tono, precio, unidades, puntos y lápiz.

5. Lápiz: pantalla nueva "Editar producto"
- El lápiz abre una pantalla nueva (en el celular, a pantalla completa). Hoy no existe una edición completa del producto: hay que crearla.
- Productos del catálogo: se pueden editar "Precio de venta", "¿Cuánto te costó?" (el mismo bloque del formulario manual, punto 6), "Unidades" y "Avisarme cuando queden menos de [X] unidades" (el umbral propio del producto, que hoy se editaba en el renglón). Nombre, tono, categoría, puntos y código se muestran pero no se editan.
- Productos cargados a mano: se puede editar todo (nombre, categoría, línea, tono, precio de venta, costo, unidades, puntos, código y umbral).
- Botones "Guardar cambios" y "Cancelar". Al guardar: mensaje "Producto actualizado".
- Cambiar las unidades acá es una corrección: no cambia el costo promedio. Si cargan el costo de un producto que no lo tenía, se recalculan sus ventas estimadas (lógica de la tarea de costos).

6. Formulario "Cargar producto manualmente" (P18 y P1)
- Orden de los campos:
  1. "Nombre del producto" (obligatorio).
  2. "Categoría" (obligatorio): selector con las categorías que existen (incluida "Discontinuos") y al final la opción "+ Nueva categoría", que muestra un campo de texto. Ya no se escribe la categoría a mano.
  3. "Precio de venta" (obligatorio, con formato de pesos).
  4. "Unidades" (obligatorio).
  5. "¿Cuánto te costó?", con dos formas de completarlo:
     - "Elegí el descuento que te dieron": botones 35%, 40% y 45%. La app calcula el costo sobre el precio de venta y lo muestra: "Te costó $ 11.055".
     - "Escribir el costo en pesos": campo con formato de pesos.
     - Si no completan ninguna y tocan "Agregar", aparece el aviso: "No cargaste el costo. Vamos a estimar tu ganancia con tu descuento habitual (40%). ¿Querés guardarlo igual?", con los botones "Guardar igual" y "Cargar el costo".
  6. Un desplegable "Más datos (opcional)" con "Línea", "Tono / variante", "Puntos" y "Código".
- Eliminá el selector actual "Descuento de compra (opcional)": lo reemplaza el bloque "¿Cuánto te costó?".

Cómo verifico que quedó bien:
- En un celular de 375 px, los nombres largos se leen completos.
- No quedan la bolsa, el menú ⋮, el filtro "Estado" ni el lápiz que editaba en el renglón.
- Al destildar "Ver precio de venta al público" veo los costos, y al volver a entrar a Stock el tilde está marcado otra vez.
- Con el tilde marcado, Base TimeWise 3D muestra $ 27.200.
- El ícono de alerta abre el cartelito "Stock bajo".
- "Editar producto" deja cambiar solo lo permitido según el tipo de producto.
```

### Prompt 5 · Cargar desde el catálogo (pedido)

_Puntos: P16 y P17 · Hacelo después del Prompt 4 y de aprobar la corrección del Prompt 3._

```text
Tarea: rediseñar el flujo "Cargar desde el catálogo", que es el actual "Cargar pedido" (P16 y P17). Si ya se aplicó la corrección del diagnóstico de tonos (P15), respetala.

Cómo está hoy: una ventana chica con 3 pasos. 1) "¿Qué descuento te dieron en este pedido?" (35%, 40%, 45% o "Elegir después"). 2) "Elegí los productos del pedido": buscador, "Importar desde Excel, CSV o PDF", categorías y, por producto, foto, nombre, precio al público, − 1 + y un botón "Agregar"; debajo se va armando una lista con lo agregado y su valor. 3) "Revisá tu pedido": productos, subtotal, descuento, total, "Atrás" y "Confirmar pedido".

Cambios:

1. Ventana a pantalla completa
- Los 3 pasos se muestran a pantalla completa, en el celular y en la compu. Se mantienen el título, el indicador de pasos y la X para cerrar.

2. Paso 2: elegir productos
- Precio: si ya eligieron el descuento, mostrá el precio al público tachado (gris y más chico) y debajo el precio con el descuento aplicado (destacado). Ejemplo: "$ 27.200" tachado y debajo "$ 16.320". Si eligieron "Elegir después", mostrá solo el precio al público y, arriba de la lista, el aviso "Elegí el descuento para ver cuánto te cuesta cada producto", con un link "Elegir ahora".
- Cantidad: arranca en 0 en todos los productos (hoy arranca en 1). Controles − / número / +. El "−" se ve apagado cuando está en 0.
- Eliminá el botón "Agregar" de cada producto. La cantidad que eligen con − y + es la que queda en el pedido; no hay que confirmar producto por producto.
- Los productos con cantidad mayor a 0 se destacan (fondo rosado suave y número en negrita), para ver de un vistazo qué se eligió.
- Se mantienen el buscador, "Importar desde Excel, CSV o PDF" y las categorías.
- Eliminá la lista que hoy se arma debajo con los productos agregados y su valor: la reemplazan el contador y su ventana (punto 3).

3. Contador fijo abajo
- Abajo de todo, siempre visible, un botón ancho con el resumen: "3 productos · 5 unidades · $ 36.180" (total con descuento; si no hay descuento elegido, total al público). Con 0 productos dice "Todavía no elegiste productos" y no se puede tocar.
- Al tocarlo se abre una ventana "Tu pedido hasta ahora" con la lista de lo elegido: nombre (con tono), cantidad, precio unitario con descuento y subtotal. Es solo para mirar: ahí no se edita (las cantidades se cambian con − y + en la lista). Tiene un botón "Seguir eligiendo" para cerrarla.
- Debajo del contador quedan los botones actuales "Atrás" y "Continuar". "Continuar" se habilita con al menos 1 producto y es la única confirmación de este paso.

4. Paso 3: "Revisá tu pedido" (P17)
- Cada renglón muestra nombre (con tono), cantidad × precio y subtotal, y dos íconos: lápiz y tacho.
- Lápiz: abre una ventana chica "Cambiar cantidad" con el nombre del producto, − / número / + (mínimo 1) y los botones "Guardar" y "Cancelar".
- Tacho: pide confirmación: "¿Querés quitar [producto] de tu pedido?", con los botones "Sí, quitar" y "Cancelar".
- No pongas − y + directamente en los renglones.
- Si quitan todos los productos: "Tu pedido está vacío" y un botón "Elegir productos" que vuelve al paso 2.
- Se mantienen subtotal, descuento y total. Si el descuento quedó en "Elegir después", se elige acá y no se puede confirmar sin elegirlo (como hoy).

5. Al confirmar, el pedido suma stock y actualiza costos como ya se definió (costo promedio ponderado).

Cómo verifico que quedó bien:
- Elijo cantidades con + y − en varios productos, toco "Continuar" una sola vez y veo todo en "Revisá tu pedido".
- Los productos elegidos se distinguen a simple vista de los que están en 0.
- El contador se actualiza con cada + y −, y su ventana muestra lo elegido.
- El lápiz cambia la cantidad y el tacho pide confirmación antes de quitar.
```

## Ventas

### Prompt 6 · Nueva venta y detalle de venta

_Puntos: P2, P5, P6, P7 y P10 · Hacelo después de los Prompts 1 y 2._

```text
Tarea: mejorar el flujo "Nueva venta" y el detalle de una venta (P2, P5, P6, P7 y P10).

Cómo está hoy: "Nueva venta" tiene 5 pasos. 1) "¿A quién le vendés?" (buscador, lista de clientas y "+ Nueva clienta"). 2) "Productos": tarjetas de categorías → productos (los que no tienen stock aparecen apagados y no se pueden elegir) → cantidad, precio de venta y "Agregar al carrito". 3) "Ajustes del total": Descuento %, Recargo %, Ingresos Brutos $, Envío cobrado $ y Costo real del envío $. 4) "¿Cómo paga?": Efectivo, Transferencia o Tarjeta; "Cuotas / Cantidad de pagos" (de Pago único a 12 pagos) y fecha. 5) "Revisá y confirmá".

Error actual: una venta en efectivo y en un solo pago queda "Pendiente", con una cuota que vence el mismo día. Resultado: en Inicio aparece "Cuota vencida" y en Reportes "Total cobrado $ 0", aunque la clienta pagó en el momento.

Antes de empezar, revisá cómo se guarda hoy el estado de una venta. Si un único campo mezcla pago y entrega ("Pendiente", "Entregado", "Pagado", "Cancelada"), proponeme separarlo en dos: estado del pago (cobrada / te debe) y estado de la entrega (entregada / pendiente de entrega), más "cancelada". Mostrame el plan antes de migrar.

Cambios:

1. Paso "Clienta" (P5)
- Debajo de "+ Nueva clienta", un botón "Completar después" que pasa directo a productos sin elegir clienta.
- Regla: si la venta queda pendiente de cobro (ver punto 4), la clienta es obligatoria. Antes de confirmar se muestra: "Para dejar una venta pendiente de cobro tenés que elegir la clienta", con el buscador y "+ Nueva clienta" ahí mismo.
- Las ventas sin clienta se ven en la lista de Ventas con la etiqueta "Sin clienta" y un botón "Asignar clienta". Prepará también el dato para el aviso de Inicio "Tenés N ventas sin clienta" (se diseña en la tarea de Inicio).
- Al asignar la clienta, la venta pasa a contar en sus datos (total comprado, historial, etc.).

2. Paso "Productos" (P6)
- Arriba, un buscador: "Buscá el producto por nombre". Busca en todas las categorías y muestra cada resultado con su tono, precio y disponibilidad ("3 disponibles" o "Sin stock").
- Sin búsqueda, se ve en este orden: "Tus productos en stock" (los que tienen unidades), "Más vendidos" (sus 6 productos más vendidos de los últimos 3 meses) y "Todas las categorías" (las tarjetas actuales; "Discontinuos" es una categoría más, sin trato especial).
- Los productos sin stock por ahora siguen como están: en otra tarea se van a poder vender con un aviso.
- "Agregar al carrito" pasa a ser "Agregar a la venta".
- El precio de venta se muestra y se escribe con formato de pesos ($ 20.100).

3. Ajustes del total (P7)
- El paso "Ajustes del total" deja de ser obligatorio. Los pasos quedan: Clienta → Productos → Pago → Revisá y confirmá.
- En el paso "Pago", agregá un botón bien visible (ancho completo, con borde y un ícono +, no un link chiquito): "Agregar descuento, recargo o envío". Al tocarlo se despliegan:
  - "Descuento (%)"
  - "Recargo (%)"
  - "Envío que le cobrás ($)"
  - "Envío que pagás vos ($)", con la ayuda "Lo que te cuesta a vos el envío. No se le suma a la clienta." Reemplaza a "Costo real del envío".
- Si cargaron algún ajuste, el botón muestra el resumen, por ejemplo: "Descuento 10% · Envío $ 1.500 — Editar".
- El desglose sigue mostrando el precio original, cada ajuste por separado y el total a cobrar.
- El campo "Ingresos Brutos" en pesos ya no está (ahora es un porcentaje en Configuración).

4. Paso "Pago" (P2)
- Un solo título para la cantidad de pagos: "¿En cuántos pagos?" (hoy dice "Cuotas" y "Cantidad de pagos").
- Debajo, una casilla grande y clara: "La clienta paga en el momento", con el subtítulo "Destildala si te queda debiendo".
- Efectivo o transferencia en un solo pago: la casilla viene tildada.
  - Tildada: la venta queda cobrada en la fecha de la venta. No genera ninguna cuota pendiente ni vencida y suma en "Total cobrado".
  - Destildada: aparece "¿Cuándo te paga?", con las opciones "En 7 días" (viene elegida), "En 15 días", "En 30 días" y "Elegir fecha".
- Efectivo o transferencia en 2 pagos o más (la casilla viene destildada):
  - Tildada: la primera cuota queda cobrada hoy y las demás vencen cada 30 días desde la fecha de la venta.
  - Destildada: no hay nada cobrado y aparece "¿Cuándo vence la primera cuota?", con las mismas opciones; las demás vencen cada 30 días después de la primera.
- Tarjeta: las cuotas son con el banco, así que la clienta no le debe a la consultora. Con tarjeta (en un pago o en cuotas) la venta queda siempre cobrada: no se muestra la casilla, se ve el texto "Con tarjeta, la venta queda cobrada" y la cantidad de cuotas queda solo como dato.
- Ventas viejas: no las cambies automáticamente, porque no sabemos si se cobraron. La consultora las puede marcar como cobradas.

5. Paso "Revisá y confirmá"
- Mostrá la clienta (o "Sin clienta — la cargás después"), los productos con cantidad y precio, el precio original, los ajustes, el total y el estado del pago: "Pagó en el momento" o "Te debe $ X — vence el [fecha]". Se mantiene "Observaciones".

6. Entrega
- Las ventas de productos con stock quedan "Entregadas" al confirmarlas. Solo lo que se venda sin stock queda "Pendiente de entrega" (eso se hace en otra tarea).
- En el detalle de la venta se puede cambiar a mano entre "Entregada" y "Pendiente de entrega".

7. Detalle de una venta (P10)
- Arriba, dos etiquetas separadas: la del pago ("Cobrada" o "Te debe $ X") y, si corresponde, la de la entrega ("Pendiente de entrega").
- Las cuotas pendientes se muestran arriba, cada una con un botón destacado "Marcar como pagada".
- "Cancelar venta" queda abajo y con menos peso visual (borde y texto rojo, no un bloque rojo lleno). Al tocarlo, pide confirmación: "¿Seguro que querés cancelar esta venta?", con "Sí, cancelar venta" y "No, volver". Revisá qué pasa hoy con el stock al cancelar y que el mensaje lo explique (por ejemplo: "Los productos vuelven a tu stock").
- "Editar" queda como botón secundario.

8. Lista de Ventas
- Corregí "1 ventas registradas" → "1 venta registrada" (singular y plural en todos los contadores).
- El filtro de estado queda: "Todas", "Te deben", "Pendientes de entrega", "Cobradas" y "Canceladas".
- La ganancia de cada venta se muestra con "≈" cuando es estimada.

Cómo verifico que quedó bien:
- Una venta en efectivo en un pago con la casilla tildada queda cobrada, no aparece como vencida en Inicio y suma en "Total cobrado".
- Una venta pendiente de cobro no se puede confirmar sin clienta; una cobrada sí.
- El buscador encuentra productos de cualquier categoría.
- El flujo tiene 4 pasos y los ajustes se abren desde el botón del paso "Pago".
- "Cancelar venta" pide confirmación.
```

### Prompt 7 · Borradores de ventas y pedidos

_Punto: P4 · Hacelo después de los Prompts 5 y 6._

```text
Tarea: guardar como borrador las ventas y los pedidos sin terminar (P4).

Cómo está hoy: si en "Nueva venta" o en "Cargar pedido" se toca la X, se pierde todo lo cargado sin aviso.

Cambios:

1. Guardado automático
- Mientras la consultora carga una venta o un pedido, guardá el avance automáticamente como borrador en la base (por consultora). Así no se pierde si cierra la app, se queda sin batería o cambia de dispositivo.
- Los borradores no afectan el stock, los reportes ni los datos de las clientas hasta que se confirman.

2. Al cerrar
- Si tocan la X (o vuelven atrás) y ya cargaron algo, preguntá: "¿Querés guardar lo que cargaste?", con los botones "Guardar borrador", "Descartar" y "Seguir cargando".
- Si no cargaron nada, se cierra directamente.

3. Dónde se ven
- En Ventas, arriba de todo: "Ventas sin terminar (N)". Cada una muestra clienta (o "Sin clienta"), cantidad de productos y fecha, con un botón "Retomar" y un tacho para descartarla, con confirmación: "¿Querés descartar esta venta sin terminar?".
- En Stock, arriba de todo, lo mismo para "Pedidos sin terminar".
- Prepará el dato para Inicio: "Tenés N ventas sin terminar" y "Tenés N pedidos sin terminar", con el botón "Retomar" (se diseña en la tarea de Inicio).
- "Retomar" abre el flujo en el paso donde quedó, con todo lo cargado.
- Puede haber más de un borrador a la vez.

Cómo verifico que quedó bien:
- Empiezo una venta, cierro la pestaña, vuelvo a entrar y la encuentro en "Ventas sin terminar".
- Al tocar la X con datos cargados aparece la pregunta; sin datos, se cierra.
- Un pedido en borrador no suma stock hasta que lo confirmo.
```

### Prompt 8 · Venta sin stock y día de pedido

_Puntos: P3 y el recordatorio nuevo · Hacelo después de los Prompts 1, 5 y 6._

```text
Tarea: permitir vender productos sin stock y crear el recordatorio del día de pedido, con aviso en Inicio y notificación al celular (P3 y el recordatorio nuevo del día de pedido). Usa los "Días de pedido" que se guardan en Configuración.

Cómo trabajan las consultoras: hacen 1 pedido de stock por mes (a veces 2), en un día que eligen. Ese día necesitan saber qué productos vendieron que tienen poco stock, y qué vendieron sin tenerlo, para sumarlo al pedido.

Parte 1 — Vender sin stock
- En "Nueva venta", los productos sin stock dejan de estar apagados. Al elegir uno aparece el cartel: "No contás con stock de este producto. ¿Querés continuar con la venta?", con los botones "Sí, continuar" y "Cancelar".
- Si eligen más unidades de las que tienen (por ejemplo, tiene 2 y vende 5): "Tenés 2 unidades de este producto. Las 3 que faltan quedan pendientes para tu próximo pedido. ¿Querés continuar con la venta?", con los mismos botones.
- Se descuentan las unidades que hay (el stock queda en 0, nunca negativo a la vista) y las que faltan se guardan como "unidades pendientes" de ese renglón de la venta.
- Ese renglón, y la venta, quedan "Pendiente de entrega", con la aclaración "Se pide el [próximo día de pedido]".
- Si la consultora no configuró días de pedido, queda "Pendiente de entrega" sin fecha, y el cartel agrega: "Configurá tu día de pedido para que te lo recordemos", con un link a Configuración.
- El pago es independiente: la venta puede estar cobrada o pendiente de cobro.
- "Discontinuos" funciona igual que cualquier otra categoría.

Parte 2 — Cuando llega el pedido
- Al confirmar un pedido desde el catálogo que trae productos con unidades pendientes, la app asigna automáticamente las unidades nuevas a esas ventas, empezando por la más vieja. Esas unidades no se suman al stock disponible, porque ya están vendidas.
- Si el pedido trae menos unidades de las pendientes, se asignan las que hay y el resto sigue pendiente.
- En Inicio aparece un aviso por clienta: "Ya podés entregarle a [clienta]: [producto] x[cantidad]", con un botón "Marcar como entregado". Con un solo toque ese renglón queda entregado; cuando todos los renglones de la venta están entregados, la venta queda "Entregada" y el aviso desaparece.

Parte 3 — Recordatorio del día de pedido
- Se genera en cada día de pedido configurado (1 o 2 por mes). Si el día no existe en ese mes (29, 30 o 31), se genera el último día del mes.
- Qué productos incluye:
  a) Los vendidos desde el recordatorio anterior hasta ese día que hoy tienen un stock igual o menor al umbral de poco stock (el del producto o el general). Con 2 días configurados, el período va de un día de pedido al otro; con 1 día, de ese mismo día del mes anterior a hoy.
  b) Todas las unidades pendientes de ventas sin stock, sin importar el período.
- Cada producto muestra nombre (con tono), unidades vendidas en el período, stock actual y unidades pendientes, si hay.
- Si la lista queda vacía, no se genera recordatorio.
- En Inicio, desde ese día y hasta que lo cierren: "Hoy es tu día de pedido", con el texto "Estos productos que vendiste tienen poco stock" y la lista (los primeros 5 y "Ver todos"). Botones: "Armar pedido con estos productos" y "Listo, ya lo pedí" (que lo cierra).
- "Armar pedido con estos productos" abre "Cargar desde el catálogo" con esos productos ya cargados: la cantidad sugerida es lo vendido en el período (caso a) o las unidades pendientes (caso b). Igual se pasa primero por el paso del descuento, y la consultora puede cambiar todo.
- Dejá el dato listo para que la Agenda muestre ese día un evento automático "Día de pedido" con la misma lista (se diseña en la tarea de Agenda).

Parte 4 — Notificación al celular
- El día de pedido, a las 9:00 (hora de Argentina), mandá una notificación que aparezca en el centro de notificaciones del celular, como las de WhatsApp. Título: "Hoy es tu día de pedido". Texto: "Tenés N productos para pedir. Tocá para verlos." Al tocarla se abre la app en Inicio.
- Implementación con notificaciones web (Web Push): manifest de la app web (si no existe), service worker, claves VAPID como variables de entorno en Railway, suscripciones guardadas en la base por consultora (puede tener varios dispositivos) y una tarea programada en el servidor que genere los recordatorios y envíe las notificaciones. Evitá envíos duplicados si el servidor corre en más de una instancia (por ejemplo, marcando "ya enviado" por consultora y fecha). Borrá las suscripciones que el servicio informe como vencidas. Elegí la forma más simple compatible con Railway y explicame cómo queda configurada.
- El recordatorio de Inicio se genera aunque la consultora no tenga las notificaciones activadas.
- Permiso: nunca lo pidas al abrir la app. En Configuración, en el bloque "Pedidos y stock", agregá un botón "Activar avisos en este celular". Al tocarlo se pide el permiso; si acepta, se ve "Avisos activados en este celular ✓". Si lo rechaza, explicá en palabras simples cómo habilitarlo desde la configuración del navegador.
- iPhone: Apple solo permite notificaciones si la app está agregada a la pantalla de inicio (iOS 16.4 o más nuevo). En un iPhone sin la app agregada, en lugar del botón mostrá los pasos: "Tocá Compartir y después 'Agregar a inicio'. Abrí Impulsa desde ese ícono y activá los avisos." En Android funciona desde Chrome.
- Agregá un botón "Probar aviso" que manda una notificación de prueba a ese dispositivo.
- Dejá la parte de notificaciones reutilizable: después la vamos a usar para otros avisos.

Cómo verifico que quedó bien:
- Vendo un producto sin stock: aparece el cartel, la venta queda "Pendiente de entrega" y el stock no queda negativo.
- Cargo un pedido que trae ese producto: aparece en Inicio "Ya podés entregarle a…" y con un toque queda entregado.
- Con un día de pedido configurado para hoy, aparece el aviso en Inicio con los productos correctos.
- En un Android con avisos activados, "Probar aviso" llega al centro de notificaciones.
```

## Clientas

### Prompt 9 · Clientas: alta, filtros y ficha

_Puntos: P10, P19, P20 y P21 · Hacelo después del Prompt 6._

```text
Tarea: mejorar la sección Clientas: alta de clienta, filtros y ficha (P10, P19, P20 y P21).

Cómo está hoy:
- Lista: "1 clienta | Total facturado: $ 20.100", botón "Nueva Clienta", buscador y dos desplegables sin título que dicen "Todas" (uno filtra por saldo pendiente y el otro por "Más de 2 meses" / "Más de 3 meses").
- Formulario "Nueva Clienta": "Nombre Completo (opcional)", "Teléfono *" (con el ejemplo 2616570560, que parece un número real), "Cumpleaños" con día, mes y año, "Email", "Dirección" y "Notas".
- Ficha: datos, botón WhatsApp, 6 tarjetas con números, botones "Editar" (destacado), "Nueva Venta" y "Eliminar" (bloque rojo grande), y pestañas "Actividad", "Historial", "Citas" y "Notas". "Actividad" e "Historial" muestran lo mismo; en "Notas" dice "Sin notas" y no hay forma de agregar una. El saldo pendiente se ve en la lista pero no en la ficha.

Cambios:

1. Formulario "Nueva clienta" (P19)
- "Nombre y apellido": obligatorio y primero.
- "Celular": opcional. Ejemplo en gris: "Ej.: 261 555 1234". Ayuda: "Lo usamos para el botón de WhatsApp."
- "Cumpleaños": opcional, solo día y mes (dos selectores, sin año). Las fechas que ya existen conservan el día y el mes.
- "Email", "Dirección" y "Notas" siguen como opcionales.
- Arriba del formulario, un botón "Importar desde mis contactos" que completa nombre y celular desde la agenda del teléfono. Usá la Contact Picker API y mostrá el botón solo donde funciona (Chrome en Android); en iPhone y en compu no se muestra.
- Sin celular no se muestra el botón de WhatsApp en ningún lado.
- Prepará el dato para el aviso de baja prioridad de Inicio: "Tenés N clientas sin celular cargado. Cargalo para poder escribirles por WhatsApp", que lleva a la lista mostrando solo esas clientas (se diseña en la tarea de Inicio).

2. Filtros (P20)
- Reemplazá los dos desplegables por un solo botón "Filtros" (con ícono). Abre una ventana con tres opciones grandes:
  - "Pendiente de pago": clientas que deben plata.
  - "Hace tiempo que no compran": clientas con al menos una compra cuya última compra fue hace más de 2 meses.
  - "Cumplen años este mes": ordenadas por día.
- Se usa una opción por vez. Al elegirla, se aplica y la ventana se cierra.
- El filtro activo se ve arriba de la lista como una etiqueta con una cruz para quitarlo (por ejemplo, "Pendiente de pago ✕"), y el botón "Filtros" muestra un punto de color. En la ventana, "Ver todas" quita el filtro.
- Se mantiene el buscador.

3. Ficha de la clienta (P21 y P10)
- Arriba, debajo del nombre y el celular: si tiene saldo pendiente, una tarjeta destacada "Te debe $ 20.100" con dos botones: "Registrar pago" (principal) y "WhatsApp" (abre el chat con la clienta, sin mensaje armado). Si no debe nada, la tarjeta no se muestra.
- "Registrar pago" abre una ventana con "Monto" (viene completo con lo que debe y se puede cambiar para pagos parciales), "Fecha" (hoy) y "Forma de pago" (Efectivo, Transferencia o Tarjeta). Al guardar, el pago se aplica a las cuotas pendientes empezando por la más vieja: las que cubre completas quedan pagadas y, si sobra una parte, se descuenta de la siguiente. Después muestra el saldo que queda. El monto tiene que ser mayor a 0 y no puede superar lo que debe. Si hoy el sistema no admite pagos parciales, proponeme cómo guardarlos y mostrame el plan antes de migrar.
- Botones de la ficha: "Nueva venta" pasa a ser el botón principal (color destacado); "Editar" queda secundario (con borde); "Eliminar" queda al final, más chico y sin relleno (texto y borde rojos). Al tocar "Eliminar", confirmación: "¿Seguro que querés eliminar a [nombre]? Esta acción no se puede deshacer.", con "Sí, eliminar" y "Cancelar". Revisá qué pasa hoy con sus ventas al eliminarla y contámelo.
- Pestañas: uní "Actividad" e "Historial" en una sola, "Historial", con compras y pagos ordenados del más nuevo al más viejo. Se mantiene "Citas" tal como está. En "Notas", agregá un botón "+ Nueva nota" (campo de texto y "Guardar"); cada nota muestra su fecha y se puede borrar con confirmación.
- Orden de las pestañas: Historial, Citas, Notas.

Cómo verifico que quedó bien:
- Puedo crear una clienta solo con el nombre.
- El cumpleaños se carga sin año.
- "Filtros" muestra las tres opciones, y el filtro activo se ve y se puede quitar.
- Si la clienta debe $ 20.100 y registro un pago de $ 5.000, queda debiendo $ 15.100.
- "Eliminar" pide confirmación.
```

## Inicio

### Prompt 10 · Inicio: objetivo del mes y avisos

_Punto: P23 · Hacelo después de los Prompts 2, 6, 7, 8 y 9 (usa los avisos que preparan)._

```text
Tarea: rediseñar Inicio para que muestre el objetivo del mes y todos los avisos ordenados (P23, más los avisos que prepararon las tareas anteriores).

Cómo está hoy: "Hola, [nombre]" / "Así está tu negocio hoy", una tarjeta "Alertas importantes" (por ejemplo, "Cuota de María Gómez está vencida $ 20.100" con el botón "Cobrada"), el botón "Registrar venta", la tarjeta "Este mes vendiste $ 20.100" y el link "Ver todos los reportes". En el celular, los nombres largos de los avisos se cortan con "…".

Cómo tiene que quedar, de arriba hacia abajo:

1. Saludo (igual que hoy)

2. Tarjeta "Tu objetivo del mes" (reemplaza a "Este mes vendiste")
- Con objetivo cargado en Configuración: "Vas $ X de $ Y", una barra de progreso con el porcentaje y debajo "Te faltan $ Z · quedan N días".
- Si llegó al objetivo: "¡Llegaste a tu objetivo del mes! 🎉" y lo que lleva vendido.
- Sin objetivo: "Este mes vendiste $ X" y un botón "Definir mi objetivo", que lleva a Configuración.

3. Botón "Registrar venta" (igual que hoy)

4. Avisos agrupados en tres bloques
Cada bloque se oculta si no tiene avisos y muestra hasta 3, con "Ver más" para el resto. Los textos se leen completos, sin cortar con "…".

Bloque "Para hacer hoy"
- "Ya podés entregarle a [clienta]: [producto] x[cantidad]" → botón "Marcar como entregado".
- "Hoy es tu día de pedido" → la lista de productos y los botones "Armar pedido con estos productos" y "Listo, ya lo pedí".
- Citas de hoy: "Hoy a las [hora]: [tipo] con [clienta]" → botón "Ver".
- Cumpleaños de hoy: "Hoy cumple [clienta] 🎂" → botón "WhatsApp" (abre el chat, sin mensaje armado; solo si tiene celular).

Bloque "Pendientes"
- Cuotas vencidas: "[Clienta] te debe $ X (venció el [fecha])" → botones "Cobrada" (como hoy) y "WhatsApp".
- "Tenés N ventas sin terminar" y "Tenés N pedidos sin terminar" → botón "Retomar".
- "Tenés N ventas sin clienta" → botón "Asignar clienta".

Bloque "Para mejorar tu negocio" (baja prioridad)
- "N productos con poco stock" → botón "Ver" (Stock mostrando esos productos).
- "N clientas hace más de 2 meses que no compran" → botón "Ver" (Clientas con el filtro "Hace tiempo que no compran").
- "Tenés N productos sin costo cargado" → botón "Completarlos".
- "Tenés N clientas sin celular cargado" → botón "Completar".
- Los avisos de este bloque se pueden ocultar con "Ocultar" y vuelven a aparecer a los 7 días si siguen vigentes.

Los avisos de los dos primeros bloques desaparecen solos cuando se resuelven.

5. Link "Ver todos los reportes" (igual que hoy)

Rendimiento: armá un solo pedido al servidor que devuelva todo lo de Inicio (objetivo y avisos), en lugar de muchos pedidos separados.

Cómo verifico que quedó bien:
- Con un objetivo de $ 200.000 y $ 50.000 vendidos, veo "Vas $ 50.000 de $ 200.000" y la barra al 25%.
- Sin objetivo, veo el botón "Definir mi objetivo".
- Cada aviso lleva a la acción correcta y desaparece al resolverla.
- En un celular de 375 px no se cortan los nombres.
```

#### Advertencia para cuando se implemente (encontrado haciendo el Prompt 11, sin tocar acá)

El aviso **"N clientas hace más de 2 meses que no compran"** (línea de arriba, bloque "Para
mejorar tu negocio") tiene que armarse con cuidado: `GET /api/reports/inactive-clients`, el
endpoint que ya existe y que este aviso va a reusar, **incluye a las clientas que NUNCA
compraron** (`lastPurchase: null`) junto con las que sí compraron hace tiempo — confirmado
leyendo `getInactiveClients`/`getInactiveClientsMemory` en `server/storage.ts`. El código
ACTUAL de Inicio (antes de este Prompt 10, sección "Seguimiento de clientas" de
`client/src/pages/Dashboard.tsx`) ya tiene este mismo problema de fondo: usa la lista cruda de
`inactiveClients` sin filtrar, así que una clienta que nunca compró puede ocupar uno de los 5
lugares de esa sección como si "hace tiempo que no compra" (se la distingue con el texto
"Todavía no te compró" en vez de "Hace N días sin comprarte", pero igual cuenta para el cupo y
para cualquier conteo "N clientas..."). Si no se filtra (`lastPurchase !== null`) al armar este
aviso nuevo, el número "N" de "N clientas hace más de 2 meses que no compran" va a contar
clientas que nunca compraron — inconsistente con Clientas (filtro "Hace tiempo que no
compran", que SÍ las excluye, vía `matchesStaleFilter`) y con "Clientas para recontactar" de
Reportes (Prompt 11), que también las excluye explícitamente. **No se corrige ahora** — queda
para cuando se implemente este Prompt 10.

## Reportes

### Prompt 11 · Reportes: claro y liviano

_Punto: P24 · Hacelo después del Prompt 2._

```text
Tarea: simplificar Reportes para que sea claro y liviano (P24).

Cómo está hoy: selector de período, "Comparar con período anterior", "Exportar KPIs", "Imprimir", un resumen escrito y unos 15 bloques: ventas totales, ganancia, costo, ticket promedio, cantidad de ventas, tendencia, ventas por categoría, productos más vendidos, mejores clientas, método de pago, cuotas, cobrado, citas, stock valorizado, clientas inactivas, cumpleaños y cuotas pendientes. Los ejes de algunos gráficos salen sin formato (550000, 1100000).

Cómo tiene que quedar, de arriba hacia abajo:

1. Período
- Título "Reportes" y, debajo, el rango elegido en palabras (por ejemplo, "1 al 31 de octubre").
- Botones rápidos, en este orden: "Este mes" (elegido al entrar), "El mes pasado", "Últimos 3 meses", "Esta semana" y "Personalizado" (abre "Desde" y "Hasta"). En el celular se desplazan de costado.
- Eliminá "Comparar con período anterior", "Exportar KPIs" e "Imprimir". Más adelante vamos a diseñar un PDF para descargar.

2. Tres números grandes
- "Vendiste": total vendido en el período.
- "Ganaste": ganancia del período (con "≈" si incluye costos estimados).
- "Te deben hoy": total pendiente de cobro a la fecha (no depende del período). Al tocarlo, abre Clientas con el filtro "Pendiente de pago".
- Debajo de "Vendiste" y "Ganaste", una línea chica de comparación con el período anterior equivalente: "▲ 12% vs. septiembre" en verde o "▼ 5%" en rojo. Si no hay datos anteriores, no se muestra.
- En el celular, "Vendiste" ocupa todo el ancho y debajo van "Ganaste" y "Te deben hoy", uno al lado del otro. En compu, los tres en una fila.

3. Resumen escrito
- Se mantiene el párrafo actual, en lenguaje simple. Ejemplo: "Este mes vendiste $ X a 8 clientas. Tu producto más vendido fue [producto] y tu mejor clienta, [clienta]." Cambiá "rentabilidad promedio" por "de cada $ 100 que vendiste, ganaste $ N".

4. "Compra promedio por clienta"
- Tarjeta chica con el monto y la explicación "Lo que gastó en promedio cada clienta en este período". Cálculo: total vendido ÷ cantidad de clientas distintas que compraron en el período.

5. "Productos más vendidos"
- Los 5 más vendidos por unidades. Cada uno muestra posición, nombre (con tono), categoría (etiqueta chica), unidades y monto, con una barra horizontal suave proporcional a las unidades. "Ver todos" muestra hasta 10.

6. "Mejores clientas"
- Las 5 que más compraron en el período, en pesos: nombre, cantidad de compras y total. Al tocar una, se abre su ficha.

7. "Clientas para recontactar"
- Clientas con al menos una compra cuya última compra fue hace más de 2 meses (a la fecha, no depende del período; mismo criterio que el filtro "Hace tiempo que no compran"). Cada una con "Última compra: hace 3 meses" y un botón "WhatsApp" (abre el chat, sin mensaje armado). Hasta 5, con "Ver todas", que abre Clientas con ese filtro.

8. Bloques que se eliminan
- Tendencia, ventas por categoría, método de pago, cuotas, cobrado, citas, cumpleaños (pasan a Inicio) y cuotas pendientes (quedan cubiertas por "Te deben hoy"). "Valor del stock" ya se pasó a Stock en otra tarea.

Diseño: tarjetas con el mismo estilo y la misma separación, títulos claros y montos con formato $ 1.250.000. Si no hay ventas en el período: "Todavía no hay ventas en este período".

Cómo verifico que quedó bien:
- Al entrar veo "Este mes" elegido y los tres números arriba.
- "Personalizado" me deja elegir fechas y todo se recalcula.
- No quedan botones de exportar ni de imprimir.
- En un celular de 375 px se lee todo sin hacer zoom.
```

#### Decisiones tomadas (no están en el texto del prompt, anotadas para que no se pierdan)

- **Comparación con el período anterior**: si el período está EN CURSO ("Este mes", "Esta
  semana"), se compara con los mismos días del período anterior equivalente — hoy 8 de
  octubre → del 1 al 8 de octubre contra del 1 al 8 de septiembre, con el texto
  "▲ 12% vs. mismos días de septiembre". Si el mes anterior es más corto (31 de marzo contra
  febrero), se toma hasta su último día real. Los períodos CERRADOS ("El mes pasado",
  "Últimos 3 meses", "Personalizado") se comparan con el período anterior completo, de la
  misma duración.
- **"Te deben hoy"**: todo lo que falta cobrar a HOY (no depende del período elegido),
  incluidas las cuotas que todavía no vencen, descontando los pagos parciales (`amount_paid`
  del Prompt 9). Debajo va una línea chica en rojo, "de eso, $ X ya venció", solo si hay algo
  vencido. El total tiene que coincidir exactamente con lo que suma Clientas con el filtro
  "Pendiente de pago" — se reusa el mismo cálculo de saldo del Prompt 9, nunca uno nuevo.
- **"Ganaste"**: se reusa la misma función de ganancia del Prompt 2 (con "≈" si hay costos
  estimados, Ingresos Brutos incluidos) — no se recalcula de cero.
- **Qué cuenta y qué no**: las ventas canceladas y los borradores no cuentan en nada de esta
  pantalla. Las ventas con entrega pendiente SÍ cuentan (la entrega es un estado aparte del
  pago, no afecta nada de Reportes).
- **Endpoint único + reutilización, sin borrar nada del backend**: la pantalla nueva pega a un
  endpoint nuevo (`GET /api/reports/overview`) más 2 que ya existían sin cambios
  (`/api/reports/top-products`, `/api/reports/top-clients`) y uno más con un parámetro fijo en
  vez de un selector (`/api/reports/inactive-clients?days=60`). Ningún endpoint ni función de
  `storage.ts` se borró — `Reportes.tsx` simplemente dejó de llamar a los que ya no necesita,
  para poder reusarlos el día que se arme el PDF de reportes. Quedan sin ningún consumidor
  (ni Reportes, ni ninguna otra pantalla) desde este Prompt:
  - `GET /api/reports/top-categories` (`getTopCategories`)
  - `GET /api/reports/payment-methods` (`getSalesByPaymentMethod`)
  - `GET /api/reports/installments-breakdown` (`getInstallmentsBreakdown`)
  - `GET /api/reports/appointments-summary` (`getAppointmentsSummary`) — `Agenda.tsx` y
    `AppointmentDetailDialog.tsx` todavía invalidan esta query al crear/editar una cita (no se
    tocó, revisar si sigue teniendo sentido cuando se arme el PDF)
  - `GET /api/reports/collected-payments` (`getCollectedPayments`) — **cuidado**: sigue siendo
    la verificación de "nunca se cuenta dos veces" de los tests del Prompt 9
    (`clients-payments.test.ts`, `clients-payments-legacy.test.ts`), no es solo un bloque de UI
  - `GET /api/reports/pending-installments-totals` (`getPendingInstallmentsTotals`)
  - `GET /api/reports/product-cost-summary` (`getProductCostSummary`)

  Siguen con consumidor real, sin cambios: `sales-summary`/`pending-installments`/
  `upcoming-birthdays` (Inicio), `stock-valuation` (Stock), `top-products` (wizard de venta +
  Reportes), `top-clients`/`inactive-clients` (Reportes).

## Agenda

### Prompt 12 · Agenda: tipos, eventos automáticos y WhatsApp

_Punto: P25 · Hacelo después de los Prompts 8 y 9._

```text
Tarea: mejorar la Agenda: tipos de cita, eventos automáticos y botón de WhatsApp (P25).

Cómo está hoy: "Agenda", "0 citas este mes", un filtro "Todos los eventos" (Sesión de belleza, Capacitación, Entrega de productos, Visita, Demostración, Seguimiento y Venta), el botón "Nueva Cita", el calendario del mes y la lista del día. El formulario "Nueva Cita" tiene Clienta, Fecha, Hora, "Tipo de Cita" (Sesión de belleza, Capacitación, Entrega de productos, Visita, Demostración y "Crear evento"), Ubicación y Notas. Las cuotas que vencen y los cumpleaños no aparecen en el calendario.

Cambios:

1. Tipos de cita (la misma lista en el formulario y en el filtro)
- "Sesión de belleza", "Entrega de productos", "Visita", "Demostración", "Capacitación", "Seguimiento" y "Crear evento".
- Sacá "Venta" del filtro.
- "Crear evento" se mantiene para armar un evento desde cero, sin depender de los tipos que damos nosotros: al elegirlo aparece el campo "Nombre del evento" (obligatorio; por ejemplo, "Reunión de unidad").
- La clienta es opcional en todos los tipos.

2. Eventos automáticos en el calendario (no se cargan a mano)
- "Cobro": cada cuota pendiente en su fecha de vencimiento → "Cobrar a [clienta] $ X".
- "Cumpleaños": el cumpleaños de cada clienta (día y mes) → "Cumple [clienta] 🎂".
- "Día de pedido": los días configurados en Configuración. Al tocarlo, muestra la lista de productos para pedir (de la tarea de venta sin stock y día de pedido).
- Cada tipo automático tiene su color, con una referencia de colores debajo del calendario. Los días con eventos muestran puntitos de color y la lista del día muestra todo agrupado.
- El filtro también incluye "Cobros", "Cumpleaños" y "Días de pedido".
- El contador de arriba sigue contando solo las citas cargadas a mano ("3 citas este mes").

3. WhatsApp
- En cada cita con una clienta que tenga celular, y en los eventos "Cobro" y "Cumpleaños", un botón "WhatsApp" que abre el chat con la clienta, sin mensaje armado. Sirve para confirmar la cita, recordar un pago, saludar, etc.
- No hay recordatorios automáticos: solo el botón.

Cómo verifico que quedó bien:
- El filtro y el formulario muestran la misma lista de tipos, y "Crear evento" me deja ponerle nombre.
- Una cuota que vence el 15 aparece ese día como "Cobro".
- El cumpleaños de una clienta aparece en su día todos los años.
- El botón de WhatsApp abre el chat de la clienta.
```

## Menú y navegación

### Prompt 13 · Menú, navegación y sesión

_Puntos: P11, P12 y P26 · Se puede hacer en cualquier momento después del Prompt 0._

```text
Tarea: barra de navegación inferior en el celular, lugar de "Cerrar sesión", ícono de Stock y duración de la sesión (P11, P12 y P26).

Cómo está hoy: en el celular, para cambiar de sección hay que abrir el menú ☰ de arriba. Arriba a la derecha están los íconos de ocultar montos (ojo), modo oscuro (luna) y cerrar sesión, y es fácil tocar "cerrar sesión" sin querer. El menú dice "Clientes" y Stock usa un ícono de cubo.

Cambios:

1. Barra inferior en el celular (pantallas de menos de 768 px)
- Fija abajo, con 5 botones de ícono y texto, en este orden: "Inicio", "Clientas", "Vender", "Stock" y "Más".
- "Vender" va en el centro, más grande, redondo y con el color principal. Abre "Nueva venta".
- El botón de la sección actual se ve resaltado.
- "Más" abre el mismo menú lateral de hoy, con Agenda, Reportes, Configuración, Suscripción y, al final y separado, "Cerrar sesión".
- En el celular se saca el ☰ de arriba (lo reemplaza "Más"). Arriba quedan el logo, el ojo y la luna.
- Dejá espacio abajo en cada pantalla para que la barra no tape contenido, respetando el borde inferior del iPhone. Las ventanas a pantalla completa tapan la barra.

2. "Cerrar sesión" (P11)
- Sacá el ícono de cerrar sesión de la barra de arriba, en todos los tamaños de pantalla.
- En compu y tablet se mantiene el menú lateral, con "Cerrar sesión" al final (arriba de la versión).
- Antes de cerrar la sesión, confirmación: "¿Querés cerrar sesión?", con "Sí, cerrar sesión" y "Cancelar".

3. Ícono de Stock y nombres del menú
- Reemplazá el ícono de cubo de Stock por un labial, con el mismo estilo que los demás íconos: de línea, 24 × 24, trazo 2, puntas redondeadas, sin relleno y con el color del texto. Si la librería de íconos no tiene uno, creá un componente SVG propio. Usalo en el menú lateral, en la barra inferior y donde aparezca Stock.
- "Clientes" pasa a ser "Clientas" en el menú y en cualquier otro lugar.

4. Sesión
- La sesión queda siempre iniciada. Solo se cierra sola si pasan más de 10 días sin entrar a la app: cada vez que entra, el plazo se renueva por 10 días más.
- Revisá cómo está configurada hoy (cookie, token o sesión en el servidor) y adaptala. La cookie tiene que ser segura (httpOnly y secure).
- Si la sesión se cerró por inactividad, la pantalla de ingreso muestra: "Por seguridad cerramos tu sesión porque pasaron más de 10 días sin entrar."

Cómo verifico que quedó bien:
- En un celular de 375 px veo la barra inferior con "Vender" en el centro, y "Más" abre el menú con "Cerrar sesión" al final.
- Arriba ya no está el ícono de cerrar sesión.
- Stock tiene el ícono de labial con el mismo estilo que el resto.
- Cierro el navegador, vuelvo a los 2 días y la sesión sigue iniciada.
```

#### Decisiones tomadas (no están en el texto del prompt, anotadas para que no se pierdan)

- **Menú "Más"**: suma "Ventas" como primera opción (lleva al listado de ventas). Queda, en
  este orden: Ventas, Agenda, Reportes, Configuración, Suscripción y, al final y separado,
  "Cerrar sesión".
- **Panel de administración** (precio de suscripción y cupones, Prompt U): si hoy tiene una
  entrada en el menú, se mantiene igual y visible solo para el rol admin — no es parte de este
  rediseño.
- **Aviso de "cerrada por inactividad"**: en vez de un flag sí/no, se guarda en `localStorage`
  SOLO la fecha del último uso de la app con sesión iniciada (nada identificable). En la
  pantalla de ingreso, el aviso se muestra únicamente si esa fecha tiene más de 10 días — si la
  sesión se perdió por otro motivo (cookies borradas, problema del servidor), nunca se inventa
  el motivo. Al cerrar sesión a propósito, esa fecha se borra. Ver `client/src/lib/sessionActivity.ts`.
- **Teclado virtual**: mientras un campo de texto tiene el foco (y por lo tanto, en celular, el
  teclado está abierto), la barra inferior se oculta por completo — siendo `fixed`, el teclado
  no la empuja y quedaría flotando arriba, tapando lo que se escribe. Ver
  `client/src/hooks/use-virtual-keyboard-open.ts`.
- **"Nueva venta" pasa a una sola instancia compartida**: se creó `SaleDialogProvider`
  (`client/src/hooks/use-sale-dialog.tsx`), montado una sola vez en `AppShell` (no para admin).
  Inicio, la ficha de la clienta, el botón "Nueva Venta" de Ventas, su auto-apertura desde el
  carrito y "Retomar" un borrador ahora abren esa misma instancia en vez de cada uno tener su
  propio diálogo local — el diálogo sobrevive a la navegación entre pantallas (una venta a
  medio hacer ya no se pierde si la consultora cambia de sección). El vaciado del carrito
  compartido al cerrar sigue atado solo a las aperturas que vienen de Ventas (`clearCartOnClose`),
  igual que antes — Inicio y la ficha de clienta nunca tocaban el carrito y siguen sin tocarlo.
- **"Clientes" → "Clientas"**: se revisó todo `client/src` (strings visibles) y los mensajes de
  error del backend que se muestran al frontend, case-insensitive. El único lugar que todavía
  decía "Clientes" era el título del ítem del menú lateral (`AppSidebar.tsx`) — ya corregido a
  "Clientas". El resto de la app (incluyendo los mensajes de error de `server/`) ya estaba en
  femenino de prompts anteriores. No se tocó ninguna ruta, tabla ni nombre de variable.
- **Sesión (10 días, renovación en cada visita)**: implementado con `rolling: true` +
  `maxAge: 10 días` en `server/session.ts` — no requiere ninguna columna, tabla ni variable de
  Railway nueva (la tabla `session` y `trust proxy` ya existen y ya están probados en
  producción), así que no se agregó ninguna entrada en `docs/migracion-deploy-2.md`. Un deploy
  con este cambio desloguea sin aviso a cualquier consultora con una sesión activa en ese
  momento (el formato de la cookie no cambia, pero `maxAge` sí) — no es grave (vuelve a loguear
  normal), pero vale que quien haga el deploy lo sepa de antemano.
- **Test de la cookie de sesión**: `server/tests/session-rolling.test.ts` prueba que el login
  deja una cookie que vence en 10 días y que una request autenticada posterior (`GET
  /api/auth/me`) renueva ese vencimiento (`Set-Cookie` en cada response, no solo en el login).

## Ingreso, registro y suscripción

### Prompt 14 · Ingreso, registro y prueba gratis

_Puntos: P29 y P30 · Hacelo después del Prompt 4 y del prompt urgente._

```text
Tarea: mejorar las pantallas de ingreso y de creación de cuenta, y cambiar la prueba gratis a un límite de 10 productos (P29 y P30).

Cómo está hoy:
- Ingreso: "Usuario", "Contraseña" (sin botón para ver lo que se escribe), botón "Ingresar", "¿Olvidaste tu contraseña?" y abajo un link chico "¿No tenés una cuenta? Registrarse". Texto: "Ingresa tus credenciales de consultora o administrador".
- Registro: "Usuario", "Email", "Contraseña" y el texto "10 días de prueba gratis, sin tarjeta".
- Suscripción: "Tu período de prueba vence el 13/10/2026 (10 días restantes)", precio $ 20.000 ARS / mes y una lista de funciones genéricas ("Gestión administrativa", "Gestión de imágenes", etc.).

Cambios:

1. Pantalla de ingreso
- Campo "Email o WhatsApp": acepta email, número de WhatsApp o, para las cuentas que ya existen, el usuario actual. Ejemplo en gris: "tu@email.com o 261 555 1234".
- "Contraseña" con un botón de ojo para mostrar u ocultar lo que se escribe.
- Botón principal "Iniciar sesión" (reemplaza a "Ingresar").
- Debajo, un segundo botón bien visible, "Crear cuenta" (ancho completo, con borde), en lugar del link chico. En toda la app, "Registrarse" pasa a ser "Crear cuenta".
- Texto de arriba: "Entrá con tu email o tu WhatsApp".
- "¿Olvidaste tu contraseña?" se mantiene.

2. Pantalla "Crear cuenta"
- Campos: "Nombre y apellido", "Email", "WhatsApp", "Contraseña" y "Repetí la contraseña" (las dos con ojo). Si no coinciden: "Las contraseñas no coinciden".
- Sacá el campo "Usuario". Las cuentas que ya tienen usuario siguen pudiendo entrar con él.
- El email y el WhatsApp no se pueden repetir entre cuentas. Guardá el WhatsApp normalizado (código de área + número, sin 0 ni 15).
- Arriba del formulario, tres beneficios con íconos: "Sabé cuánto ganás en cada venta", "Controlá quién te debe y cobrá a tiempo" y "Tu stock al día, con avisos de qué pedir".
- Texto: "Probala gratis con hasta 10 productos. Sin tarjeta."
- Botón "Crear cuenta".
- Los demás datos (ciudad, edad y cargo) se piden después, adentro de la app: agregá en el bloque "Para mejorar tu negocio" de Inicio el aviso "Completá tu perfil", que abre un formulario con "Ciudad", "Edad" y "Tu cargo" (texto libre; por ejemplo, "Consultora" o "Directora"). Agregá también en Configuración un bloque "Tus datos" donde se puedan ver y editar nombre, email, WhatsApp, ciudad, edad y cargo.

3. Prueba gratis (P30)
- Eliminá la prueba por días: las cuentas gratis ya no vencen.
- La prueba gratis permite hasta 10 productos distintos en stock (con unidades). Cada tono cuenta como un producto.
- Al intentar sumar el producto número 11 (desde "Cargar desde el catálogo" o desde "Cargar producto manualmente"), no se suma y aparece: "Llegaste al límite de la prueba gratis (10 productos). Suscribite para cargar todos los que quieras.", con los botones "Ver planes" y "Ahora no". En el catálogo, el cartel aparece al tocar + en un producto nuevo que sería el número 11. Sumar unidades a productos que ya tiene no tiene límite.
- En Stock, para las cuentas gratis, una línea chica: "Prueba gratis: 8 de 10 productos".
- Las cuentas de prueba actuales pasan a esta regla (se les quita la fecha de vencimiento). Si alguna ya tiene más de 10 productos, no se borra nada: solo no puede sumar productos nuevos hasta suscribirse.
- Actualizá todos los textos que hablen de "10 días".

4. Pantalla de Suscripción
- Arriba, para las cuentas gratis: "Estás usando la prueba gratis: podés cargar hasta 10 productos. Tenés 8."
- Se mantienen el precio (el que configura el admin) y el botón "Continuar".
- Respetá el link "¿Tenés un cupón de descuento?" y todo lo que se agregó en la tarea urgente de precio y cupones.
- Reemplazá la lista de funciones por estos beneficios:
  - "Productos ilimitados en tu stock"
  - "Sabé cuánto ganás en cada venta"
  - "Controlá quién te debe y cobrá a tiempo"
  - "Recordatorio de qué pedir en tu día de pedido"
  - "Historial de todos tus meses"
  - "Agenda con citas, cobros y cumpleaños"
  - "WhatsApp de tus clientas a un toque"
- Debajo: "Sin permanencia: cancelás cuando quieras."

Cómo verifico que quedó bien:
- Puedo entrar con email, con WhatsApp y con un usuario viejo.
- Si las contraseñas no coinciden, no me deja crear la cuenta.
- Con una cuenta gratis y 10 productos, al intentar sumar el 11 aparece el cartel.
- Ya no aparece ninguna fecha de vencimiento de la prueba.
```

## Toda la app

### Prompt 15 · Textos y formatos

_Puntos: P26 y P27 · Hacelo después de todos los anteriores, porque abarca toda la app._

```text
Tarea: revisar los textos de toda la app y unificar el formato de montos y fechas (P26 y P27). Esta tarea va después de las demás porque abarca toda la app.

1. Voseo en todos lados
- "Ingresa tus credenciales de consultora o administrador" → "Entrá con tu email o tu WhatsApp".
- "Inicia sesión para continuar" → "Iniciá sesión para continuar".
- Buscá cualquier otro texto con "tú" ("ingresa", "selecciona", "tienes") y pasalo a voseo ("ingresá", "elegí", "tenés").

2. Palabras más simples
- "Clientes" → "Clientas".
- "Agregar al carrito" / "carrito" → "Agregar a la venta" / "la venta".
- "Ticket promedio" → "Compra promedio".
- "Total facturado" → "Vendiste en total".
- "Umbral de stock bajo" → "Aviso de poco stock".
- "KPIs", "credenciales" y "rentabilidad" no tienen que quedar en pantalla.
- "Registrarse" → "Crear cuenta".
- Botones con mayúscula solo en la primera letra: "Nueva venta", "Nueva clienta", "Nueva cita".

3. Singular y plural
- Corregí todos los contadores: "1 venta registrada", "1 unidad", "1 clienta", "1 cita". Usá una función reutilizable.

4. Códigos internos
- No mostrar códigos internos en pantalla. Ejemplo: en un diálogo de producto aparecía "at-play--balsamo-para-labios-at-play-estandar".

5. Montos
- Siempre "$ 20.100" (punto de miles, sin decimales salvo que hagan falta).
- Creá un campo de monto reutilizable que muestre "$ 20.100" mientras se escribe y guarde el número. Usalo en todos los campos de dinero: precio de venta, costo, envíos, objetivo y pagos.
- Los porcentajes aceptan coma o punto decimal.

6. Fechas
- Nada de formato "2026-10-03" en pantalla.
- En listas: "hoy", "ayer", "hace 3 días" (hasta 7 días) y después "3 de oct.".
- En detalles: "3 de octubre de 2026".
- Creá una función reutilizable con formato es-AR.

7. Teléfonos
- Mostralos con espacios para que se lean fácil (261 555 1234).

8. Marca
- No cambies el nombre de la marca: eso se hace en otra tarea.

Cómo verifico que quedó bien:
- Recorro todas las pantallas y no encuentro "tú", "carrito", "KPIs", fechas tipo 2026-10-03 ni "1 ventas".
- Al escribir un precio, se va viendo con formato de pesos.
```

### Prompt 16 · Velocidad de carga

_Punto: P28 · Conviene hacerlo al final, para medir con todo lo nuevo._

```text
Tarea: que las pantallas carguen rápido y sin errores (P28).

Qué encontré:
- Stock tardó entre 4 y 6 segundos en mostrarse, con solo un círculo girando en el centro.
- Al entrar a Inicio, la consola del navegador muestra 4 errores "Failed to load resource: the server responded with a status of 401".

Necesito que:
1. Encuentres de dónde vienen los errores 401 (qué pedidos son y por qué: ¿se piden datos antes de que la sesión esté lista?, ¿falta enviar credenciales?, ¿se llama a algo que esa cuenta no tiene permitido?) y los corrijas.
2. Midas cuánto tarda cada sección (Inicio, Stock, Clientas, Ventas, Agenda y Reportes) y busques las causas: consultas lentas, muchas consultas en cadena, imágenes pesadas o datos que se piden de más.
3. Reemplaces el círculo girando por pantallas de carga con la forma del contenido (tarjetas grises que después se llenan).
4. Guardes en memoria los datos ya cargados, para que volver a una sección sea instantáneo (por ejemplo, con un tiempo de vigencia corto, mostrando lo anterior mientras se actualiza).
5. Optimices Stock: imágenes en tamaño miniatura y con carga diferida, y lista paginada o cargada de a partes si hace falta.
6. Revises la base: índices en las columnas que se usan para filtrar por consultora y en las búsquedas frecuentes.
7. Me pases los tiempos de antes y de después.

Cómo verifico que quedó bien:
- No aparecen errores 401 en la consola al entrar a Inicio.
- Stock se ve en menos de 2 segundos con una conexión normal.
- Al volver a una sección ya visitada, se ve al instante.
```

## Para más adelante (no enviar todavía)

- Mensajes de WhatsApp pre-armados y la sección "Mensajes automáticos" en Configuración (P22). Por ahora los botones solo abren el chat.
- Venta rápida desde Stock: se quita el atajo actual y la pensamos más adelante.
- PDF visual de Reportes para descargar.
- Presentación de bienvenida para quienes entran al link, con un pantallazo de todo lo que pueden hacer con Impulsa.
- Cambio de marca a Impulsa (P8, ya contemplado aparte).
- Zoom en el celular (P9, descartado).
