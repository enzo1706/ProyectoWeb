# Mercado Pago — Problema con Webhooks TEST de Suscripciones

> **BORRADOR — no enviado a Mercado Pago.** Preparado en la etapa MP-2.2 para revisión antes de abrir el caso.

## Resumen

Tenemos una integración de Suscripciones (Preapproval sin plan asociado) para un único plan mensual de ARS 20.000. Creamos una suscripción TEST real, la autorizamos con una tarjeta de prueba, y Mercado Pago generó un payment aprobado real. Ese payment contiene `external_reference` y `subscription_id` correctos, coincidentes con lo que nuestra integración espera. Sin embargo, **no se generó ni se entregó ningún webhook automático** para ese payment, en dos pruebas independientes. Verificamos, con el simulador oficial de notificaciones, que la misma URL configurada con el mismo secret **sí recibe y procesa correctamente** una notificación cuando Mercado Pago decide enviarla manualmente vía el simulador.

## Cuenta / aplicación

- App: **Marykay**
- Collector TEST ID: `3658069410`
- Payer TEST ID: `3656968412`

(Sin credenciales ni tokens en este documento.)

## Preapproval — Prueba 1

- ID: `fee4bb1ed0074275a723ba99787a64cb`
- Estado: `authorized`

## Payment — Prueba 1

- ID: `180371566336`
- Estado: `approved` / `accredited`
- Monto: ARS 20.000

## Evidencia del payment — Prueba 1

- `external_reference`: `sub-1-6be3737e-6255-4a84-b883-16e7f93b3840`
- `subscription_id` (`point_of_interaction.transaction_data.subscription_id`): `fee4bb1ed0074275a723ba99787a64cb`

## Preapproval — Prueba 2 (independiente)

- ID: `eff26f922cfa4e73b6f7bb71ee151a90`
- Estado: `authorized`

## Payment — Prueba 2

- ID: `180379754262`
- Estado: `approved` / `accredited`
- Monto: ARS 20.000

## Evidencia del payment — Prueba 2

- `external_reference`: `sub-1-d52ea62e-9a64-4658-8cd2-ca7b753830ce`
- `subscription_id`: `eff26f922cfa4e73b6f7bb71ee151a90`

En ambas pruebas, `external_reference` coincide exactamente con el enviado al crear el Preapproval, y `subscription_id` coincide exactamente con el ID del Preapproval.

## Webhook

- URL TEST: URL pública del túnel usado durante la prueba (vigente al momento de las pruebas; se reemplaza por la URL definitiva antes de un uso real).
- Eventos activados en el panel (Modo de prueba): "Planes y suscripciones", "Pagos (legacy)".
- Webhook Secret: configurada (no incluida en este documento).

## Problema observado

- Payment aprobado real, dos veces, en pruebas independientes.
- **0 deliveries automáticos observados** en el panel de Mercado Pago (filtrado por Ambiente = Prueba y Ambiente = Productivo).
- **0 requests recibidos** en nuestro servidor (verificado por logs).
- **0 retries** observados.
- **0 errores de entrega** — no hay ni siquiera un intento fallido registrado, lo cual es distinto de "intentó y falló".

## Evidencia de infraestructura

- URL accesible: DNS resuelve, HTTPS válido.
- POST recibido manualmente: un POST de prueba (payload ficticio, sin firma) llegó correctamente a nuestro servidor y fue rechazado con `401` por falta de firma — comportamiento esperado.
- El simulador oficial de Mercado Pago (evento `payment`, Data ID `180371566336`) llegó correctamente a la misma URL.
- La firma HMAC real generada por el simulador **fue validada correctamente** por nuestro código, usando el mismo Webhook Secret configurado.
- Nuestra lógica de idempotencia reconoció correctamente que ese payment ya estaba procesado.
- Respuesta: `200 OK`.

## Simulador

- Evento: `payment`
- Data ID: `180371566336`
- Resultado: `200 OK`
- Firma: validada correctamente

## Preguntas para Mercado Pago

1. ¿Por qué el payment real aprobado no generó una notificación automática, en dos pruebas independientes?
2. ¿Para Suscripciones TEST se debe esperar el topic `payment`, `subscription_authorized_payment`, o ambos?
3. ¿Hay alguna configuración adicional necesaria para recibir `subscription_authorized_payment`?
4. ¿Existe alguna diferencia entre Webhooks TEST configurados desde "Tus Integraciones" y Webhooks de Suscripciones? La documentación pública no es consistente en este punto (ver más abajo).
5. ¿El pago inmediato generado al autorizar un Preapproval TEST debe disparar Webhook automáticamente?
6. ¿Existe alguna limitación conocida de Webhooks para Suscripciones en TEST?
7. ¿Pueden revisar internamente los logs de notificación usando:
   - Preapproval Prueba 1: `fee4bb1ed0074275a723ba99787a64cb` / Payment: `180371566336`
   - Preapproval Prueba 2: `eff26f922cfa4e73b6f7bb71ee151a90` / Payment: `180379754262`
   y confirmar si Mercado Pago generó el evento en alguno de los dos casos?
8. Si el evento fue generado, ¿por qué no aparece como delivery en el panel?
9. La documentación pública indica, en una página, que la configuración desde "Tus integraciones" **no está disponible** para Suscripciones y que debe usarse "configuración durante la creación del pago" (`notification_url`). Sin embargo, el panel de esta misma app tiene una sección de Webhooks específica con pestañas "Modo de prueba"/"Modo productivo" que sí procesó correctamente una notificación simulada. ¿Cuál es el mecanismo correcto y vigente para Suscripciones sin plan asociado?

## Ya consultado con el asistente "Mago" del panel (sin resolver)

Antes de abrir este ticket, se consultó al asistente conversacional del panel de Developers. Se deja registrado porque una de sus afirmaciones fue **verificada como incorrecta** con evidencia propia, para no repetir ese mismo diagnóstico:

- **Afirmación del asistente:** "no hay tópicos/eventos de Webhooks activados para esa app [...] por eso ves 0 intentos de entrega".
- **Verificado como FALSO:** la app "Marykay" tiene, en Modo de prueba, la URL correcta configurada y los eventos "Planes y suscripciones" y "Pagos (legacy)" tildados desde antes de la Prueba 1, y siguen tildados sin cambios al momento de escribir esto (confirmado por captura de pantalla). Con esa misma configuración, el simulador oficial entregó una notificación con éxito (ver sección "Simulador" arriba). La causa de los 0 intentos automáticos **no es falta de configuración de eventos**.
- **Otra afirmación del asistente, sin verificar:** que en modo prueba las notificaciones automáticas de pagos de prueba **no se envían por diseño**, y que la validación debe hacerse únicamente con el simulador. Se buscó esta afirmación en la documentación oficial y **no se encontró respaldo** — al contrario, la documentación de "Realizar compras de prueba" de Checkout Pro indica textualmente verificar que se estén recibiendo las notificaciones correspondientes a la transacción de prueba, dando por sentado que sí deberían llegar. Se deja como pregunta 10.
- **Lo que el asistente reconoció no poder hacer:** consultar logs internos por ID de payment/preapproval — es exactamente lo que se le pide a soporte en la pregunta 7.

10. ¿Es cierto que, en modo prueba, los pagos de suscripciones aprobados NO generan notificaciones automáticas por diseño, y que la única forma de validar la recepción es con el simulador? Si es así, ¿dónde está documentado? (No se encontró esa aclaración en la documentación pública consultada, y una página oficial de Checkout Pro sugiere lo contrario.)
