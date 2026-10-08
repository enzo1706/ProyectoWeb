# Pruebas: Prompt 11 (Reportes)

Rama `prompt-11-reportes`, montada sobre `staging` (Prompts 4, 5, 6, 7 y 9). No se mergeó a
`staging` todavía.

## Cómo levantarlo

1. `git fetch origin && git checkout prompt-11-reportes`
2. `npm run dev`
3. Entrar con una consultora que tenga ventas cargadas — o usar la cuenta de demo armada para
   esta revisión (ver el mensaje donde se entregó la URL/usuario/contraseña).

## Período y números grandes

- Al entrar, "Este mes" viene elegido y debajo del título aparece el rango en palabras (ej.
  "1 al 8 de octubre").
- Los 5 botones rápidos, en este orden: "Este mes", "El mes pasado", "Últimos 3 meses", "Esta
  semana", "Personalizado". "Personalizado" abre "Desde"/"Hasta" y recalcula todo al elegir las
  dos fechas.
- No quedan botones de "Exportar KPIs", "Comparar con período anterior" (switch) ni
  "Imprimir" en ningún lado de la pantalla.
- "Vendiste": total vendido del período (incluye ventas con cuotas pendientes, no solo lo
  cobrado).
- "Ganaste": ganancia del período. Si alguna venta del período tiene una línea sin costo real
  cargado (estimado), aparece el prefijo **"≈"** delante del monto.
- "Te deben hoy": saldo pendiente a HOY, no depende del período elegido. Al tocarlo, abre
  Clientas con el filtro "Pendiente de pago" ya aplicado.
- Si hay algo vencido, debajo de "Te deben hoy" aparece la línea chica en rojo **"de eso, $ X
  ya venció"** — si no hay nada vencido, esa línea no aparece.
- Debajo de "Vendiste" y "Ganaste", si el período anterior tuvo ventas, una línea con ▲ o ▼ y
  el texto **"vs. mismos días de [mes]"** (períodos en curso: Este mes/Esta semana) o
  **"vs. [mes]"** / "vs. los 3 meses anteriores" / "vs. el período anterior" (períodos
  cerrados). Si el período anterior NO tuvo ninguna venta, esa línea no aparece (nunca "vs.
  $0" ni un porcentaje roto).

## Resumen escrito y Compra promedio

- Si hubo ventas en el período: un párrafo con el total vendido, la cantidad de clientas, el
  producto más vendido, la mejor clienta y la frase **"De cada $ 100 que vendiste, ganaste
  $ N"**.
- Si NO hubo ventas en el período: "Todavía no hay ventas en este período" en vez del párrafo.
- Tarjeta **"Compra promedio por clienta"**, con el texto "Lo que gastó en promedio cada
  clienta en este período" — el monto es ventas CON clienta ÷ cantidad de clientas distintas
  (una venta "Sin clienta" no debería mover este número).

## Productos más vendidos / Mejores clientas / Clientas para recontactar

- "Productos más vendidos": hasta 5, cada uno con posición, nombre, categoría (etiqueta
  chica), unidades y monto, con una barra horizontal proporcional a las unidades. "Ver todos"
  pasa a mostrar hasta 10.
- "Mejores clientas": hasta 5, nombre + cantidad de compras + total. Tocar una fila abre su
  ficha (editar o nueva venta desde ahí redirige a Clientas, no se duplican esos diálogos
  acá).
- "Clientas para recontactar": solo clientas con AL MENOS una compra (las que nunca compraron
  no aparecen), ordenadas de la que hace MENOS tiempo que no compra a la que hace más. Botón
  de WhatsApp en cada una (abre el chat, sin mensaje armado; no aparece si la clienta no tiene
  celular). "Ver todas" abre Clientas con el filtro "Hace tiempo que no compran".

## Qué no cambia (verificado, no se tocó)

- Inicio, Stock y el wizard de "Nueva venta" (que también usa productos más vendidos) siguen
  igual — ningún endpoint que usan se borró ni se les cambió el contrato.

## Si corrés `npm test` y falla algo de timing

`server/tests/auth-anti-enumeration.test.ts` mide milisegundos reales — con la máquina
cargada puede fallar por unos milisegundos de margen, sin ser una regresión real (archivo sin
tocar desde la Etapa 7.1-7.9, muy anterior a todos los Prompts de este documento). Si falla
justo ahí: volvé a correr ese archivo solo antes de preocuparte.

## En un celular de 375 px

- Los 5 botones de período se desplazan de costado sin romper el layout ni desbordar la
  pantalla.
- Los tres números grandes, el resumen, la tarjeta de compra promedio y las tres listas se
  leen completos, sin texto cortado ni botones superpuestos.

## Qué avisar si algo falla

Pantalla, pasos para reproducirlo, y si hay algo en la consola del navegador (F12 → Console)
en rojo.
