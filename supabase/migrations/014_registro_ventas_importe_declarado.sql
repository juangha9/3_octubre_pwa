-- ============================================================
-- SISTEMA GRIFO — Migración v14: importe declarado en ABREVIADO
-- ============================================================
-- La consola del grifo cobra con un precio unitario de MÁS de 2 decimales,
-- mientras que `precios_diarios` guarda 2. Por eso, cuando un crédito se
-- registra en ABREVIADO (solo el total, tomado de la consola) y después se
-- completa en COMPLETO con los galones, `galones × precio` no coincide con el
-- total original: sobran o faltan céntimos.
--
-- Hasta ahora ese total original se PERDÍA: al completar la fila,
-- `importe_centimos` se sobrescribía con `galones × precio` y el sistema ya no
-- tenía contra qué comparar. Esta columna lo conserva.
--
--   importe_centimos            = galones × precio del día (lo que se factura
--                                 al cliente de crédito, que se rige por galones)
--   importe_declarado_centimos  = lo que marcó la consola (NULL si la venta
--                                 nació directamente en COMPLETO)
--
--   VARIACIÓN de la fila  = importe_centimos − importe_declarado_centimos
--   Redondeo del turno    = Σ VARIACIÓN de sus filas
--
-- Ese redondeo es exactamente el que hace calzar `cierres_caja.efectivo_final`,
-- porque `total_consola_centimos` sí trae los importes reales:
--   efectivo = consola − … − Σ importe_centimos + redondeo
--            = consola − … − Σ importe_declarado_centimos          ✔

ALTER TABLE registro_ventas
  ADD COLUMN IF NOT EXISTS importe_declarado_centimos bigint;

COMMENT ON COLUMN registro_ventas.importe_declarado_centimos IS
  'Total declarado al registrar en modo ABREVIADO (viene de la consola, que usa '
  'más de 2 decimales por galón). NULL si la venta se registró directamente en '
  'COMPLETO. NUNCA se sobrescribe al completar la fila con galones: la diferencia '
  'contra importe_centimos es el redondeo a aplicar en el cierre del turno.';

-- ── Backfill ──────────────────────────────────────────────────
-- Los créditos rápidos que siguen sin completar (galones = 0) conservan su
-- importe original: es, por definición, el declarado.
--
-- Los que YA se completaron perdieron el dato de forma irrecuperable (se
-- sobrescribió antes de que existiera esta columna) y quedan en NULL: la app
-- los muestra como "—" en VARIACIÓN, no como cero, para no fingir que calzan.
UPDATE registro_ventas
   SET importe_declarado_centimos = importe_centimos
 WHERE cantidad_galones = 0
   AND importe_declarado_centimos IS NULL;

-- El trigger de auditoría de la migración 013 usa `to_jsonb(NEW)`, así que
-- recoge esta columna sin tocarlo.
