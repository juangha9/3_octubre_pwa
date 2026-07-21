-- ============================================================
-- SISTEMA GRIFO — Migración v20: Facilito en vivo = fuente oficial del ranking
-- ============================================================
-- Hasta ahora el ranking salía del Excel EVPC (volcado ~diario, latencia ~18h).
-- Se invierte la jerarquía: la fuente oficial pasa a ser FACILITO (la web de
-- OSINERGMIN, base viva, leída por GET), y el Excel queda como RESPALDO
-- automático cuando Facilito falla o viene incompleto.
--
-- Esta migración solo prepara la BD; el cambio de lógica vive en la Edge
-- Function `osinergmin-cron`. El front no cambia cómo consume (sigue leyendo
-- osinergmin_snapshots + osinergmin_top10), solo muestra de qué fuente salió.

-- ── 1. Fuente de cada snapshot ────────────────────────────────
-- Nullable: los snapshots anteriores a esta migración quedan sin fuente y el
-- front los trata como "fuente desconocida" (ni en vivo ni respaldo).
ALTER TABLE osinergmin_snapshots
  ADD COLUMN IF NOT EXISTS fuente text CHECK (fuente IN ('facilito','excel'));

-- ── 2. Config de la fuente en vivo (Facilito) ─────────────────
-- Facilito identifica por ZONA (códigos INEI×10000) y por el CODIGO_OSINERG del
-- establecimiento, NO por RUC. Estos valores estaban hardcodeados en el spike;
-- se sacan a app_config para que el cron y el diagnóstico lean lo mismo y no
-- diverjan. Se conservan osinergmin_url_excel y osinergmin_ruc: los usa el
-- fallback Excel, que sí identifica por RUC.
--
-- Defaults sugeridos (verificados en el spike): Arequipa / Arequipa / Miraflores
-- y GRIFO ALEXMATH (código 21728). ⚠️ CONFIRMAR que la zona INEI es la correcta
-- antes de fiarse del ranking.
INSERT INTO app_config (clave, valor, descripcion) VALUES
  ('osinergmin_facilito_departamento', '40000',
   'Código INEI del departamento en Facilito (×10000). Arequipa = 40000.'),
  ('osinergmin_facilito_provincia', '40100',
   'Código INEI de la provincia en Facilito. Arequipa = 40100.'),
  ('osinergmin_facilito_distrito', '40110',
   'Código INEI del distrito en Facilito. Miraflores (Arequipa) = 40110.'),
  ('osinergmin_codigo_establecimiento', '21728',
   'CODIGO_OSINERG de nuestro establecimiento (identifica "nuestro" grifo en Facilito, que no trae RUC). GRIFO ALEXMATH = 21728.')
ON CONFLICT (clave) DO NOTHING;
