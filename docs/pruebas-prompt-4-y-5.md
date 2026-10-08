# Pruebas: Prompt 4 (Stock) + Prompt 5 (Cargar desde el catálogo)

Esta rama (`prompt-5-catalogo`) incluye el Prompt 4 completo (backend + frontend) y el
Prompt 5 completo, uno arriba del otro — se prueban juntos porque el Prompt 5 depende del
agrupamiento por tono que armó el Prompt 4 en Stock.

## Cómo levantarlo

1. `git fetch origin`
2. `git checkout prompt-5-catalogo`
3. Variables de entorno: copiá el `.env` que ya tengas, con `DATABASE_URL` apuntando a tu
   Postgres local (no hace falta `TEST_DATABASE_URL` para levantar la app con `npm run dev`).
4. Si no tenés la base local levantada: `npm run db:dev:up` y después `npm run db:push`.
5. `npm run dev` y abrí `http://localhost:5000` (o el puerto que indique la consola).
6. Entrá con una cuenta de consultora de prueba (o creá una). Si el catálogo está vacío, en
   Stock aparece el botón "Cargar catálogo de prueba" — tiene productos con tonos, útil para
   probar el agrupamiento.

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

## En los dos: a 375 px de ancho (celular)

Probar todo lo de arriba también con el DevTools en modo responsive a 375 px (iPhone SE o
similar):
- Ningún nombre de producto se corta con "…".
- El header, la card de valor, los filtros y el dropdown "Agregar" entran sin desbordar.
- El diálogo de "Cargar desde el catálogo" ocupa toda la pantalla y el contador fijo de abajo
  queda visible sin tapar contenido ni quedar tapado por la barra del navegador/teclado.
- Los diálogos chicos (Cambiar cantidad, confirmaciones, Editar producto) se ven completos y
  usables con el teclado del celular abierto.

## Qué avisar si algo falla

Para cada cosa que no coincida con lo de arriba: pantalla, pasos para reproducirlo, y si hay
algo en la consola del navegador (F12 → Console) en rojo.
