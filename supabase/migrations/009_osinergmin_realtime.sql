-- ============================================================
-- SISTEMA GRIFO — Migración v9: Realtime para OSINERGMIN
-- ============================================================
-- Habilita Supabase Realtime en `osinergmin_snapshots` para que la app reciba
-- un "push" en cuanto el cron inserta un snapshot nuevo o refresca la fecha
-- (UPDATE). Así la pantalla OSINERGMIN se actualiza sola, sin polling ni F5.
--
-- No hace falta habilitar top10: cada cambio de top10 llega junto con un
-- INSERT en snapshots, y el "skip" del cron es un UPDATE de snapshots.
-- Realtime respeta RLS: solo usuarios autenticados (que ya pueden leer la
-- tabla) reciben los eventos.

alter publication supabase_realtime add table osinergmin_snapshots;

-- Para revertir:
--   alter publication supabase_realtime drop table osinergmin_snapshots;
-- Ver tablas con Realtime activo:
--   select * from pg_publication_tables where pubname = 'supabase_realtime';
