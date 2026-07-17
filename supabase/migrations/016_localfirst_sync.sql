-- ============================================================
-- SISTEMA GRIFO — Migración v16: Soporte local-first (Fases 1-2)
-- ============================================================
-- La app pasa a escribir primero en IndexedDB (Dexie) y a sincronizar
-- después contra Supabase mediante una cola (outbox). Para que ese sync
-- sea idempotente y con resolución LWW (last-write-wins) hace falta:
--   1) `updated_at` en registro_ventas y precios_diarios (cierres_caja
--      ya lo tiene desde la v1) → permite pull incremental y LWW.
--   2) UNIQUE (fecha, turno_id) en cierres_caja → el outbox puede hacer
--      UPSERT sin crear cierres duplicados si dos dispositivos guardan
--      el mismo turno sin conexión.
--   3) UNIQUE en precios_diarios(fecha) ya existe desde la v1.

-- ── 1. updated_at + trigger en registro_ventas ────────────────
ALTER TABLE registro_ventas
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Backfill: filas viejas quedan con su created_at como updated_at,
-- para que el pull incremental no las considere "recién cambiadas".
UPDATE registro_ventas SET updated_at = created_at WHERE updated_at IS NULL;

DROP TRIGGER IF EXISTS trg_regventas_updated_at ON registro_ventas;
CREATE TRIGGER trg_regventas_updated_at
  BEFORE UPDATE ON registro_ventas
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

-- Índice para el pull incremental (updated_at > última sincronización).
CREATE INDEX IF NOT EXISTS idx_regventas_updated_at
  ON registro_ventas(updated_at);

-- ── 2. updated_at + trigger en precios_diarios ────────────────
ALTER TABLE precios_diarios
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

UPDATE precios_diarios SET updated_at = created_at WHERE updated_at IS NULL;

DROP TRIGGER IF EXISTS trg_precios_updated_at ON precios_diarios;
CREATE TRIGGER trg_precios_updated_at
  BEFORE UPDATE ON precios_diarios
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

-- ── 3. UNIQUE (fecha, turno_id) en cierres_caja ───────────────
-- La app siempre asumió "un cierre por fecha+turno" (mapa turno→cierre),
-- pero la BD no lo garantizaba. Antes de crear el índice único se
-- eliminan posibles duplicados conservando el más reciente (updated_at).
DELETE FROM cierres_caja c
USING cierres_caja d
WHERE c.fecha = d.fecha
  AND c.turno_id = d.turno_id
  AND c.id <> d.id
  AND (c.updated_at, c.id) < (d.updated_at, d.id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cierres_fecha_turno
  ON cierres_caja(fecha, turno_id);

-- Índice para el pull incremental de cierres.
CREATE INDEX IF NOT EXISTS idx_cierres_updated_at
  ON cierres_caja(updated_at);
