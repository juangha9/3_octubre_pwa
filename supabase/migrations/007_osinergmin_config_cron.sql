-- ============================================================
-- SISTEMA GRIFO — Migración v7: config OSINERGMIN + cron diario
-- ============================================================

-- ── Claves de configuración ──────────────────────────────────
-- El grifo se identifica en el Excel por su RUC (único y estable).
INSERT INTO app_config (clave, valor, descripcion) VALUES
  ('osinergmin_url_excel', '',
   'Link de descarga directa (.xlsx) del reporte "Últimos Precios Registrados" de OSINERGMIN.'),
  ('osinergmin_ruc', '',
   'RUC de la estación (11 dígitos). Se usa para encontrar el grifo en el Excel y calcular su ranking por distrito.')
ON CONFLICT (clave) DO NOTHING;


-- La actualización automática (cron HORARIO) se configura en la migración
-- 008_osinergmin_cron_horario.sql, que apunta a la Edge Function `osinergmin-cron`
-- (parseo liviano del lado servidor). La función `osinergmin-update` de aquí solo
-- DESCARGA el Excel para el botón manual (el parseo lo hace el navegador).
