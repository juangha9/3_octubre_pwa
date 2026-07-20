-- ============================================================
-- SISTEMA GRIFO — Migración v18: arreglo del guard de rol en las RPC
-- ============================================================
-- Bug detectado el 2026-07-19 probando la 017 contra el proyecto real.
--
-- El guard estaba escrito así:
--     IF get_my_role() NOT IN ('admin_grifo','superadmin') THEN
--       RAISE EXCEPTION 'No autorizado';
--     END IF;
--
-- Con una petición SIN sesión, get_my_role() devuelve NULL. Y en SQL
-- `NULL NOT IN (...)` no vale FALSE: vale NULL. Un IF con condición NULL
-- NO entra, así que el RAISE nunca se ejecutaba y la función seguía de
-- largo hasta el INSERT. O sea: el guard FALLABA ABIERTO.
--
-- No hubo exposición real porque ninguna de las dos funciones es SECURITY
-- DEFINER, así que el RLS de la tabla sí frenó la escritura (se comprobó:
-- devuelve 42501 "new row violates row-level security policy"). Pero el
-- chequeo explícito no estaba haciendo su trabajo, y depender solo del RLS
-- deja la puerta a que un futuro SECURITY DEFINER lo vuelva explotable.
--
-- Arreglo: comparar contra un valor no nulo, de modo que la ausencia de
-- rol caiga del lado de "no autorizado" (fail-closed).
--
-- ⚠️ fn_guardar_compra arrastra EL MISMO patrón (su versión viva es la de
-- la migración 012, no la 011). NO se toca aquí a propósito: reescribirla
-- desde esta migración obligaría a reproducir su cuerpo completo, y ese
-- cuerpo incluye la lógica de flete por galón. Se arregla por separado,
-- editando la 012 como base. Mismo riesgo real que aquí: ninguno inmediato
-- (RLS la cubre), pero el guard tampoco está haciendo su trabajo.

-- ── fn_guardar_consola_reporte (migración 017) ────────────────
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
