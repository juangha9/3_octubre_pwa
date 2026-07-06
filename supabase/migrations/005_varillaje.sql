-- ============================================================
-- SISTEMA GRIFO — Migración v5: Módulo Varillaje
-- ============================================================
-- Mide el nivel de combustible en los tanques con una varilla graduada
-- en centímetros. Un tanque horizontal no es lineal (cm ≠ galones
-- proporcional), por eso cada tanque tiene su propia "tabla de aforo"
-- (de fábrica) que convierte cm → galones.
--
-- Dos motivos de medición (columna `tipo`):
--   'cambio_turno'       — al iniciar/cerrar cada turno (turno_id asociado)
--   'control_osinergmin' — control diario obligatorio ~7am por norma OSINERGMIN
--
-- El volumen resultante (ya interpolado, snapshot) alimentará el "stock
-- actual" que usa el Cotizador de Compras — antes se ingresaba a mano.
--
-- Además, `tanques` recibe su posición en la grilla visual (fila/columna)
-- que el superadmin arma en Configuración → Tanques, y que la pantalla de
-- Varillaje del grifero reproduce tal cual (calca de la disposición real).

-- ── tanques: posición en la grilla visual ─────────────────────
ALTER TABLE tanques ADD COLUMN IF NOT EXISTS layout_fila     smallint;
ALTER TABLE tanques ADD COLUMN IF NOT EXISTS layout_columna  smallint;

-- ── tanque_aforo ─────────────────────────────────────────────
-- Tabla de aforo / calibración cm → galones, provista por el fabricante
-- del tanque. Se mantiene desde Configuración → Tanques.
CREATE TABLE IF NOT EXISTS tanque_aforo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tanque_id       smallint NOT NULL REFERENCES tanques(id) ON DELETE CASCADE,
  altura_cm       numeric(6,2) NOT NULL,
  volumen_galones numeric(10,2) NOT NULL,
  UNIQUE (tanque_id, altura_cm)
);

CREATE INDEX IF NOT EXISTS idx_aforo_tanque ON tanque_aforo(tanque_id, altura_cm);

-- ── varillaje_lecturas ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS varillaje_lecturas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tanque_id       smallint NOT NULL REFERENCES tanques(id),
  fecha           date NOT NULL,
  tipo            text NOT NULL CHECK (tipo IN ('cambio_turno', 'control_osinergmin')),
  turno_id        smallint REFERENCES turnos(id),
  colaborador_id  uuid NOT NULL REFERENCES profiles(id),
  altura_cm       numeric(6,2) NOT NULL,
  volumen_galones numeric(10,2) NOT NULL, -- snapshot ya interpolado; no se recalcula si la tabla de aforo cambia después
  notas           text,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_varillaje_tanque_fecha ON varillaje_lecturas(tanque_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_varillaje_fecha         ON varillaje_lecturas(fecha DESC);


-- ══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ══════════════════════════════════════════════════════════════

ALTER TABLE tanque_aforo       ENABLE ROW LEVEL SECURITY;
ALTER TABLE varillaje_lecturas ENABLE ROW LEVEL SECURITY;

-- ── tanque_aforo ─────────────────────────────────────────────
-- Todos los autenticados leen (el grifero la necesita para calcular el
-- volumen en vivo mientras mide); solo admin+ la escribe.
DROP POLICY IF EXISTS "aforo_select" ON tanque_aforo;
CREATE POLICY "aforo_select" ON tanque_aforo
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "aforo_write" ON tanque_aforo;
CREATE POLICY "aforo_write" ON tanque_aforo
  FOR ALL USING (get_my_role() IN ('admin_grifo', 'superadmin'));

-- ── varillaje_lecturas ───────────────────────────────────────
-- Grifero ve todas las lecturas (necesita la última de referencia antes
-- de medir) e inserta solo las suyas; admin+ corrige/elimina.
DROP POLICY IF EXISTS "varillaje_select" ON varillaje_lecturas;
CREATE POLICY "varillaje_select" ON varillaje_lecturas
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "varillaje_insert" ON varillaje_lecturas;
CREATE POLICY "varillaje_insert" ON varillaje_lecturas
  FOR INSERT WITH CHECK (
    (colaborador_id = auth.uid() AND get_my_role() = 'grifero')
    OR get_my_role() IN ('admin_grifo', 'superadmin')
  );

DROP POLICY IF EXISTS "varillaje_update" ON varillaje_lecturas;
CREATE POLICY "varillaje_update" ON varillaje_lecturas
  FOR UPDATE USING (get_my_role() IN ('admin_grifo', 'superadmin'));

DROP POLICY IF EXISTS "varillaje_delete" ON varillaje_lecturas;
CREATE POLICY "varillaje_delete" ON varillaje_lecturas
  FOR DELETE USING (get_my_role() = 'superadmin');
