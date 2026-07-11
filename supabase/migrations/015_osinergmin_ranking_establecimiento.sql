-- ============================================================
-- 015 · OSINERGMIN: ranking por ESTABLECIMIENTO y zona completa
-- ============================================================
-- Corrige tres defectos del cálculo del ranking:
--
--  1. El distrito NO identifica una zona por sí solo: hay 36 distritos con
--     nombre repetido en el Excel (MIRAFLORES existe en AREQUIPA y en LIMA).
--     La zona es DEPARTAMENTO + PROVINCIA + DISTRITO → se guardan los tres.
--  2. OSINERGMIN rankea ESTABLECIMIENTOS, no empresas. Un RUC puede tener
--     varios grifos en el mismo distrito (COESTI tiene 2 en Miraflores), y el
--     dedup por RUC los colapsaba: desaparecía un competidor y todos los de
--     abajo subían un puesto. Se guarda `codigo_osinerg` para identificar cada
--     establecimiento.
--  3. El "de N" de las tarjetas debe ser el nº de competidores DE ESE PRODUCTO
--     (13 venden Gasohol Regular aunque el distrito tenga 16 grifos), no el
--     total del distrito → totales por producto.
--
-- Aditiva: no borra nada. Los snapshots anteriores quedan con las columnas
-- nuevas en NULL (la app cae al total del distrito cuando falta el del
-- producto); su ranking se calculó con el algoritmo viejo, así que el histórico
-- previo a esta migración puede estar contaminado con grifos de otro
-- departamento homónimo.
-- ============================================================

ALTER TABLE osinergmin_snapshots
  ADD COLUMN IF NOT EXISTS departamento   text,
  ADD COLUMN IF NOT EXISTS provincia      text,
  -- Nº de establecimientos que venden ESE producto en la zona (el "de N").
  ADD COLUMN IF NOT EXISTS total_db5      integer,
  ADD COLUMN IF NOT EXISTS total_regular  integer,
  ADD COLUMN IF NOT EXISTS total_premium  integer;

-- Identificador del establecimiento en el Excel (columna CODIGO_OSINERG).
-- Distingue dos grifos del mismo RUC y hace estable la comparación entre
-- snapshots (el dedup del cron compara top10 contra top10).
ALTER TABLE osinergmin_top10
  ADD COLUMN IF NOT EXISTS codigo_osinerg text;
