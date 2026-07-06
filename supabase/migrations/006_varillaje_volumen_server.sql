-- ============================================================
-- SISTEMA GRIFO — Migración v6: conversión cm→galones en el servidor
-- ============================================================
-- El grifero NO debe conocer la cantidad de galones (es dato de inventario,
-- solo compete al administrador). Por eso:
--   1. La interpolación cm→galones se mueve al servidor (trigger), usando la
--      tabla de aforo. El grifero solo envía la altura en cm.
--   2. Se restringe la lectura de `tanque_aforo` a admin+ (la tabla de aforo
--      permite deducir galones, así que también es sensible).
-- La función es SECURITY DEFINER para que el trigger pueda leer el aforo
-- aunque el grifero no tenga permiso de SELECT sobre esa tabla.

-- ── Interpolación lineal cm → galones ────────────────────────
-- Un tanque horizontal no es lineal, por eso se interpola entre los dos
-- puntos calibrados que rodean la altura medida. Fuera de rango se satura
-- al extremo más cercano. Sin tabla de aforo → 0.
CREATE OR REPLACE FUNCTION fn_aforo_interpolar(p_tanque_id smallint, p_altura_cm numeric)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min RECORD;
  v_max RECORD;
  v_lo  RECORD;
  v_hi  RECORD;
BEGIN
  SELECT altura_cm, volumen_galones INTO v_min
  FROM tanque_aforo WHERE tanque_id = p_tanque_id ORDER BY altura_cm ASC LIMIT 1;
  IF NOT FOUND THEN
    RETURN 0;  -- tanque sin tabla de aforo cargada
  END IF;

  SELECT altura_cm, volumen_galones INTO v_max
  FROM tanque_aforo WHERE tanque_id = p_tanque_id ORDER BY altura_cm DESC LIMIT 1;

  IF p_altura_cm <= v_min.altura_cm THEN RETURN v_min.volumen_galones; END IF;
  IF p_altura_cm >= v_max.altura_cm THEN RETURN v_max.volumen_galones; END IF;

  SELECT altura_cm, volumen_galones INTO v_lo
  FROM tanque_aforo
  WHERE tanque_id = p_tanque_id AND altura_cm <= p_altura_cm
  ORDER BY altura_cm DESC LIMIT 1;

  SELECT altura_cm, volumen_galones INTO v_hi
  FROM tanque_aforo
  WHERE tanque_id = p_tanque_id AND altura_cm >= p_altura_cm
  ORDER BY altura_cm ASC LIMIT 1;

  IF v_lo.altura_cm = v_hi.altura_cm THEN
    RETURN v_lo.volumen_galones;
  END IF;

  RETURN round(
    v_lo.volumen_galones
    + (v_hi.volumen_galones - v_lo.volumen_galones)
      * (p_altura_cm - v_lo.altura_cm) / (v_hi.altura_cm - v_lo.altura_cm)
  , 2);
END;
$$;

-- ── Trigger: rellena volumen_galones desde el aforo ──────────
-- Autoritativo: siempre recalcula desde altura_cm, ignorando cualquier valor
-- que el cliente intente enviar. Toma el snapshot al momento de insertar; si
-- la tabla de aforo cambia después, las lecturas viejas no se alteran.
CREATE OR REPLACE FUNCTION fn_varillaje_set_volumen()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.volumen_galones := fn_aforo_interpolar(NEW.tanque_id, NEW.altura_cm);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_varillaje_volumen ON varillaje_lecturas;
CREATE TRIGGER trg_varillaje_volumen
  BEFORE INSERT OR UPDATE OF altura_cm ON varillaje_lecturas
  FOR EACH ROW EXECUTE FUNCTION fn_varillaje_set_volumen();

-- ── Restringir lectura de la tabla de aforo a admin+ ─────────
-- (antes: cualquier autenticado. El grifero ya no la necesita porque la
-- conversión la hace el trigger, y conocer el aforo revela los galones.)
DROP POLICY IF EXISTS "aforo_select" ON tanque_aforo;
CREATE POLICY "aforo_select" ON tanque_aforo
  FOR SELECT USING (get_my_role() IN ('admin_grifo', 'superadmin'));
