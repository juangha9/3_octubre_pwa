-- ============================================================
-- SISTEMA GRIFO — Migración v13: Auditoría + Soft Delete de registro_ventas
-- ============================================================
-- 1) Soft delete: los registros NUNCA se borran físicamente desde la app.
--    "Eliminar" = marcar deleted_at/deleted_by; se pueden restaurar.
-- 2) Auditoría: cada INSERT/UPDATE/SOFT_DELETE/RESTORE/DELETE queda en
--    registro_ventas_log con la foto completa (jsonb) de antes y después,
--    ligada al id único (uuid) que genera Supabase. La UI de Seguimiento
--    muestra este historial al hacer clic en un registro.

-- ── 1. Columnas de soft delete ────────────────────────────────
ALTER TABLE registro_ventas ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE registro_ventas ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES profiles(id);

-- Índice parcial: casi todas las consultas filtran "no eliminados".
CREATE INDEX IF NOT EXISTS idx_regventas_deleted
  ON registro_ventas(deleted_at) WHERE deleted_at IS NOT NULL;

-- ── 2. Tabla de log de auditoría ──────────────────────────────
-- Sin FK a registro_ventas: el historial debe sobrevivir incluso a un
-- borrado físico hecho por consola.
CREATE TABLE IF NOT EXISTS registro_ventas_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registro_id   uuid NOT NULL,
  accion        text NOT NULL
                CHECK (accion IN ('INSERT','UPDATE','SOFT_DELETE','RESTORE','DELETE')),
  datos_old     jsonb,
  datos_new     jsonb,
  usuario_id    uuid,              -- auth.uid() de la sesión que hizo el cambio
  realizado_en  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_regventas_log_registro
  ON registro_ventas_log(registro_id, realizado_en DESC);

ALTER TABLE registro_ventas_log ENABLE ROW LEVEL SECURITY;

-- Solo administración puede LEER el historial. Nadie escribe directo:
-- inserta únicamente el trigger (SECURITY DEFINER).
DROP POLICY IF EXISTS "regventas_log_select" ON registro_ventas_log;
CREATE POLICY "regventas_log_select" ON registro_ventas_log
  FOR SELECT USING (get_my_role() IN ('admin_grifo', 'superadmin'));

-- ── 3. Función + trigger de auditoría ─────────────────────────
CREATE OR REPLACE FUNCTION fn_log_registro_ventas_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER -- salta el RLS del log para poder insertarlo
SET search_path = public
AS $$
DECLARE
  v_accion text;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO registro_ventas_log (registro_id, accion, datos_new, usuario_id)
    VALUES (NEW.id, 'INSERT', to_jsonb(NEW), auth.uid());
    RETURN NEW;

  ELSIF (TG_OP = 'UPDATE') THEN
    -- Sin cambios reales → no ensuciar el historial
    IF to_jsonb(OLD) = to_jsonb(NEW) THEN
      RETURN NEW;
    END IF;
    -- Distinguir soft delete / restauración de una edición normal
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      v_accion := 'SOFT_DELETE';
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      v_accion := 'RESTORE';
    ELSE
      v_accion := 'UPDATE';
    END IF;
    INSERT INTO registro_ventas_log (registro_id, accion, datos_old, datos_new, usuario_id)
    VALUES (NEW.id, v_accion, to_jsonb(OLD), to_jsonb(NEW), auth.uid());
    RETURN NEW;

  ELSIF (TG_OP = 'DELETE') THEN
    -- Borrado físico (solo posible por superadmin/consola): también queda registrado
    INSERT INTO registro_ventas_log (registro_id, accion, datos_old, usuario_id)
    VALUES (OLD.id, 'DELETE', to_jsonb(OLD), auth.uid());
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_registro_ventas ON registro_ventas;
CREATE TRIGGER trg_audit_registro_ventas
AFTER INSERT OR UPDATE OR DELETE ON registro_ventas
FOR EACH ROW
EXECUTE FUNCTION fn_log_registro_ventas_changes();

-- ── 4. Endurecer el borrado físico ────────────────────────────
-- La app ya solo hace soft delete; el DELETE físico queda restringido a
-- superadmin. Se reemplaza la política "FOR ALL" por políticas por operación.
DROP POLICY IF EXISTS "regventas_all" ON registro_ventas;

DROP POLICY IF EXISTS "regventas_select" ON registro_ventas;
CREATE POLICY "regventas_select" ON registro_ventas
  FOR SELECT USING (get_my_role() IN ('admin_grifo', 'superadmin'));

DROP POLICY IF EXISTS "regventas_insert" ON registro_ventas;
CREATE POLICY "regventas_insert" ON registro_ventas
  FOR INSERT WITH CHECK (get_my_role() IN ('admin_grifo', 'superadmin'));

DROP POLICY IF EXISTS "regventas_update" ON registro_ventas;
CREATE POLICY "regventas_update" ON registro_ventas
  FOR UPDATE USING (get_my_role() IN ('admin_grifo', 'superadmin'));

DROP POLICY IF EXISTS "regventas_delete" ON registro_ventas;
CREATE POLICY "regventas_delete" ON registro_ventas
  FOR DELETE USING (get_my_role() = 'superadmin');
