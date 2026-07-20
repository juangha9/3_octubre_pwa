-- ============================================================
-- SISTEMA GRIFO — Migración v17: Reportes de consola (Fase 3)
-- ============================================================
-- El admin sube al día siguiente DOS screenshots del controlador de playa:
--   1) REPORTE PRODUCTO consolidado del día  → tipo 'ventas_dia'
--   2) REPORTE STOCK del día                 → tipo 'stock_dia'
--
-- Del primero sale el TOTAL CONSOLA del día, que autocompleta la fila TOTAL
-- de la tabla de cuadre en Ventas (editable; editarlo deja rastro en el log).
-- El segundo por ahora solo se archiva: la comparación contra varillaje llega
-- en la fase 5.
--
-- Decisión (2026-07-19): NO se suben los 4 reportes por turno. La suma de los
-- turnos ya equivale al consolidado, y ese descuadre le interesa al grifero
-- (para que no se le descuente), no al administrador. Por eso no existe el
-- tipo 'ventas_turno' ni una FK a turnos: estos reportes son del DÍA.

-- ── 1. Cabecera: una fila por imagen ──────────────────────────
CREATE TABLE IF NOT EXISTS consola_reportes (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha                  date NOT NULL,
  tipo                   text NOT NULL CHECK (tipo IN ('ventas_dia', 'stock_dia')),

  imagen_path            text,           -- ruta en el bucket 'consola' (webp)
  extraido               jsonb,          -- salida cruda del OCR, como respaldo

  -- Totales de la fila RSM del reporte PRODUCTO (NULL en stock_dia).
  -- RSM no es un producto: es el total, y sirve de auto-validación contra
  -- la suma de las líneas de consola_reporte_productos.
  ventas_total           int,
  volumen_total_gl       numeric(12,3),
  importe_total_centimos bigint,

  -- Σ(productos) = RSM. Si es false, el OCR leyó mal algún dígito y el
  -- valor NO debe autoconfirmarse.
  validacion_ok          bool,

  estado                 text NOT NULL DEFAULT 'pendiente'
                         CHECK (estado IN ('pendiente', 'confirmado')),
  fuente                 text NOT NULL DEFAULT 'ocr_local'
                         CHECK (fuente IN ('ocr_local', 'llm', 'manual')),
  -- true si un humano corrigió el total leído. Dispara alerta al superadmin.
  editado_manual         bool NOT NULL DEFAULT false,

  subido_por             uuid REFERENCES profiles(id),
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now(),
  deleted_at             timestamptz,
  deleted_by             uuid REFERENCES profiles(id)
);

-- Una sola imagen de cada tipo por día. Además de reflejar la regla de la UI
-- (una ranura de ventas + una de stock), permite que el outbox haga UPSERT
-- idempotente sin duplicar si se sube dos veces sin conexión.
CREATE UNIQUE INDEX IF NOT EXISTS uq_consola_reportes_fecha_tipo
  ON consola_reportes(fecha, tipo) WHERE deleted_at IS NULL;

-- Pull incremental del sync local-first (updated_at > última sincronización).
CREATE INDEX IF NOT EXISTS idx_consola_reportes_updated_at
  ON consola_reportes(updated_at);

DROP TRIGGER IF EXISTS trg_consola_reportes_updated_at ON consola_reportes;
CREATE TRIGGER trg_consola_reportes_updated_at
  BEFORE UPDATE ON consola_reportes
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

-- ── 2. Líneas del reporte PRODUCTO ────────────────────────────
-- Se guardan aunque solo necesitemos el total: comprobar que Σ productos =
-- RSM es cómo detectamos que el OCR leyó mal. De este dato salen descuentos
-- al personal, así que la auto-validación vale más que la tabla que ahorra.
CREATE TABLE IF NOT EXISTS consola_reporte_productos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporte_id        uuid NOT NULL REFERENCES consola_reportes(id) ON DELETE CASCADE,
  -- Códigos de la consola ya normalizados: G.PRE→PREMIUM, G.REG→REGULAR
  producto          text NOT NULL CHECK (producto IN ('DB5', 'PREMIUM', 'REGULAR')),
  ventas            int,
  volumen_gl        numeric(12,3),
  importe_centimos  bigint
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_consola_productos_reporte
  ON consola_reporte_productos(reporte_id, producto);

-- ── 3. Líneas del reporte STOCK ───────────────────────────────
-- La consola numera 1=DB5, 2=G.REG, 3=G.PRE. Ese número se mapea al
-- tanques.id de la app al momento de guardar (tanques.id es smallint).
CREATE TABLE IF NOT EXISTS consola_reporte_stock (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporte_id   uuid NOT NULL REFERENCES consola_reportes(id) ON DELETE CASCADE,
  tanque_id    smallint REFERENCES tanques(id),
  tanque_num   smallint NOT NULL,   -- el número tal cual lo imprime la consola
  producto     text,
  inicio_gl    numeric(12,3),
  final_gl     numeric(12,3)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_consola_stock_reporte
  ON consola_reporte_stock(reporte_id, tanque_num);

-- ── 4. Auditoría (mismo patrón que registro_ventas_log) ───────
-- Sin FK: el historial debe sobrevivir a un borrado físico por consola.
CREATE TABLE IF NOT EXISTS consola_reportes_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporte_id    uuid NOT NULL,
  accion        text NOT NULL
                CHECK (accion IN ('INSERT','UPDATE','SOFT_DELETE','RESTORE','DELETE')),
  datos_old     jsonb,
  datos_new     jsonb,
  usuario_id    uuid,
  realizado_en  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consola_log_reporte
  ON consola_reportes_log(reporte_id, realizado_en DESC);

ALTER TABLE consola_reportes_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "consola_log_select" ON consola_reportes_log;
CREATE POLICY "consola_log_select" ON consola_reportes_log
  FOR SELECT USING (get_my_role() IN ('admin_grifo', 'superadmin'));

CREATE OR REPLACE FUNCTION fn_log_consola_reportes_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER -- salta el RLS del log para poder insertarlo
SET search_path = public
AS $$
DECLARE
  v_accion text;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO consola_reportes_log (reporte_id, accion, datos_new, usuario_id)
    VALUES (NEW.id, 'INSERT', to_jsonb(NEW), auth.uid());
    RETURN NEW;

  ELSIF (TG_OP = 'UPDATE') THEN
    IF to_jsonb(OLD) = to_jsonb(NEW) THEN
      RETURN NEW;
    END IF;
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      v_accion := 'SOFT_DELETE';
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      v_accion := 'RESTORE';
    ELSE
      v_accion := 'UPDATE';
    END IF;
    INSERT INTO consola_reportes_log (reporte_id, accion, datos_old, datos_new, usuario_id)
    VALUES (NEW.id, v_accion, to_jsonb(OLD), to_jsonb(NEW), auth.uid());
    RETURN NEW;

  ELSIF (TG_OP = 'DELETE') THEN
    INSERT INTO consola_reportes_log (reporte_id, accion, datos_old, usuario_id)
    VALUES (OLD.id, 'DELETE', to_jsonb(OLD), auth.uid());
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_consola_reportes ON consola_reportes;
CREATE TRIGGER trg_audit_consola_reportes
AFTER INSERT OR UPDATE OR DELETE ON consola_reportes
FOR EACH ROW
EXECUTE FUNCTION fn_log_consola_reportes_changes();

-- ── 5. RLS de las tres tablas ─────────────────────────────────
-- Es back-office: solo administración. Borrado físico, solo superadmin.
ALTER TABLE consola_reportes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE consola_reporte_productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE consola_reporte_stock     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "consola_reportes_select" ON consola_reportes;
CREATE POLICY "consola_reportes_select" ON consola_reportes
  FOR SELECT USING (get_my_role() IN ('admin_grifo', 'superadmin'));

DROP POLICY IF EXISTS "consola_reportes_insert" ON consola_reportes;
CREATE POLICY "consola_reportes_insert" ON consola_reportes
  FOR INSERT WITH CHECK (get_my_role() IN ('admin_grifo', 'superadmin'));

DROP POLICY IF EXISTS "consola_reportes_update" ON consola_reportes;
CREATE POLICY "consola_reportes_update" ON consola_reportes
  FOR UPDATE USING (get_my_role() IN ('admin_grifo', 'superadmin'));

DROP POLICY IF EXISTS "consola_reportes_delete" ON consola_reportes;
CREATE POLICY "consola_reportes_delete" ON consola_reportes
  FOR DELETE USING (get_my_role() = 'superadmin');

-- Las líneas heredan el permiso de su cabecera.
DROP POLICY IF EXISTS "consola_productos_all" ON consola_reporte_productos;
CREATE POLICY "consola_productos_all" ON consola_reporte_productos
  FOR ALL USING (get_my_role() IN ('admin_grifo', 'superadmin'))
  WITH CHECK (get_my_role() IN ('admin_grifo', 'superadmin'));

DROP POLICY IF EXISTS "consola_stock_all" ON consola_reporte_stock;
CREATE POLICY "consola_stock_all" ON consola_reporte_stock
  FOR ALL USING (get_my_role() IN ('admin_grifo', 'superadmin'))
  WITH CHECK (get_my_role() IN ('admin_grifo', 'superadmin'));

-- ── 6. Guardado atómico cabecera + líneas ─────────────────────
-- Mismo patrón que fn_guardar_compra (migración 011): el outbox envía un
-- solo payload y el servidor escribe las tres tablas en una transacción.
-- El id lo genera el cliente (local-first), pero la identidad real es
-- (fecha, tipo): si ya existe un reporte de ese día y tipo, se reemplaza
-- conservando su id, para que subir la imagen dos veces no duplique.
CREATE OR REPLACE FUNCTION fn_guardar_consola_reporte(p jsonb)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id     uuid;
  v_fecha  date;
  v_tipo   text;
  v_linea  jsonb;
BEGIN
  IF get_my_role() NOT IN ('admin_grifo','superadmin') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  v_fecha := (p->>'fecha')::date;
  v_tipo  := p->>'tipo';

  SELECT id INTO v_id
  FROM consola_reportes
  WHERE fecha = v_fecha AND tipo = v_tipo AND deleted_at IS NULL;

  IF v_id IS NULL THEN
    INSERT INTO consola_reportes (
      id, fecha, tipo, imagen_path, extraido, ventas_total,
      volumen_total_gl, importe_total_centimos, validacion_ok,
      estado, fuente, editado_manual, subido_por
    )
    VALUES (
      COALESCE(NULLIF(p->>'id','')::uuid, gen_random_uuid()),
      v_fecha, v_tipo,
      NULLIF(p->>'imagen_path',''),
      p->'extraido',
      NULLIF(p->>'ventas_total','')::int,
      NULLIF(p->>'volumen_total_gl','')::numeric,
      NULLIF(p->>'importe_total_centimos','')::bigint,
      NULLIF(p->>'validacion_ok','')::bool,
      COALESCE(NULLIF(p->>'estado',''), 'pendiente'),
      COALESCE(NULLIF(p->>'fuente',''), 'ocr_local'),
      COALESCE(NULLIF(p->>'editado_manual','')::bool, false),
      auth.uid()
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE consola_reportes SET
      imagen_path            = COALESCE(NULLIF(p->>'imagen_path',''), imagen_path),
      extraido               = COALESCE(p->'extraido', extraido),
      ventas_total           = NULLIF(p->>'ventas_total','')::int,
      volumen_total_gl       = NULLIF(p->>'volumen_total_gl','')::numeric,
      importe_total_centimos = NULLIF(p->>'importe_total_centimos','')::bigint,
      validacion_ok          = NULLIF(p->>'validacion_ok','')::bool,
      estado                 = COALESCE(NULLIF(p->>'estado',''), estado),
      fuente                 = COALESCE(NULLIF(p->>'fuente',''), fuente),
      editado_manual         = COALESCE(NULLIF(p->>'editado_manual','')::bool, editado_manual),
      updated_at             = now()
    WHERE id = v_id;

    -- Las líneas se reescriben completas: son derivadas de la lectura.
    DELETE FROM consola_reporte_productos WHERE reporte_id = v_id;
    DELETE FROM consola_reporte_stock     WHERE reporte_id = v_id;
  END IF;

  FOR v_linea IN SELECT jsonb_array_elements(COALESCE(p->'productos','[]'::jsonb))
  LOOP
    INSERT INTO consola_reporte_productos
      (reporte_id, producto, ventas, volumen_gl, importe_centimos)
    VALUES (
      v_id,
      v_linea->>'producto',
      NULLIF(v_linea->>'ventas','')::int,
      NULLIF(v_linea->>'volumen_gl','')::numeric,
      NULLIF(v_linea->>'importe_centimos','')::bigint
    );
  END LOOP;

  FOR v_linea IN SELECT jsonb_array_elements(COALESCE(p->'stock','[]'::jsonb))
  LOOP
    INSERT INTO consola_reporte_stock
      (reporte_id, tanque_id, tanque_num, producto, inicio_gl, final_gl)
    VALUES (
      v_id,
      NULLIF(v_linea->>'tanque_id','')::smallint,
      (v_linea->>'tanque_num')::smallint,
      NULLIF(v_linea->>'producto',''),
      NULLIF(v_linea->>'inicio_gl','')::numeric,
      NULLIF(v_linea->>'final_gl','')::numeric
    );
  END LOOP;

  RETURN v_id;
END;
$$;

-- ── 7. Bucket de Storage para las imágenes ────────────────────
-- Privado. Las imágenes se convierten a WebP en el navegador antes de subir
-- (~50–200 KB c/u → ~2 imágenes/día caben de sobra en el free tier).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'consola', 'consola', false, 2097152,
  ARRAY['image/webp', 'image/png', 'image/jpeg']
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "consola_storage_select" ON storage.objects;
CREATE POLICY "consola_storage_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'consola' AND get_my_role() IN ('admin_grifo', 'superadmin')
  );

DROP POLICY IF EXISTS "consola_storage_insert" ON storage.objects;
CREATE POLICY "consola_storage_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'consola' AND get_my_role() IN ('admin_grifo', 'superadmin')
  );

DROP POLICY IF EXISTS "consola_storage_update" ON storage.objects;
CREATE POLICY "consola_storage_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'consola' AND get_my_role() IN ('admin_grifo', 'superadmin')
  );

DROP POLICY IF EXISTS "consola_storage_delete" ON storage.objects;
CREATE POLICY "consola_storage_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'consola' AND get_my_role() = 'superadmin'
  );
