-- ============================================================
-- SISTEMA GRIFO — Migración v3: Auditoría de Precios Diarios
-- ============================================================

-- 1. Crear la tabla de registro de auditoría
CREATE TABLE IF NOT EXISTS precios_diarios_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  precios_diarios_id uuid NOT NULL,
  fecha_precio date NOT NULL,
  accion text NOT NULL CHECK (accion IN ('INSERT', 'UPDATE', 'DELETE')),
  
  -- Valores antiguos
  precio_db5_centimos_old bigint,
  precio_regular_centimos_old bigint,
  precio_premium_centimos_old bigint,
  registrado_por_old uuid,
  
  -- Valores nuevos
  precio_db5_centimos_new bigint,
  precio_regular_centimos_new bigint,
  precio_premium_centimos_new bigint,
  registrado_por_new uuid,
  
  -- Usuario y fecha del cambio
  usuario_id uuid, -- Guarda el auth.uid() de la sesión de Supabase
  realizado_en timestamptz DEFAULT now()
);

-- Habilitar RLS en la tabla de log
ALTER TABLE precios_diarios_log ENABLE ROW LEVEL SECURITY;

-- Política de RLS: solo admin_grifo y superadmin pueden ver la auditoría
CREATE POLICY "precios_diarios_log_select" ON precios_diarios_log
  FOR SELECT USING (get_my_role() IN ('admin_grifo', 'superadmin'));

-- 2. Crear la función del trigger
CREATE OR REPLACE FUNCTION fn_log_precios_diarios_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER -- Permite ejecutar con privilegios del creador para saltar RLS al insertar en el log
SET search_path = public
AS $$
DECLARE
  current_user_id uuid;
BEGIN
  -- Obtener el ID del usuario autenticado en Supabase
  current_user_id := auth.uid();
  
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO precios_diarios_log (
      precios_diarios_id, fecha_precio, accion,
      precio_db5_centimos_new, precio_regular_centimos_new, precio_premium_centimos_new, registrado_por_new,
      usuario_id
    ) VALUES (
      NEW.id, NEW.fecha, 'INSERT',
      NEW.precio_db5_centimos, NEW.precio_regular_centimos, NEW.precio_premium_centimos, NEW.registrado_por,
      current_user_id
    );
    RETURN NEW;
    
  ELSIF (TG_OP = 'UPDATE') THEN
    -- Solo registrar si alguno de los valores realmente cambió
    IF (OLD.precio_db5_centimos IS DISTINCT FROM NEW.precio_db5_centimos OR
        OLD.precio_regular_centimos IS DISTINCT FROM NEW.precio_regular_centimos OR
        OLD.precio_premium_centimos IS DISTINCT FROM NEW.precio_premium_centimos OR
        OLD.registrado_por IS DISTINCT FROM NEW.registrado_por) THEN
        
      INSERT INTO precios_diarios_log (
        precios_diarios_id, fecha_precio, accion,
        precio_db5_centimos_old, precio_regular_centimos_old, precio_premium_centimos_old, registrado_por_old,
        precio_db5_centimos_new, precio_regular_centimos_new, precio_premium_centimos_new, registrado_por_new,
        usuario_id
      ) VALUES (
        NEW.id, NEW.fecha, 'UPDATE',
        OLD.precio_db5_centimos, OLD.precio_regular_centimos, OLD.precio_premium_centimos, OLD.registrado_por,
        NEW.precio_db5_centimos, NEW.precio_regular_centimos, NEW.precio_premium_centimos, NEW.registrado_por,
        current_user_id
      );
    END IF;
    RETURN NEW;
    
  ELSIF (TG_OP = 'DELETE') THEN
    INSERT INTO precios_diarios_log (
      precios_diarios_id, fecha_precio, accion,
      precio_db5_centimos_old, precio_regular_centimos_old, precio_premium_centimos_old, registrado_por_old,
      usuario_id
    ) VALUES (
      OLD.id, OLD.fecha, 'DELETE',
      OLD.precio_db5_centimos, OLD.precio_regular_centimos, OLD.precio_premium_centimos, OLD.registrado_por,
      current_user_id
    );
    RETURN OLD;
  END IF;
  
  RETURN NULL;
END;
$$;

-- 3. Crear el Trigger en la tabla precios_diarios
DROP TRIGGER IF EXISTS trg_audit_precios_diarios ON precios_diarios;
CREATE TRIGGER trg_audit_precios_diarios
AFTER INSERT OR UPDATE OR DELETE ON precios_diarios
FOR EACH ROW
EXECUTE FUNCTION fn_log_precios_diarios_changes();
