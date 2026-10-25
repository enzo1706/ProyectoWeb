# Pruebas: Paquete 1 (Prompt urgente, Prompts 1, 2 y 3)

Rama `deploy-paquete-1` (= `main` local al momento de este checklist), pensado para correrse
contra el dominio de staging cuando publique esa rama (Ronda 1 de
`docs/LEEME-proximos-pasos.md`), nunca `localhost` para la parte de Mercado Pago (necesita
HTTPS real para el checkout, aunque sea con credenciales de prueba).

## Cómo levantarlo

1. `git fetch origin && git checkout deploy-paquete-1` (o entrar directo al dominio de
   staging si ya está publicando esta rama).
2. Entrar como admin para la parte de precio y cupones; como consultora para el resto.

## Precio y cupones (perfil de administrador)

- **Precio**: "Suscripción y cupones" → pestaña "Precio" muestra el precio mensual vigente;
  cambiarlo y guardar — la pantalla de Suscripción de una consultora tiene que mostrar el
  precio nuevo sin reiniciar nada ni tocar código. Al cambiarlo, confirmar las dos opciones
  ("Solo a las nuevas suscripciones" / "También a las actuales, desde una fecha") y que el
  historial de cambios de precio queda registrado debajo (fecha, precio anterior, precio nuevo,
  a quiénes se aplicó).
- **Cupones**: crear un cupón (ej. `CONSULTORA123`, 50%, límite de 5 usos) — aparece en la
  lista con "0 de 5" y estado "Activo". El código se guarda en mayúsculas sin importar cómo se
  escribió. Desactivar un cupón y confirmar que ya no se puede aplicar. Un cupón con usos no se
  puede borrar, solo desactivar.

## Suscripción con cupón (modo de prueba de Mercado Pago)

- Con una cuenta de consultora sin suscripción activa: en Suscripción, abrir "¿Tenés un cupón
  de descuento?", aplicar `CONSULTORA123` — el precio aparece tachado con el precio con
  descuento al lado y la explicación de la duración (ej. "Pagás $ X por mes durante N meses.
  Después, $ Y.").
- Probar un cupón inválido (que no existe, vencido, desactivado, con el límite de usos
  agotado, o ya usado por esa misma cuenta) — cada caso muestra su mensaje específico, nunca uno
  genérico.
- Tocar "Continuar" con el cupón aplicado: el checkout de Mercado Pago (credenciales **TEST**,
  nunca las reales — ver `docs/staging.md`) tiene que cobrar el precio CON descuento, no el
  precio de lista. Pagar con la tarjeta de prueba y el nombre `APRO` en el titular (aprobado) —
  confirmar que la suscripción queda activa y el cupón sube a "1 de 5". Probar también un pago
  rechazado con `OTHE` — el cupón NO debe consumir el uso en ese caso.
- Con la suscripción ya activa, la pantalla muestra el descuento vigente ("Tenés un 50% de
  descuento hasta el [fecha]" o "para siempre", según la duración elegida).

## Configuración

- **Días de pedido**: guardar 1 día, después agregar un segundo con "+ Agregar otro día",
  confirmar que no deja elegir el mismo día dos veces, y que se puede quitar uno con el ícono de
  tacho. Elegir el día 31 en un mes de 30 días — el aviso explica que se corre al último día del
  mes.
- **Objetivo del mes**: guardar un monto con formato de pesos mientras se escribe (ej. "$
  200.000").
- **Ingresos Brutos (%)**: aceptar tanto `3,5` como `3.5`, rechazar fuera del rango 0-20. Campo
  opcional: dejarlo vacío no rompe nada.
- El campo "Moneda" ya no aparece en ningún lado de la pantalla.
- "Tu descuento de compra habitual" se ve como solo lectura, con el porcentaje calculado (no
  editable a mano).

## Costo y ganancia en una venta nueva

- Vender un producto SIN costo cargado (por ejemplo, uno agregado "Sin descuento"): la ganancia
  se muestra con el prefijo **"≈"** (ganancia estimada), nunca "$ 0" por falta de costo.
- Con Ingresos Brutos configurado al 3%, confirmar una venta de $ 20.000 con costo $ 12.000 y
  sin envío — la ganancia mostrada tiene que ser $ 7.400 (total − costo − IIBB, sin envío).
- Esa venta, una vez confirmada, no cambia su ganancia aunque después entre un pedido nuevo que
  modifique el costo promedio del producto (el costo queda congelado en el renglón de la
  venta).

## Carga de un pedido

- Confirmar un pedido desde "Cargar desde el catálogo" eligiendo un descuento (35, 40 o 45%) —
  el costo del producto se actualiza como promedio ponderado entre lo que ya había en stock y lo
  nuevo (ej.: 2 unidades a $ 14.960 + 3 unidades a $ 16.320 → costo final $ 15.776).
- Si el producto no tenía costo o tenía 0 unidades antes del pedido, el costo nuevo pasa a ser
  directamente el de esta compra (sin promediar con nada viejo).
- Vender el producto después del pedido usa el costo ya actualizado, visible en Stock.

## Qué no cambia (verificado, no se tocó)

- El flujo de pago normal sin cupón (Mercado Pago a precio de lista) sigue funcionando igual.
- Las ventas viejas (de antes de este paquete) no se recalculan solas — si tenían costo = precio
  de venta, siguen así hasta que corra la migración de datos explícita del Prompt 2 (ver
  `docs/migracion-produccion-pendiente.md`), que es aparte de este checklist.

## Qué avisar si algo falla

Pantalla, pasos para reproducirlo, y si hay algo en la consola del navegador (F12 → Console) en
rojo — mismo criterio que el resto de los checklists de este proyecto.
