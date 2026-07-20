-- ============================================================
-- SISTEMA GRIFO — Migración v19: periodo del reporte de consola
-- ============================================================
-- El encabezado de cada reporte trae el periodo que cubre:
--
--   Inicio:    Jueves,  16/07/2026 23:59:30. (Turno 4. Duracion: 23:59:20)
--   Final:     Viernes, 17/07/2026 23:58:50
--   Solicitud: Sábado,  18/07/2026 09:44:16
--
-- Guardarlo añade una validación de naturaleza DISTINTA a la que ya hay.
-- La comprobación aritmética (Σ productos = RSM) responde "¿leí bien los
-- números?". El periodo responde "¿es este el reporte correcto?". Un OCR
-- impecable de la imagen equivocada produce un cuadre perfecto y erróneo,
-- y de ese cuadre salen descuentos al personal.
--
-- `fecha_detectada` es el día que se DEDUCE del periodo; `fecha` sigue
-- siendo el día bajo el que el usuario lo archivó. Que difieran ES la
-- discrepancia: no hace falta una columna extra para marcarla, y así no
-- puede quedar desincronizada con los datos que la originan.
--
--   -- Reportes archivados en un día distinto al que parecen cubrir:
--   SELECT fecha, fecha_detectada, tipo, subido_por, created_at
--   FROM consola_reportes
--   WHERE fecha_detectada IS NOT NULL AND fecha_detectada <> fecha
--     AND deleted_at IS NULL;
--
-- Dos causas posibles, y ambas interesan: o el usuario pegó la imagen que
-- no era, o el OCR leyó mal la fecha. Lo segundo es señal de que hay que
-- mejorar el reconocimiento.

ALTER TABLE consola_reportes
  ADD COLUMN IF NOT EXISTS periodo_inicio  timestamptz,
  ADD COLUMN IF NOT EXISTS periodo_fin     timestamptz,
  ADD COLUMN IF NOT EXISTS solicitud       timestamptz,
  ADD COLUMN IF NOT EXISTS fecha_detectada date;

-- Índice parcial: solo interesan las discrepancias, que son la excepción.
CREATE INDEX IF NOT EXISTS idx_consola_fecha_discrepante
  ON consola_reportes(fecha)
  WHERE fecha_detectada IS NOT NULL AND fecha_detectada <> fecha;

-- ── RPC actualizada (base: migración 018) ─────────────────────
-- Solo cambia el bloque de columnas nuevas; el resto se conserva igual,
-- incluido el guard con COALESCE que arregló la 018.
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
  -- COALESCE: sin sesión el rol es NULL y debe rebotar, no colarse.
  IF COALESCE(get_my_role(), '') NOT IN ('admin_grifo','superadmin') THEN
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
      estado, fuente, editado_manual, subido_por,
      periodo_inicio, periodo_fin, solicitud, fecha_detectada
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
      auth.uid(),
      NULLIF(p->>'periodo_inicio','')::timestamptz,
      NULLIF(p->>'periodo_fin','')::timestamptz,
      NULLIF(p->>'solicitud','')::timestamptz,
      NULLIF(p->>'fecha_detectada','')::date
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
      periodo_inicio         = NULLIF(p->>'periodo_inicio','')::timestamptz,
      periodo_fin            = NULLIF(p->>'periodo_fin','')::timestamptz,
      solicitud              = NULLIF(p->>'solicitud','')::timestamptz,
      fecha_detectada        = NULLIF(p->>'fecha_detectada','')::date,
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

GRANT EXECUTE ON FUNCTION fn_guardar_consola_reporte(jsonb) TO authenticated;
