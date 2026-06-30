-- ============================================================
-- SISTEMA GRIFO — Migración completa v1
-- Supabase Dashboard → SQL Editor → New query → Pegar y Run
-- ============================================================


-- ══════════════════════════════════════════════════════════════
-- 0.  FUNCIONES BASE (solo las que no dependen de tablas)
-- ══════════════════════════════════════════════════════════════

-- Actualiza updated_at automáticamente en cualquier tabla que lo tenga.
CREATE OR REPLACE FUNCTION fn_update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- NOTA: get_my_role() se define en la Sección 2, DESPUÉS de crear
-- la tabla profiles. LANGUAGE sql valida las tablas al momento de
-- creación, por eso no puede ir aquí arriba.


-- ══════════════════════════════════════════════════════════════
-- 1.  TABLAS  (orden: sin FK → con FK)
-- ══════════════════════════════════════════════════════════════

-- ── app_config ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_config (
  clave        text PRIMARY KEY,
  valor        text NOT NULL,
  descripcion  text,
  updated_at   timestamptz DEFAULT now()
);

-- ── profiles ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre     text NOT NULL,
  rol        text NOT NULL CHECK (rol IN ('grifero', 'admin_grifo', 'superadmin')),
  activo     bool DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- get_my_role: debe crearse DESPUÉS de profiles.
-- SECURITY DEFINER evita recursión en las políticas RLS de profiles.
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rol FROM profiles WHERE id = auth.uid();
$$;

-- ── turnos ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS turnos (
  id          smallint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  nombre      text NOT NULL,
  hora_inicio time,
  hora_fin    time,
  activo      bool DEFAULT true
);

-- ── tipos_combustible ────────────────────────────────────────
-- ⚠️  nombre_osinergmin: debe coincidir EXACTAMENTE con el campo
--    PRODUCTO del Excel de OSINERGMIN. No cambiar sin coordinar
--    con el job de precios.
CREATE TABLE IF NOT EXISTS tipos_combustible (
  codigo             text PRIMARY KEY,
  nombre             text NOT NULL,
  nombre_osinergmin  text NOT NULL,
  activo             bool DEFAULT true
);

-- ── tanques ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tanques (
  id                       smallint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  nombre                   text NOT NULL,
  tipo_combustible_codigo  text REFERENCES tipos_combustible(codigo),
  capacidad_galones        numeric(10,2),
  activo                   bool DEFAULT true
);

-- ── precios_diarios ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS precios_diarios (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha                    date NOT NULL UNIQUE,
  precio_db5_centimos      bigint NOT NULL,
  precio_regular_centimos  bigint NOT NULL,
  precio_premium_centimos  bigint NOT NULL,
  registrado_por           uuid REFERENCES profiles(id),
  created_at               timestamptz DEFAULT now()
);

-- ── empresas_clientes ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS empresas_clientes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     text NOT NULL,
  ruc        text,
  tipo       text CHECK (tipo IN ('corporativo','licitacion','citv','chevron','credito','particular')),
  contacto   text,
  activo     bool DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- ── proveedores ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proveedores (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     text NOT NULL,
  contacto   text,
  telefono   text,
  activo     bool DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- ── cierres_caja ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cierres_caja (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colaborador_id                  uuid NOT NULL REFERENCES profiles(id),
  turno_id                        smallint NOT NULL REFERENCES turnos(id),
  fecha                           date NOT NULL,
  -- Sección GRIFERO
  efectivo_centimos               bigint DEFAULT 0,
  yape_centimos                   bigint DEFAULT 0,
  openpay_centimos                bigint DEFAULT 0,
  deposito_transferencia_centimos bigint DEFAULT 0,
  serafinado_centimos             bigint DEFAULT 0,  -- prueba / devuelto al tanque
  redondeo_centimos               bigint DEFAULT 0,
  contaminacion_centimos          bigint DEFAULT 0,  -- pérdida real irrecuperable
  total_consola_centimos          bigint,
  diferencia_centimos             bigint,            -- total_consola − (todo lo demás)
  entregado_grifero_centimos      bigint,
  -- Sección ADMIN
  corporacion_centimos            bigint DEFAULT 0,
  licitaciones_centimos           bigint DEFAULT 0,
  particulares_centimos           bigint DEFAULT 0,
  chevron_centimos                bigint DEFAULT 0,
  contabilizado_admin_centimos    bigint,
  ingreso_completado              bool DEFAULT false, -- false=abreviado, true=completo
  notas                           text,
  estado                          text DEFAULT 'borrador'
                                  CHECK (estado IN ('borrador','enviado','revisado')),
  created_at                      timestamptz DEFAULT now(),
  updated_at                      timestamptz DEFAULT now()
);

-- ── cierre_denominaciones ────────────────────────────────────
CREATE TABLE IF NOT EXISTS cierre_denominaciones (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cierre_id             uuid NOT NULL REFERENCES cierres_caja(id) ON DELETE CASCADE,
  tipo                  text NOT NULL CHECK (tipo IN ('moneda','billete')),
  denominacion_centimos integer NOT NULL,
  cantidad              integer DEFAULT 0
);

-- ── cierre_vales ─────────────────────────────────────────────
-- Una fila por línea del modal del grifero (no una fila por tipo).
-- El total por tipo se calcula con SUM en la query.
CREATE TABLE IF NOT EXISTS cierre_vales (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cierre_id      uuid NOT NULL REFERENCES cierres_caja(id) ON DELETE CASCADE,
  tipo_vale      text NOT NULL
                 CHECK (tipo_vale IN ('licitacion','corporacion','citv','chevron','credito')),
  descripcion    text,              -- nombre del cliente, nullable
  monto_centimos bigint NOT NULL,
  orden          smallint DEFAULT 0 -- preserva el orden de ingreso del grifero
);

-- ── registro_ventas ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS registro_ventas (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cierre_id             uuid REFERENCES cierres_caja(id) ON DELETE SET NULL,
  fecha                 date NOT NULL,
  turno_id              smallint NOT NULL REFERENCES turnos(id),
  colaborador_id        uuid NOT NULL REFERENCES profiles(id),
  tipo_documento        text NOT NULL
                        CHECK (tipo_documento IN ('vale','factura','boleta','nota_credito')),
  serie                 text,
  numero                text,
  empresa_id            uuid REFERENCES empresas_clientes(id),
  tipo_atencion         text NOT NULL
                        CHECK (tipo_atencion IN ('corporativo','licitacion','particular','chevron')),
  conductor             text,
  placa                 text,
  dni_conductor         text,
  tipo_combustible      text NOT NULL REFERENCES tipos_combustible(codigo),
  cantidad_galones      numeric(10,3) NOT NULL,
  precio_unit_centimos  bigint NOT NULL,
  importe_centimos      bigint NOT NULL,
  -- Campos de facturación
  empresa_facturacion   text,
  factura_numero        text,
  fecha_facturacion     date,
  estado_pago           text DEFAULT 'pendiente'
                        CHECK (estado_pago IN ('pagado','pendiente')),
  fecha_pago            date,
  created_at            timestamptz DEFAULT now()
  -- VARIACIÓN = (precio_diario − precio_unit) × galones → calculado en UI, no persiste
);

-- ── compras_combustible ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS compras_combustible (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha                   date NOT NULL,
  proveedor_id            uuid REFERENCES proveedores(id),
  tipo_combustible        text NOT NULL REFERENCES tipos_combustible(codigo),
  cantidad_galones        numeric(10,2) NOT NULL,
  precio_compra_centimos  bigint NOT NULL,
  monto_total_centimos    bigint NOT NULL,
  monto_flete_centimos    bigint DEFAULT 0,
  estado_flete            text DEFAULT 'pendiente'
                          CHECK (estado_flete IN ('pagado','pendiente')),
  fecha_pago_flete        date,
  notas                   text,
  created_at              timestamptz DEFAULT now()
);

-- ── osinergmin_snapshots ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS osinergmin_snapshots (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha_consulta          timestamptz DEFAULT now(),
  fecha_datos_excel       date,
  distrito                text,
  total_establecimientos  integer,
  ranking_db5             integer,
  precio_db5_centimos     bigint,
  ranking_regular         integer,
  precio_regular_centimos bigint,
  ranking_premium         integer,
  precio_premium_centimos bigint,
  created_at              timestamptz DEFAULT now()
);

-- ── osinergmin_top10 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS osinergmin_top10 (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id     uuid NOT NULL REFERENCES osinergmin_snapshots(id) ON DELETE CASCADE,
  producto        text NOT NULL CHECK (producto IN ('DB5','REGULAR','PREMIUM')),
  ranking         integer NOT NULL,
  razon_social    text NOT NULL,
  direccion       text,
  precio_centimos bigint NOT NULL,
  es_nuestro      bool DEFAULT false
);


-- ══════════════════════════════════════════════════════════════
-- 2.  TRIGGERS
-- ══════════════════════════════════════════════════════════════

-- Auto-crear perfil cuando se registra un usuario en Auth.
-- El rol se toma de raw_user_meta_data->>'rol' (si se pasa al crear).
-- Si no se pasa, queda como 'grifero' por defecto.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, nombre, rol)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nombre', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'rol', 'grifero')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- updated_at automático en cierres_caja
DROP TRIGGER IF EXISTS trg_cierres_updated_at ON cierres_caja;
CREATE TRIGGER trg_cierres_updated_at
  BEFORE UPDATE ON cierres_caja
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

-- updated_at automático en app_config
DROP TRIGGER IF EXISTS trg_app_config_updated_at ON app_config;
CREATE TRIGGER trg_app_config_updated_at
  BEFORE UPDATE ON app_config
  FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();


-- ══════════════════════════════════════════════════════════════
-- 3.  ÍNDICES
-- ══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_cierres_colaborador  ON cierres_caja(colaborador_id);
CREATE INDEX IF NOT EXISTS idx_cierres_fecha        ON cierres_caja(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_cierres_turno        ON cierres_caja(turno_id);
CREATE INDEX IF NOT EXISTS idx_vales_cierre         ON cierre_vales(cierre_id);
CREATE INDEX IF NOT EXISTS idx_vales_tipo           ON cierre_vales(tipo_vale);
CREATE INDEX IF NOT EXISTS idx_denom_cierre         ON cierre_denominaciones(cierre_id);
CREATE INDEX IF NOT EXISTS idx_regventas_fecha      ON registro_ventas(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_regventas_empresa    ON registro_ventas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_regventas_cierre     ON registro_ventas(cierre_id);
CREATE INDEX IF NOT EXISTS idx_top10_snapshot       ON osinergmin_top10(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_precios_fecha        ON precios_diarios(fecha DESC);


-- ══════════════════════════════════════════════════════════════
-- 4.  ROW LEVEL SECURITY — Habilitar en todas las tablas
-- ══════════════════════════════════════════════════════════════

ALTER TABLE app_config            ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE turnos                ENABLE ROW LEVEL SECURITY;
ALTER TABLE tipos_combustible     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tanques               ENABLE ROW LEVEL SECURITY;
ALTER TABLE precios_diarios       ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresas_clientes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE proveedores           ENABLE ROW LEVEL SECURITY;
ALTER TABLE cierres_caja          ENABLE ROW LEVEL SECURITY;
ALTER TABLE cierre_denominaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE cierre_vales          ENABLE ROW LEVEL SECURITY;
ALTER TABLE registro_ventas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE compras_combustible   ENABLE ROW LEVEL SECURITY;
ALTER TABLE osinergmin_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE osinergmin_top10      ENABLE ROW LEVEL SECURITY;


-- ══════════════════════════════════════════════════════════════
-- 5.  POLÍTICAS RLS
-- Roles: grifero | admin_grifo | superadmin
-- ══════════════════════════════════════════════════════════════

-- ── profiles ────────────────────────────────────────────────
-- Todos ven su propia fila (necesario para useAuth).
-- Admin+ ven todas.
DROP POLICY IF EXISTS "profiles_select" ON profiles;
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT USING (
    auth.uid() = id
    OR get_my_role() IN ('admin_grifo', 'superadmin')
  );

DROP POLICY IF EXISTS "profiles_insert" ON profiles;
CREATE POLICY "profiles_insert" ON profiles
  FOR INSERT WITH CHECK (get_my_role() = 'superadmin');

DROP POLICY IF EXISTS "profiles_update" ON profiles;
CREATE POLICY "profiles_update" ON profiles
  FOR UPDATE USING (
    (get_my_role() = 'admin_grifo' AND rol = 'grifero')
    OR get_my_role() = 'superadmin'
  );

DROP POLICY IF EXISTS "profiles_delete" ON profiles;
CREATE POLICY "profiles_delete" ON profiles
  FOR DELETE USING (get_my_role() = 'superadmin');

-- ── app_config ──────────────────────────────────────────────
-- Grifero: sin acceso. Admin: solo lectura. Superadmin: todo.
DROP POLICY IF EXISTS "app_config_select" ON app_config;
CREATE POLICY "app_config_select" ON app_config
  FOR SELECT USING (get_my_role() IN ('admin_grifo', 'superadmin'));

DROP POLICY IF EXISTS "app_config_write" ON app_config;
CREATE POLICY "app_config_write" ON app_config
  FOR ALL USING (get_my_role() = 'superadmin');

-- ── turnos ──────────────────────────────────────────────────
-- Todos los usuarios autenticados leen. Admin+ escriben.
DROP POLICY IF EXISTS "turnos_select" ON turnos;
CREATE POLICY "turnos_select" ON turnos
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "turnos_write" ON turnos;
CREATE POLICY "turnos_write" ON turnos
  FOR ALL USING (get_my_role() IN ('admin_grifo', 'superadmin'));

-- ── tipos_combustible ────────────────────────────────────────
DROP POLICY IF EXISTS "tcomb_select" ON tipos_combustible;
CREATE POLICY "tcomb_select" ON tipos_combustible
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "tcomb_write" ON tipos_combustible;
CREATE POLICY "tcomb_write" ON tipos_combustible
  FOR ALL USING (get_my_role() IN ('admin_grifo', 'superadmin'));

-- ── tanques ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "tanques_select" ON tanques;
CREATE POLICY "tanques_select" ON tanques
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "tanques_write" ON tanques;
CREATE POLICY "tanques_write" ON tanques
  FOR ALL USING (get_my_role() IN ('admin_grifo', 'superadmin'));

-- ── precios_diarios ──────────────────────────────────────────
DROP POLICY IF EXISTS "precios_select" ON precios_diarios;
CREATE POLICY "precios_select" ON precios_diarios
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "precios_write" ON precios_diarios;
CREATE POLICY "precios_write" ON precios_diarios
  FOR ALL USING (get_my_role() IN ('admin_grifo', 'superadmin'));

-- ── empresas_clientes ────────────────────────────────────────
DROP POLICY IF EXISTS "empresas_select" ON empresas_clientes;
CREATE POLICY "empresas_select" ON empresas_clientes
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "empresas_write" ON empresas_clientes;
CREATE POLICY "empresas_write" ON empresas_clientes
  FOR ALL USING (get_my_role() IN ('admin_grifo', 'superadmin'));

-- ── proveedores ──────────────────────────────────────────────
DROP POLICY IF EXISTS "proveedores_all" ON proveedores;
CREATE POLICY "proveedores_all" ON proveedores
  FOR ALL USING (get_my_role() IN ('admin_grifo', 'superadmin'));

-- ── cierres_caja ─────────────────────────────────────────────
-- Grifero: ve y crea solo los suyos.
-- Admin+: acceso completo (para editar la sección admin).
DROP POLICY IF EXISTS "cierres_select" ON cierres_caja;
CREATE POLICY "cierres_select" ON cierres_caja
  FOR SELECT USING (
    colaborador_id = auth.uid()
    OR get_my_role() IN ('admin_grifo', 'superadmin')
  );

DROP POLICY IF EXISTS "cierres_insert" ON cierres_caja;
CREATE POLICY "cierres_insert" ON cierres_caja
  FOR INSERT WITH CHECK (
    (colaborador_id = auth.uid() AND get_my_role() = 'grifero')
    OR get_my_role() IN ('admin_grifo', 'superadmin')
  );

DROP POLICY IF EXISTS "cierres_update" ON cierres_caja;
CREATE POLICY "cierres_update" ON cierres_caja
  FOR UPDATE USING (get_my_role() IN ('admin_grifo', 'superadmin'));

DROP POLICY IF EXISTS "cierres_delete" ON cierres_caja;
CREATE POLICY "cierres_delete" ON cierres_caja
  FOR DELETE USING (get_my_role() = 'superadmin');

-- ── cierre_denominaciones ────────────────────────────────────
-- Grifero: solo denominaciones de sus propios cierres.
DROP POLICY IF EXISTS "denom_select" ON cierre_denominaciones;
CREATE POLICY "denom_select" ON cierre_denominaciones
  FOR SELECT USING (
    cierre_id IN (SELECT id FROM cierres_caja WHERE colaborador_id = auth.uid())
    OR get_my_role() IN ('admin_grifo', 'superadmin')
  );

DROP POLICY IF EXISTS "denom_write" ON cierre_denominaciones;
CREATE POLICY "denom_write" ON cierre_denominaciones
  FOR ALL USING (
    cierre_id IN (SELECT id FROM cierres_caja WHERE colaborador_id = auth.uid())
    OR get_my_role() IN ('admin_grifo', 'superadmin')
  );

-- ── cierre_vales ─────────────────────────────────────────────
DROP POLICY IF EXISTS "vales_select" ON cierre_vales;
CREATE POLICY "vales_select" ON cierre_vales
  FOR SELECT USING (
    cierre_id IN (SELECT id FROM cierres_caja WHERE colaborador_id = auth.uid())
    OR get_my_role() IN ('admin_grifo', 'superadmin')
  );

DROP POLICY IF EXISTS "vales_write" ON cierre_vales;
CREATE POLICY "vales_write" ON cierre_vales
  FOR ALL USING (
    cierre_id IN (SELECT id FROM cierres_caja WHERE colaborador_id = auth.uid())
    OR get_my_role() IN ('admin_grifo', 'superadmin')
  );

-- ── registro_ventas ──────────────────────────────────────────
-- Grifero no tiene acceso. Solo admin+.
DROP POLICY IF EXISTS "regventas_all" ON registro_ventas;
CREATE POLICY "regventas_all" ON registro_ventas
  FOR ALL USING (get_my_role() IN ('admin_grifo', 'superadmin'));

-- ── compras_combustible ──────────────────────────────────────
DROP POLICY IF EXISTS "compras_all" ON compras_combustible;
CREATE POLICY "compras_all" ON compras_combustible
  FOR ALL USING (get_my_role() IN ('admin_grifo', 'superadmin'));

-- ── osinergmin_snapshots ─────────────────────────────────────
DROP POLICY IF EXISTS "osiner_snap_select" ON osinergmin_snapshots;
CREATE POLICY "osiner_snap_select" ON osinergmin_snapshots
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "osiner_snap_write" ON osinergmin_snapshots;
CREATE POLICY "osiner_snap_write" ON osinergmin_snapshots
  FOR ALL USING (get_my_role() = 'superadmin');

-- ── osinergmin_top10 ─────────────────────────────────────────
DROP POLICY IF EXISTS "osiner_top10_select" ON osinergmin_top10;
CREATE POLICY "osiner_top10_select" ON osinergmin_top10
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "osiner_top10_write" ON osinergmin_top10;
CREATE POLICY "osiner_top10_write" ON osinergmin_top10
  FOR ALL USING (get_my_role() = 'superadmin');


-- ══════════════════════════════════════════════════════════════
-- 6.  DATOS SEMILLA
-- ══════════════════════════════════════════════════════════════

-- app_config
INSERT INTO app_config (clave, valor, descripcion) VALUES
  ('osinergmin_nombre_grifo',  'ALEXMATH',
   'Nombre del establecimiento en el Excel OSINERGMIN (campo RAZON). El job lo usa para encontrar el distrito y el ranking.'),
  ('nombre_grifo_display',     'Estación de Servicio ALEXMATH',
   'Nombre mostrado en la interfaz y reportes.'),
  ('igv_porcentaje',           '18',
   'Porcentaje de IGV aplicado en ventas con factura.'),
  ('moneda',                   'PEN',
   'Código ISO de moneda del sistema.')
ON CONFLICT (clave) DO NOTHING;

-- turnos (solo insertar si la tabla está vacía)
INSERT INTO turnos (nombre, hora_inicio, hora_fin)
SELECT nombre, hora_inicio::time, hora_fin::time
FROM (VALUES
  ('Turno Mañana', '06:00', '14:00'),
  ('Turno Tarde',  '14:00', '22:00'),
  ('Turno Noche',  '22:00', '06:00')
) AS t(nombre, hora_inicio, hora_fin)
WHERE NOT EXISTS (SELECT 1 FROM turnos LIMIT 1);

-- tipos_combustible
-- ⚠️  nombre_osinergmin: texto EXACTO del campo PRODUCTO en el Excel.
INSERT INTO tipos_combustible (codigo, nombre, nombre_osinergmin) VALUES
  ('DB5',     'Diesel B5',       'Diesel B5 S-50 UV'),
  ('REGULAR', 'Gasohol Regular', 'GASOHOL REGULAR'),
  ('PREMIUM', 'Gasohol Premium', 'GASOHOL PREMIUM')
ON CONFLICT (codigo) DO NOTHING;

-- tanques (ejemplo — ajustar capacidades según el grifo real)
INSERT INTO tanques (nombre, tipo_combustible_codigo, capacidad_galones)
SELECT nombre, codigo, capacidad
FROM (VALUES
  ('Tanque 1 — Diesel',   'DB5',     5000.00),
  ('Tanque 2 — Regular',  'REGULAR', 3000.00),
  ('Tanque 3 — Premium',  'PREMIUM', 3000.00)
) AS t(nombre, codigo, capacidad)
WHERE NOT EXISTS (SELECT 1 FROM tanques LIMIT 1);


-- ══════════════════════════════════════════════════════════════
-- 7.  CREACIÓN DE USUARIOS
--
-- Los usuarios se crean en:
--   Supabase Dashboard → Authentication → Users → Add user
--
-- Después de crear cada usuario, ejecuta el bloque de abajo
-- reemplazando el email por el que usaste.
-- ══════════════════════════════════════════════════════════════

-- Asignar rol 'admin_grifo' (reemplaza el email)
-- UPDATE profiles
-- SET rol = 'admin_grifo', nombre = 'Administrador Grifo'
-- WHERE id = (SELECT id FROM auth.users WHERE email = 'admin@tudominio.com');

-- Asignar rol 'superadmin' (reemplaza el email)
-- UPDATE profiles
-- SET rol = 'superadmin', nombre = 'Superadmin'
-- WHERE id = (SELECT id FROM auth.users WHERE email = 'tu@email.com');

-- Verificar que todo quedó correcto:
-- SELECT p.nombre, p.rol, p.activo, u.email
-- FROM profiles p
-- JOIN auth.users u ON u.id = p.id
-- ORDER BY p.rol;
