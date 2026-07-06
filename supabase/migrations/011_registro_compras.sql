-- ============================================================
-- SISTEMA GRIFO — Migración v11: Registro de Compras
-- ============================================================
-- Modelo NORMALIZADO cabecera + líneas + fletes (decisión de negocio):
--   compras         — una compra (fecha, proveedor, notas)
--   compra_lineas   — 1..3 productos comprados (galones + precio/gl)
--   compra_fletes   — 0..3 fletes por compra (distintos transportistas),
--                     cada uno pagado/pendiente y a qué productos aplica.
--
-- Precio/gl con 4 decimales (como el Excel `S/.20.6676`): va en soles
-- `numeric(12,4)`, NO en céntimos. Los montos de flete sí en céntimos.
--
-- NOTA: la tabla plana `compras_combustible` (migración 001) queda OBSOLETA
-- y sin uso; este modelo la reemplaza. No se elimina (está vacía e inofensiva);
-- puede borrarse a mano cuando se confirme que nada la referencia.

-- ── compras (cabecera) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS compras (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha          date NOT NULL,
  proveedor_id   uuid REFERENCES proveedores(id),
  notas          text,
  registrado_por uuid REFERENCES profiles(id),
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

-- ── compra_lineas (un producto de la compra) ─────────────────
CREATE TABLE IF NOT EXISTS compra_lineas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compra_id        uuid NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
  tipo_combustible text NOT NULL REFERENCES tipos_combustible(codigo),
  galones          numeric(10,2) NOT NULL CHECK (galones > 0),
  precio_gl        numeric(12,4) NOT NULL CHECK (precio_gl >= 0), -- soles, 4 dec
  UNIQUE (compra_id, tipo_combustible) -- un producto no se repite en la misma compra
);

-- ── compra_fletes (hasta 3 por compra) ───────────────────────
-- `aplica_a`: arreglo de códigos de combustible a los que aplica el flete;
-- NULL o vacío = aplica a todos los productos de la compra.
CREATE TABLE IF NOT EXISTS compra_fletes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compra_id      uuid NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
  transportista  text,
  monto_centimos bigint NOT NULL CHECK (monto_centimos >= 0),
  aplica_a       text[],
  estado_pago    text NOT NULL DEFAULT 'pendiente' CHECK (estado_pago IN ('pagado','pendiente')),
  fecha_pago     date
);

CREATE INDEX IF NOT EXISTS idx_compras_fecha        ON compras(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_compra_lineas_compra ON compra_lineas(compra_id);
CREATE INDEX IF NOT EXISTS idx_compra_fletes_compra ON compra_fletes(compra_id);

-- updated_at automático
DROP TRIGGER IF EXISTS trg_compras_updated_at ON compras;
CREATE TRIGGER trg_compras_updated_at
  BEFORE UPDATE ON compras
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();


-- ══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY — solo admin+ (las compras y sus precios son
-- información sensible de gestión; el grifero no accede).
-- ══════════════════════════════════════════════════════════════
ALTER TABLE compras       ENABLE ROW LEVEL SECURITY;
ALTER TABLE compra_lineas ENABLE ROW LEVEL SECURITY;
ALTER TABLE compra_fletes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "compras_all" ON compras;
CREATE POLICY "compras_all" ON compras
  FOR ALL USING (get_my_role() IN ('admin_grifo','superadmin'));

DROP POLICY IF EXISTS "compra_lineas_all" ON compra_lineas;
CREATE POLICY "compra_lineas_all" ON compra_lineas
  FOR ALL USING (get_my_role() IN ('admin_grifo','superadmin'));

DROP POLICY IF EXISTS "compra_fletes_all" ON compra_fletes;
CREATE POLICY "compra_fletes_all" ON compra_fletes
  FOR ALL USING (get_my_role() IN ('admin_grifo','superadmin'));


-- ══════════════════════════════════════════════════════════════
-- RPC: guardar una compra completa (cabecera + líneas + fletes) de forma
-- ATÓMICA. Evita compras huérfanas si fallara un insert intermedio, y en
-- edición reemplaza líneas/fletes de una sola vez.
--   payload jsonb: { id?, fecha, proveedor_id?, notas?,
--                    lineas:[{tipo_combustible,galones,precio_gl}],
--                    fletes:[{transportista?,monto_centimos,aplica_a?[],
--                             estado_pago,fecha_pago?}] }
-- SECURITY INVOKER (por defecto): las políticas RLS de arriba ya exigen
-- admin+, y además validamos el rol para dar un error claro.
-- ══════════════════════════════════════════════════════════════
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
    INSERT INTO compra_fletes (compra_id, transportista, monto_centimos, aplica_a, estado_pago, fecha_pago)
    VALUES (
      v_id,
      NULLIF(v_flete->>'transportista',''),
      (v_flete->>'monto_centimos')::bigint,
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

-- Para revertir:
--   DROP FUNCTION IF EXISTS fn_guardar_compra(jsonb);
--   DROP TABLE IF EXISTS compra_fletes, compra_lineas, compras CASCADE;
