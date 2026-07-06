-- ============================================================
-- SISTEMA GRIFO — Migración v4: DSCTO VALES editable
-- ============================================================
-- La columna "DSCTOS VALES" de Control de Ventas (Admin) se
-- mostraba de solo lectura, calculada al vuelo como SUM(cierre_vales).
-- Se agrega una columna directa en cierres_caja (igual que
-- yape_centimos, openpay_centimos, etc.) para que sea editable
-- desde el panel de Admin sin tocar los vales individuales del
-- grifero. El grifero sigue guardando el detalle en cierre_vales,
-- pero ahora también escribe el total en esta columna al cerrar caja.

ALTER TABLE cierres_caja
  ADD COLUMN IF NOT EXISTS dscto_vales_centimos bigint NOT NULL DEFAULT 0;

-- Backfill: para los cierres ya existentes, parte de la suma de los
-- vales ya registrados (evita perder el historial previo a esta migración).
UPDATE cierres_caja c
SET dscto_vales_centimos = v.total
FROM (
  SELECT cierre_id, SUM(monto_centimos) AS total
  FROM cierre_vales
  GROUP BY cierre_id
) v
WHERE v.cierre_id = c.id
  AND c.dscto_vales_centimos = 0;
