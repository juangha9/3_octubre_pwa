-- ============================================================
-- SISTEMA GRIFO — Migración v12: el flete se cotiza POR GALÓN
-- ============================================================
-- Corrección del modelo de compras: en la hoja real el flete NO es un monto
-- fijo, sino una TARIFA por galón (ej. 0.28 en mayo, 0.25 en junio). El
-- "MONTO FLETE" de la hoja es el total = tarifa × galones. Verificado:
--   3650 gl × 0.28 = 1022.00 ; 4410 gl × 0.25 = 1102.50 (coinciden con la hoja).
--
-- Por eso `compra_fletes.monto_centimos` se reemplaza por `precio_gl`
-- (soles/galón, 4 dec, igual que el precio de compra). El total del flete se
-- calcula en la app: precio_gl × (galones de los productos a los que aplica).
--
-- La tabla está vacía (recién creada en la 011) → el cambio de columna es seguro.

ALTER TABLE compra_fletes DROP COLUMN IF EXISTS monto_centimos;
ALTER TABLE compra_fletes ADD COLUMN IF NOT EXISTS precio_gl numeric(12,4) NOT NULL DEFAULT 0 CHECK (precio_gl >= 0);
ALTER TABLE compra_fletes ALTER COLUMN precio_gl DROP DEFAULT;

-- Rehacer la RPC para insertar la tarifa por galón en vez del monto.
CREATE OR REPLACE FUNCTION fn_guardar_compra(p jsonb)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id    uuid;
  v_linea jsonb;
  v_flete jsonb;
BEGIN
  IF get_my_role() NOT IN ('admin_grifo','superadmin') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  v_id := NULLIF(p->>'id','')::uuid;

  IF v_id IS NULL THEN
    INSERT INTO compras (fecha, proveedor_id, notas, registrado_por)
    VALUES (
      (p->>'fecha')::date,
      NULLIF(p->>'proveedor_id','')::uuid,
      NULLIF(p->>'notas',''),
      auth.uid()
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE compras SET
      fecha        = (p->>'fecha')::date,
      proveedor_id = NULLIF(p->>'proveedor_id','')::uuid,
      notas        = NULLIF(p->>'notas',''),
      updated_at   = now()
    WHERE id = v_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Compra % no encontrada', v_id;
    END IF;
    DELETE FROM compra_lineas WHERE compra_id = v_id;
    DELETE FROM compra_fletes WHERE compra_id = v_id;
  END IF;

  FOR v_linea IN SELECT jsonb_array_elements(COALESCE(p->'lineas','[]'::jsonb))
  LOOP
    INSERT INTO compra_lineas (compra_id, tipo_combustible, galones, precio_gl)
    VALUES (
      v_id,
      v_linea->>'tipo_combustible',
      (v_linea->>'galones')::numeric,
      (v_linea->>'precio_gl')::numeric
    );
  END LOOP;

  FOR v_flete IN SELECT jsonb_array_elements(COALESCE(p->'fletes','[]'::jsonb))
  LOOP
    INSERT INTO compra_fletes (compra_id, transportista, precio_gl, aplica_a, estado_pago, fecha_pago)
    VALUES (
      v_id,
      NULLIF(v_flete->>'transportista',''),
      (v_flete->>'precio_gl')::numeric,
      CASE
        WHEN jsonb_typeof(v_flete->'aplica_a') = 'array'
             AND jsonb_array_length(v_flete->'aplica_a') > 0
        THEN ARRAY(SELECT jsonb_array_elements_text(v_flete->'aplica_a'))
        ELSE NULL
      END,
      COALESCE(NULLIF(v_flete->>'estado_pago',''),'pendiente'),
      NULLIF(v_flete->>'fecha_pago','')::date
    );
  END LOOP;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_guardar_compra(jsonb) TO authenticated;
