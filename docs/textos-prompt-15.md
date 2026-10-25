# Prompt 15 — Textos cambiados, agrupados por pantalla

Sacado del diff real de `prompt-15-textos` (commit `03adbf8`). Para cada pantalla, primero los
textos fijos con "antes → después"; después, donde el cambio es de formato (fecha, monto,
teléfono) y no hay un único texto estático que comparar, una línea que explica qué cambió.

## Agenda

- Botón "Nueva Cita" → "Nueva cita".
- Diálogo de cita: título "Nueva Cita"/"Editar Cita" → "Nueva cita"/"Editar cita".
- Encabezado del día seleccionado: `toLocaleDateString("es-MX", ...)` → `"es-AR"` (afecta
  acentos/capitalización del nombre del día y el mes).

## Ventas

- Botón "Nueva Venta" → "Nueva venta".
- "Ajustes del total" → Descuento (%) y Recargo (%): el input simple pasa a `PercentInput`
  (acepta "," y ".", sin separador de miles).
- "Envío que le cobrás ($)" / "Envío que pagás vos ($)" → "Envío que le cobrás" / "Envío que
  pagás vos" (el "$" ya lo muestra el campo nuevo como prefijo fijo, sobra en la etiqueta).
- Precio al agregar un producto a la venta (paso de cantidad): input simple → `MoneyInput`.
- Fecha de la venta / fecha de vencimiento personalizada: `"es-MX"` → `"es-AR"`.
- "Te debe $X — vence el ..." usa ahora el mismo formato corto de fecha que el resto de la app
  (antes tenía su propia llamada a `toLocaleDateString` con `"es-MX"`).
- Teléfono de la clienta en el buscador y en el resumen de "Clienta": sin agrupar → "261 555
  1234" (4 lugares).
- `clientName` que se guarda en la venta cuando no hay nombre cargado: antes guardaba el
  teléfono crudo como respaldo, ahora guarda el teléfono agrupado.

## Clientas

- Botón "Nueva Clienta" → "Nueva clienta"; diálogo "Editar Clienta"/"Nueva Clienta" → "Editar
  clienta"/"Nueva clienta".
- Ficha de la clienta (`ClientDetailSheet`):
  - "Total Comprado" → "Total comprado"
  - "Ticket Promedio" → "Compra promedio" (mismo texto que ya usa Reportes)
  - "Última Compra" → "Última compra"
  - "Primera Compra" → "Primera compra"
  - "Nueva Venta" → "Nueva venta"
  - Fechas del historial (compras, pagos, citas, notas): tenían su propia función local
    `formatShortDate` con `"es-MX"` y siempre con año → ahora usan la fecha de lista
    compartida ("hoy"/"ayer"/"hace N días" y, pasados 7 días, "3 de oct.").
  - Cumpleaños: `"es-MX"` → `"es-AR"`.
  - Campo "Registrar pago": input simple → `MoneyInput`.
- Buscador/combobox de clienta y "Asignar clienta" a una venta: teléfono sin agrupar → "261
  555 1234" (`ClientCard`, `ClientCombobox`, `AssignClientDialog`).

## Stock

- "Cargar producto manualmente" y "Editar producto": el precio pasa de un input de texto a
  `MoneyInput`; el bloque "¿Cuánto te costó?" (costo directo) también.
- `EditProductDialog`, producto de catálogo: se sacó la línea "Código: ..." (podía mostrar un
  slug autogenerado, ver más abajo). El campo "Código (opcional)" de un producto manual queda
  igual — lo escribe la propia consultora, nunca es un slug.
- Aviso de "Tenés poco stock" (`LowStockDialog`): se sacó el código debajo del nombre del
  producto (mismo motivo).
- Vacío de catálogo: "puedes cargar 6 productos de demostración" → "podés cargar...".
- Toast al cargar productos de prueba: "{N} productos de prueba cargados correctamente" → con
  singular correcto en N=1.

## Configuración

- "Objetivo de ventas del mes": input simple → `MoneyInput`.
- "Ingresos Brutos (%)" → "Ingresos brutos (%)"; el input pasa a `PercentInput` (ya aceptaba
  coma o punto a mano, ahora usa el componente compartido).

## Reportes

- Teléfono de una clienta en la lista: sin agrupar → "261 555 1234".
- Rango de fechas del período y nombre del mes de comparación: `"es-MX"` → `"es-AR"`.

## Ingreso (Login)

- Mensaje de error al loguearse mal (contraseña o usuario/WhatsApp/email que no existe):
  "Credenciales inválidas" → "Email, WhatsApp o contraseña incorrectos." (mismo texto para los
  dos casos, a propósito — no cambia qué tan rápido responde cada uno).
- "Iniciar sesión", "Entrá con tu email o tu WhatsApp", "Crear cuenta": sin cambios — ya
  estaban bien del Prompt 14, se confirmó y no se tocaron.

## Panel de administración

- Encabezado: "Panel de Administración" → "Panel de administración".
- Tarjetas del inicio: "Total Consultoras" → "Total consultoras"; "Productos Activos" →
  "Productos activos"; "Consultoras Activas" → "Consultoras activas".
- "Gestión de Consultoras" → "Gestión de consultoras"; "Administra el acceso..." → "Administrá
  el acceso..."; botón "Ir a Consultoras" → "Ir a consultoras".
- "Carga de Catálogo" → "Carga de catálogo"; "Sube el catálogo..." → "Subí el catálogo...";
  botón "Ir a Catálogo" → "Ir a catálogo".

### Consultoras (admin)

- "Gestión de Consultoras" → "Gestión de consultoras" (encabezado de esta pantalla).
- "Administra el acceso y registro..." → "Administrá el acceso y registro...".
- Botón "Crear Nueva Consultora" → "Crear nueva consultora" (y el título del diálogo).
- "No hay consultoras registradas. Crea la primera..." → "...Creá la primera...".
- Botón "Registrar Consultora" → "Registrar consultora".

### Catálogo (admin)

- "Carga Masiva de Productos" → "Carga masiva de productos".
- "Sube el catálogo global..." → "Subí el catálogo global...".
- "Zona de Carga" → "Zona de carga".
- "Arrastra tu archivo aquí" → "Arrastrá tu archivo aquí".
- "o haz clic para seleccionar" → "o hacé clic para seleccionar".
- Botón "Seleccionar Archivo" → "Seleccionar archivo".
- "Formato Esperado" → "Formato esperado".

### Carga de imágenes (admin)

Todos estos textos tenían un plural fijo que se leía mal con 1 — ahora usan singular/plural
correcto:
- "{N} productos en catálogo · {M} ya tienen imagen · {K} imágenes en Storage sin asignar".
- "{N} productos sin imagen no tienen ningún archivo parecido en Storage" (+ el verbo
  "tiene/tienen" según N).
- "{N} archivos seleccionados", "{N} válidos", "{N} inválidos".
- "{N} archivos listos para revisar", "{N} reconocidos", "{N} ambiguos", "{N} inválidos (no se
  van a subir)".
- "{N} productos nuevos", "{N} productos ya tienen imagen".
- "{N} imágenes subidas correctamente · {M} omitidas (ya tenían imagen)".

### Suscripción y cupones (admin)

- El precio de la suscripción y el valor de los cupones pasan de un input de texto a
  `MoneyInput` (en pesos enteros, no centavos — unidad distinta a la del resto de la app) o
  `PercentInput` según el tipo de cupón elegido.
- Se unificó el formato de los montos ya mostrados (precio actual, historial, pagos de Mercado
  Pago, ingresos aprobados): antes cada pantalla tenía su propia función local, con estilos
  distintos entre sí (una incluso se llamaba `formatPrice`, igual que la función global del
  cliente pero sin dividir por 100 — quedaba el riesgo de confundirlas). Ahora las dos pasan
  por el mismo formateador compartido (`formatPesos`).

## Servidor (mensajes que ve la consultora)

- Stock insuficiente al cargar/editar stock: "Stock insuficiente: quedarían {N} unidades" (y
  la variante "para el producto {id}") → "Stock insuficiente de {nombre del producto}:
  quedarían {N} unidad/unidades" — nombra el producto, nunca el id, y el plural es correcto.
- "Delta inválido para el producto {id}..." → "La cantidad de {nombre del producto} tiene que
  ser un entero positivo".
- "El delta de stock no puede ser 0" → "La cantidad no puede ser 0".
- "Producto {id} no encontrado" (6 lugares, ventas y pedidos) → "No encontramos uno de los
  productos de la venta/del pedido" (nunca se pudo resolver un nombre porque el producto no
  existe, así que no hay nombre para mostrar — se sacó el id en vez de inventar uno).
- "El nuevo total no puede ser menor que lo que ya se cobró ({monto crudo})" → mismo mensaje
  con el monto formateado ("$ X.XXX").
- Email de recuperar contraseña: "Nunca compartas este código..." → "Nunca compartás este
  código..." (voseo, texto y HTML).
- `PHONE_ERROR_MESSAGE` (clientas): "El teléfono debe tener exactamente 10 dígitos, sin
  espacios, guiones ni código de país (ej: 2616570560)" → "Escribí el teléfono sin el 0 y sin
  el 15. Por ejemplo: 261 555 1234." (alineado al mismo formato que ya usa el mensaje del
  WhatsApp de la consultora desde el Prompt 9/14 — no es una decisión nueva, era un texto que
  había quedado afuera de esa decisión).

## El "Código" que se sacó de Stock — qué tenía

`product.codigo` es una sola columna de texto en la base, sin ningún campo aparte para "código
oficial de Mary Kay" vs. "identificador interno". Cuando el admin importa el catálogo por
Excel/CSV:
- Si el archivo trae una columna "Código" o "SKU", ese valor se guarda tal cual — podría ser el
  código real de Mary Kay.
- Si el archivo NO trae esa columna, el sistema genera uno solo (`slugify` de sección-línea-
  producto-variante, ej. "at-play--balsamo-para-labios-at-play-estandar") para que el producto
  tenga algún identificador.

La diferencia entre los dos casos (`autoCodigo`, en `ProductManagement.tsx`) solo existe
**durante la importación** — se usa para avisarle al admin cuántas filas no traían código
("N sin código en el archivo — se generó uno automáticamente"), pero nunca se guarda en la
base. Una vez creado el producto, no hay manera de saber si su `codigo` es el real o uno
generado.

Por eso no hay ningún "código oficial" escondido que mostrar en su lugar: la única opción
segura es la que quedó — sacar la línea para productos de catálogo (podía ser cualquiera de los
dos) y dejar el campo editable de los productos manuales (lo escribe la propia consultora,
nunca es un slug).
