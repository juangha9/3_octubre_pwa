-- ============================================================
-- SISTEMA GRIFO — Migración v10: stock actual (Varillaje → Cotizador)
-- ============================================================
-- Enlaza Varillaje con Compras. El Cotizador necesita el "stock actual" en
-- galones por producto para calcular el espacio libre del tanque; antes se
-- tecleaba a mano. Ahora se deriva del ÚLTIMO varillaje de cada tanque.
--
-- `fn_stock_actual()` devuelve una fila por tanque activo: su lectura más
-- reciente (altura + volumen ya interpolado por el trigger de la v6).
--
-- SEGURIDAD: los galones son dato de inventario y SOLO competen al admin.
-- El grifero jamás debe conocerlos (ver migración 006). Aunque el Cotizador
-- es una pantalla de admin, blindamos también la BD: la función es
-- SECURITY DEFINER pero valida el rol y rechaza a cualquiera que no sea
-- admin_grifo/superadmin. (Reutilizable luego por un agente/bot que pregunte
-- "¿cuánto stock hay?").

CREATE OR REPLACE FUNCTION fn_stock_actual()
RETURNS TABLE (
  tanque_id                smallint,
  tanque_nombre            text,
  tipo_combustible_codigo  text,
  altura_cm                numeric,
  volumen_galones          numeric,
  medido_en                timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_my_role() NOT IN ('admin_grifo', 'superadmin') THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (l.tanque_id)
    l.tanque_id,
    t.nombre,
    t.tipo_combustible_codigo,
    l.altura_cm,
    l.volumen_galones,
    l.created_at
  FROM varillaje_lecturas l
  JOIN tanques t ON t.id = l.tanque_id
  WHERE t.activo = true
  ORDER BY l.tanque_id, l.created_at DESC;  -- la más reciente por tanque
END;
$$;

GRANT EXECUTE ON FUNCTION fn_stock_actual() TO authenticated;

-- Para revertir:
--   DROP FUNCTION IF EXISTS fn_stock_actual();
