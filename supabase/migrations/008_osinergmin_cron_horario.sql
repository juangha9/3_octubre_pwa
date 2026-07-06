-- ============================================================
-- SISTEMA GRIFO — Migración v8: cron HORARIO de OSINERGMIN
-- ============================================================
-- Programa la Edge Function `osinergmin-cron` para que corra cada hora y
-- mantenga los precios actualizados automáticamente. La función parsea el
-- Excel en el servidor con un lector liviano (sin SheetJS) y solo inserta un
-- snapshot nuevo si el ranking/precio cambió respecto al anterior.
--
-- REQUISITOS: extensiones pg_cron y pg_net (ya disponibles en Supabase).
-- La función se autentica con un secreto propio en el header `x-cron-secret`
-- (el gateway de Supabase transforma el header Authorization con la
-- service_role key, por eso NO se usa esa). Debes:
--   1. Definir el secreto de la función:
--        npx supabase secrets set CRON_SECRET=<TU_SECRETO> --project-ref acvavpzdeichdvsgblcn
--   2. Reemplazar <CRON_SECRET> abajo por ese MISMO valor.
-- Ejecuta este archivo en el SQL Editor.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Evita duplicar el job si se re-ejecuta el script.
select cron.unschedule('osinergmin-horario')
where exists (select 1 from cron.job where jobname = 'osinergmin-horario');

select cron.schedule(
  'osinergmin-horario',
  '0 * * * *',                         -- cada hora, en el minuto 0
  $$
  select net.http_post(
    url     := 'https://acvavpzdeichdvsgblcn.supabase.co/functions/v1/osinergmin-cron',
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'x-cron-secret',  '<CRON_SECRET>'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000     -- 2 min: descarga + parseo del Excel
  );
  $$
);

-- Ver el job / historial de ejecuciones:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;
-- Quitar el job:
--   select cron.unschedule('osinergmin-horario');
