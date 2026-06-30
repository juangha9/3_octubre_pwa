# Buenas Prácticas — Sistema Grifo (PWA + Supabase + Cloudflare)

> Documento de referencia del proyecto. Define el stack, la arquitectura de
> seguridad, las convenciones de código y el plan de trabajo. **Leer antes de
> empezar cada módulo nuevo.**

Última actualización: 2026-06-29 (rev 3 — distrito MIRAFLORES, ALEXMATH configurable, interfaz admin "Sistema Integrado de Ventas")

---

## 1. Visión general del proyecto

App de gestión para una estación de servicio (grifo) con **dos interfaces**:

1. **Interfaz Grifero** — corre en una computadora en la isla, en **modo kiosco**
   (pantalla completa, sin barra de URL). Velocidad y claridad: botones grandes,
   flujo lineal, cero distracciones. Módulos: Cierre de Caja, Varillaje.
   *Ya existe un prototipo en `Interfaz app para grifero/Sistema Grifero.dc.html`.*
2. **Interfaz Administrador** — panel de control para el dueño/admin. Módulos
   derivados de las hojas Excel actuales:
   - **Ventas Diarias:** resumen por turno y por día (todos los medios de pago +
     ajustes + conciliación faltante/sobrante).
   - **Compras de Combustible:** registro de compras con utilidad/galón calculada.
   - **Comparador de Proveedores:** elegir el mejor precio entre cotizaciones.
   - **Registro Corporativo/Vales:** ventas a empresas con seguimiento de facturación
     y estado de pago (PAGADO / PENDIENTE).
   - **Colaboradores y Turnos.**
   - **Posición OSINERGMIN:** ranking del grifo frente a la competencia en el distrito.
   - **Sistema Integrado de Ventas:** cierre diario en modo ABREVIADO o COMPLETO (ver §10.1).

Tarea automática: **scraping horario al portal OSINERGMIN (PRICE)** — la plataforma
es una tabla web paginada (no un Excel), filtrable por departamento/provincia/
distrito y tipo de combustible. Se hace una consulta por cada uno de los 3
combustibles (Diesel DB5, Gasohol Regular, Premium). El resultado es el **ranking**
(posición en la lista ordenada por precio ascendente) de la estación.

---

## 2. Stack tecnológico

**Regla de oro:** esto es una aplicación **web/PWA**, no software de sistemas.
Por eso **NO se usa C** (C es para sistemas operativos, drivers, microcontroladores).
El lenguaje es **TypeScript** sobre el ecosistema web.

| Capa | Tecnología | Motivo |
|------|-----------|--------|
| Lenguaje | **TypeScript** | JavaScript con tipos → evita errores en cálculos de dinero |
| UI | **React 18** | El prototipo ya usa el patrón `state`/`setState`/componentes |
| Bundler + PWA | **Vite** + `vite-plugin-pwa` | Build rápido, app instalable y offline |
| Estilos | **Tailwind CSS** | Reemplaza los estilos inline gigantes del prototipo |
| Estado servidor | **TanStack Query** (React Query) | Cache y sincronización con Supabase |
| Estado local | Hooks de React (+ **Zustand** si crece) | Simple primero, escalar después |
| Routing | **React Router** | Separar `/grifero` y `/admin` |
| Backend (BaaS) | **Supabase** | Postgres + Auth + Realtime + Storage + Edge Functions |
| Hosting | **Cloudflare Pages** | Conectado a GitHub, deploy automático |
| Seguridad perímetro | **Cloudflare Zero Trust (Access)** | Bloquea accesos no autorizados |
| Tareas programadas | **Supabase Edge Functions + pg_cron** o **Cloudflare Cron Triggers** | Job horario de OSINERGMIN |

### Por qué React y no seguir con el HTML del prototipo
El archivo `.dc.html` viene de una herramienta de diseño (runtime `support.js`,
etiquetas `<x-dc>`). Sirve como **maqueta visual y de comportamiento**, pero no es
mantenible ni conectable a Supabase de forma limpia. El plan es **reescribir esas
pantallas como componentes React** reutilizando la lógica que ya está clara
(denominaciones de monedas/billetes, cálculo de efectivo, diferencia sobra/falta).

---

## 3. Arquitectura de seguridad (4 capas)

```
Usuario ──► [Capa 1: Cloudflare Zero Trust] ──► [Capa 3: PWA Kiosco]
                                                        │
                                                        ▼
                                              [App React en Pages]
                                                        │
                                                        ▼
                                       [Capa 4: Supabase + RLS] ◄── datos
            [Capa 2: sesión 300 días recuerda el dispositivo]
```

- **Capa 1 — Cloudflare Zero Trust (Access):** puerta de entrada. Solo dispositivos
  autorizados / usuarios verificados pasan del login. Configurar una *Access
  Application* sobre el dominio.
- **Capa 2 — Sesiones prolongadas:** la *session duration* de la política Access se
  fija hasta **300 días** para que la PC del grifo no pida login a diario.
- **Capa 3 — PWA + Modo Kiosco:** `manifest.json` con `"display": "fullscreen"` y el
  navegador en modo kiosco (Chrome `--kiosk`). Oculta URL, se siente nativa.
- **Capa 4 — Supabase RLS (Row Level Security):** **siempre activado** en todas las
  tablas. Aunque alguien rompiera las capas anteriores, un grifero solo ve SUS
  cierres/varillajes; nunca datos de otros turnos ni configuración del admin.

> ⚠️ **RLS es obligatorio.** Una tabla sin RLS en Supabase es pública para cualquiera
> con la `anon key`. Activar RLS y escribir políticas explícitas por rol.

---

## 4. Estructura de carpetas propuesta

```
APP_PWA/
├─ BUENAS_PRACTICAS.md          ← este documento
├─ Interfaz app para grifero/   ← prototipo original (referencia, no se edita)
├─ src/
│  ├─ main.tsx
│  ├─ App.tsx                   ← router: /grifero, /admin
│  ├─ lib/
│  │  ├─ supabase.ts            ← cliente Supabase (lee env vars)
│  │  └─ money.ts               ← helpers de dinero (céntimos enteros)
│  ├─ features/
│  │  ├─ grifero/
│  │  │  ├─ CierreCaja/         ← componentes del cierre
│  │  │  └─ Varillaje/
│  │  └─ admin/
│  │     ├─ VentasDiarias/
│  │     ├─ CierresTurno/
│  │     ├─ ComprasCombustible/
│  │     ├─ ComparadorProveedores/
│  │     ├─ RegistroCorporativo/
│  │     ├─ Colaboradores/
│  │     ├─ Osinergmin/
│  │     └─ Configuracion/      ← CRUD de todos los catálogos:
│  │                               turnos, tanques, tipos_combustible,
│  │                               proveedores, empresas_clientes, app_config
│  ├─ components/               ← UI reutilizable (Button, Input, Card)
│  └─ hooks/                    ← useCierre, useAuth, etc.
├─ supabase/
│  ├─ migrations/               ← SQL versionado del esquema
│  └─ functions/                ← Edge Functions (job OSINERGMIN)
├─ public/                      ← manifest.json, íconos PWA
└─ .env.example                 ← NUNCA subir el .env real
```

---

## 5. Base de datos (Supabase) — esquema completo

> El esquema puede aumentar o reducirse según se comporte la app. Estas tablas
> reflejan las hojas Excel de referencia reales del grifo. Siempre agregar
> migraciones en `supabase/migrations/`, nunca editar la BD a mano en producción.

---

### 5.1 Catálogos y configuración

> **Todos los catálogos son editables desde el panel admin → Configuración.**
> No hay datos hardcodeados en el código. El admin gestiona proveedores, turnos,
> tanques y empresas directamente desde la UI sin tocar el código ni la base de datos
> manualmente.

```
-- === 3 ROLES DE USUARIO ===
-- grifero    → interfaz kiosco en PC isla; solo ve sus propios cierres
-- admin_grifo → panel admin del grifo; ve todo el grifo, gestiona griferos
-- superadmin  → el dueño/desarrollador; acceso total, gestiona admin_grifo
--              Solo debe existir UNA cuenta superadmin.

profiles
  id            uuid  PK (= auth.users.id)
  nombre        text  NOT NULL
  rol           text  CHECK rol IN ('grifero','admin_grifo','superadmin')
  activo        bool  DEFAULT true
  created_at    timestamptz DEFAULT now()

turnos                               -- CRUD desde Configuración
  id            smallint PK GENERATED ALWAYS AS IDENTITY
  nombre        text  NOT NULL        -- ej. 'Turno 1', 'Turno Mañana'
  hora_inicio   time
  hora_fin      time
  activo        bool DEFAULT true
  -- Valores iniciales (el admin los edita libremente):
  -- T1: 01:00-09:00 | T2: 05:00-13:00 | T3: 13:00-21:00 | T4: 21:00-05:00

tipos_combustible                    -- CRUD limitado desde Configuración
  codigo        text  PK  ('DB5' | 'REGULAR' | 'PREMIUM')
  nombre        text        ('Diesel B5' | 'Gasohol Regular' | 'Gasohol Premium')
  nombre_osinergmin  text  -- texto EXACTO en columna PRODUCTO del Excel OSINERGMIN
  activo        bool DEFAULT true
  -- ⚠️ AVISO: nombre_osinergmin es crítico para el job horario.
  --    Si se cambia incorrectamente, el ranking deja de encontrar datos.
  --    La UI debe advertir esto al editarlo.
  -- DB5: 'Diesel B5 S-50 UV' | REGULAR: 'GASOHOL REGULAR' | PREMIUM: 'GASOHOL PREMIUM'

tanques                              -- CRUD desde Configuración
  id            smallint PK GENERATED ALWAYS AS IDENTITY
  nombre        text  NOT NULL        -- ej. 'Tanque Diesel 1', 'Tanque Regular A'
  tipo_combustible_codigo  text  FK → tipos_combustible
  capacidad_galones        numeric(10,2)
  activo        bool DEFAULT true
  -- Valores iniciales (editables): Diesel 1250 GL | Regular 3750 GL | Premium 3750 GL

app_config                           -- tabla de configuración editable por admin
  clave         text  PK             -- ej. 'osinergmin_nombre_grifo'
  valor         text  NOT NULL
  descripcion   text
  updated_at    timestamptz DEFAULT now()
  -- RLS: solo admin puede escribir; Edge Functions usan service_role para leer

-- Valores iniciales de app_config:
--   'osinergmin_nombre_grifo' → 'ALEXMATH'
--     El job busca este texto en la columna RAZON del Excel para encontrar el
--     establecimiento propio → extrae su DISTRITO automáticamente del mismo registro.
--     No hay distrito hardcodeado. El admin puede cambiarlo desde Configuración.

precios_diarios                      -- precio de venta fijado por el admin cada día
  id            uuid  PK DEFAULT gen_random_uuid()
  fecha         date  NOT NULL UNIQUE
  precio_db5_centimos      bigint NOT NULL   -- precio venta S/galón en céntimos
  precio_regular_centimos  bigint NOT NULL
  precio_premium_centimos  bigint NOT NULL
  registrado_por  uuid  FK → profiles
  created_at    timestamptz DEFAULT now()
  -- El admin ingresa estos precios en el header del "Sistema Integrado de Ventas"
```

---

### 5.2 Cierre de caja (interfaz grifero)

Nota: el dinero se guarda **siempre en céntimos enteros** (`bigint`). Nunca floats.

```
cierres_caja
  id                    uuid  PK DEFAULT gen_random_uuid()
  colaborador_id        uuid  FK → profiles
  turno_id              smallint FK → turnos
  fecha                 date  NOT NULL

  -- === SECCIÓN GRIFERO (llena desde interfaz grifero) ===
  -- Medios de pago
  efectivo_centimos              bigint DEFAULT 0
  yape_centimos                  bigint DEFAULT 0
  openpay_centimos               bigint DEFAULT 0
  deposito_transferencia_centimos bigint DEFAULT 0
  -- Ajustes que reducen el total (no son ingresos reales)
  serafinado_centimos            bigint DEFAULT 0  -- PRUEBA en interfaz admin; combustible devuelto al tanque
  redondeo_centimos              bigint DEFAULT 0  -- diferencias mínimas de cambio en efectivo
  -- Pérdidas reales
  contaminacion_centimos         bigint DEFAULT 0  -- combustible equivocado, no recuperable
  -- Total registrado por la consola de despacho
  total_consola_centimos         bigint
  -- Diferencia (total_real - total_consola); positivo=SOBRA, negativo=FALTA
  diferencia_centimos            bigint
  -- Dinero físico entregado por el grifero en el sobre
  entregado_grifero_centimos     bigint

  -- === SECCIÓN ADMIN — MODO ABREVIADO (llena en "Sistema Integrado de Ventas") ===
  -- Créditos por categoría: en modo ABREVIADO el admin entra montos directamente;
  -- en modo COMPLETO estos campos se DERIVAN de registro_ventas (calculados en vista).
  corporacion_centimos           bigint DEFAULT 0  -- colum. CORPORACIÓN
  licitaciones_centimos          bigint DEFAULT 0  -- colum. LICITACIONES
  particulares_centimos          bigint DEFAULT 0  -- créditos particulares
  chevron_centimos               bigint DEFAULT 0  -- colum. CHEVRON
  -- dsctos_vales = sum(corporacion + licitaciones + particulares + chevron)
  -- Se calcula en UI; no se persiste para evitar redundancia.
  -- Monto contabilizado al contar físicamente el sobre del grifero
  contabilizado_admin_centimos   bigint
  -- Modo de ingreso: false=abreviado (solo montos), true=completo (con detalle clientes)
  ingreso_completado             bool DEFAULT false

  notas    text
  estado   text DEFAULT 'borrador' CHECK IN ('borrador','enviado','revisado')
  created_at  timestamptz DEFAULT now()
  updated_at  timestamptz DEFAULT now()

cierre_denominaciones
  id         uuid  PK DEFAULT gen_random_uuid()
  cierre_id  uuid  FK → cierres_caja ON DELETE CASCADE
  tipo       text  CHECK IN ('moneda','billete')
  denominacion_centimos  integer  -- ej: 10, 20, 50, 100, 200, 1000, 2000, 5000, 10000, 20000
  cantidad   integer DEFAULT 0

cierre_vales
  -- Una fila por cada línea que el grifero ingresa en el modal de detalle.
  -- Ej: clic en "Licitaciones" → modal con mini-tabla → cada fila = 1 registro aquí.
  -- El total por tipo = SUM(monto_centimos) WHERE cierre_id AND tipo_vale (calculado en UI).
  id             uuid  PK DEFAULT gen_random_uuid()
  cierre_id      uuid  FK → cierres_caja ON DELETE CASCADE
  tipo_vale      text  CHECK IN ('licitacion','corporacion','citv','chevron','credito')
  descripcion    text  -- nombre del cliente/empresa que escribe el grifero (nullable)
  monto_centimos bigint NOT NULL
  orden          smallint DEFAULT 0  -- para mantener el orden de ingreso en el modal
```

**Lógica de serafinado vs contaminación:**
- `serafinado_centimos`: la consola lo registró como venta pero el combustible
  volvió al tanque → **se descuenta del total para el cuadre**, no es pérdida real.
- `contaminacion_centimos`: combustible equivocado suministrado, no se recupera
  → **es pérdida real**, afecta inventario y resultados del turno.

---

### 5.3 Ventas corporativas y registro de documentos

Refleja la hoja `ENCABEZADO_REGISTRO`: ventas a empresas, con conductor/placa
(flota), tipo de documento (vale, factura), estado de cobro.

```
empresas_clientes                    -- CRUD desde Configuración
  id          uuid  PK DEFAULT gen_random_uuid()
  nombre      text  NOT NULL
  ruc         text
  tipo        text  CHECK IN ('corporativo','licitacion','citv','chevron','credito','particular')
  contacto    text
  activo      bool  DEFAULT true
  created_at  timestamptz DEFAULT now()

registro_ventas
  id                  uuid  PK DEFAULT gen_random_uuid()
  cierre_id           uuid  FK → cierres_caja ON DELETE SET NULL  -- turno al que pertenece
  fecha               date  NOT NULL
  turno_id            smallint FK → turnos
  colaborador_id      uuid  FK → profiles  -- grifero que despachó
  tipo_documento      text  CHECK IN ('vale','factura','boleta','nota_credito')
  serie               text
  numero              text  -- número de vale o ticket
  empresa_id          uuid  FK → empresas_clientes
  tipo_atencion       text  CHECK IN ('corporativo','licitacion','particular','chevron')
  conductor           text
  placa               text
  dni_conductor       text
  tipo_combustible    text  FK → tipos_combustible
  cantidad_galones    numeric(10,3)
  precio_unit_centimos  bigint  -- precio del vale (puede diferir del precio del día)
  importe_centimos    bigint  -- = cantidad_galones × precio_unit_centimos / 100
  -- VARIACIÓN = (precio_diario - precio_vale) × galones
  -- Se calcula en UI cruzando con precios_diarios; no se persiste.
  empresa_facturacion text  -- puede diferir de empresa_id
  factura_numero      text
  fecha_facturacion   date
  estado_pago         text  DEFAULT 'pendiente' CHECK IN ('pagado','pendiente')
  fecha_pago          date
  created_at          timestamptz DEFAULT now()
```

---

### 5.4 Compras de combustible

Refleja la hoja `COMPRA_COMBUSTIBLE`: histórico de compras con utilidad/galón.

```
proveedores                          -- CRUD desde Configuración
  id          uuid  PK DEFAULT gen_random_uuid()
  nombre      text  NOT NULL  -- ej. PRIMAX, REPSOL, EXACT PERU, HIDROMUNDO
  contacto    text            -- nombre de contacto comercial (opcional)
  telefono    text
  activo      bool  DEFAULT true
  created_at  timestamptz DEFAULT now()

compras_combustible
  id                    uuid  PK DEFAULT gen_random_uuid()
  fecha                 date  NOT NULL
  proveedor_id          uuid  FK → proveedores
  tipo_combustible      text  FK → tipos_combustible
  cantidad_galones      numeric(10,2)
  precio_compra_centimos  bigint   -- precio por galón
  monto_total_centimos  bigint   -- cantidad × precio
  monto_flete_centimos  bigint   DEFAULT 0
  estado_flete          text  DEFAULT 'pendiente' CHECK IN ('pagado','pendiente')
  fecha_pago_flete      date
  -- Utilidad calculada (precio venta actual - precio compra) se deriva al mostrar
  notas                 text
  created_at            timestamptz DEFAULT now()
```

---

### 5.5 OSINERGMIN — precios y ranking

Fuente real: descarga directa del Excel **"Ultimos-Precios-Registrados-EVPC.xlsx"**
desde `https://www.osinergmin.gob.pe/empresas/hidrocarburos/scop/documentos-scop`.
**No hay scraping**; es un Excel descargable público.

**Estructura del Excel (verificada):**
```
NRO_REGISTRO | RUC | RAZON | DEPARTAMENTO | PROVINCIA | DISTRITO |
DIRECCION | FCHA_REGISTRO* | COD_PRODUCTO | PRODUCTO | PRECIO_VENTA |
UNIDAD | CODIGO_OSINERG | ACTIVIDAD | COD_ACTIVIDAD | MARCA |
ULT_PRECIO_DIF_CERO | PRODUCTO_ACTIVO
```
*`FCHA_REGISTRO` viene como número serial de Excel → convertir con
`new Date(Math.round((serial - 25569) * 86400 * 1000))`.

**Nombres exactos de productos en el Excel:**
- Diesel B5 → `"Diesel B5 S-50 UV"`
- Regular → `"GASOHOL REGULAR"`
- Premium → `"GASOHOL PREMIUM"`
(ignorar `"GLP - G"` que también aparece en el archivo)

**Establecimiento propio:**
- Nombre en Excel (columna RAZON): almacenado en `app_config['osinergmin_nombre_grifo']`.
  Valor inicial: `'ALEXMATH'`. Editable por el admin desde Configuración.
- **El distrito NO está hardcodeado.** El job lo deriva automáticamente:
  1. Busca la fila en el Excel donde `RAZON.includes(nombre_grifo)`.
  2. Lee el campo `DISTRITO` de esa fila → usa ESE distrito para el ranking.
  3. Esto garantiza que si el admin cambia el nombre en `app_config`, el distrito
     cambia automáticamente sin tocar código.
- Si el establecimiento propio **no está en el top 10**, el job igual registra
  su posición real (puede ser > 10) en `osinergmin_snapshots.ranking_*`.

**Proceso del job:**
1. Leer `app_config['osinergmin_nombre_grifo']` desde Supabase (con service_role).
2. GET al Excel → ArrayBuffer → parsear con `xlsx`.
3. Buscar fila donde `row.RAZON.includes(nombre_grifo)` → extraer `row.DISTRITO`.
4. Filtrar todas las filas: `row.DISTRITO === distrito_encontrado`.
5. Por cada uno de los 3 combustibles:
   a. Filtrar por `PRODUCTO` + ordenar por `PRECIO_VENTA` ascendente.
   b. Asignar ranking (posición 1 = más barato).
   c. Registrar posición propia (puede ser > 10).
   d. Tomar `slice(0, 10)` → top 10 para comparativa.
6. Insertar 1 `osinergmin_snapshots` + hasta 30 filas en `osinergmin_top10`.
   **Peso mínimo en Supabase.**

```
osinergmin_snapshots
  id                      uuid  PK DEFAULT gen_random_uuid()
  fecha_consulta          timestamptz DEFAULT now()
  fecha_datos_excel       date    -- FCHA_REGISTRO convertida del Excel
  distrito                text    DEFAULT 'AREQUIPA'
  total_establecimientos  integer -- total del distrito antes de filtrar
  -- Posición de NUESTRO grifo por combustible (null = no reportó precio)
  ranking_db5             integer
  precio_db5_centimos     bigint
  ranking_regular         integer
  precio_regular_centimos bigint
  ranking_premium         integer
  precio_premium_centimos bigint
  created_at              timestamptz DEFAULT now()

osinergmin_top10
  id              uuid  PK DEFAULT gen_random_uuid()
  snapshot_id     uuid  FK → osinergmin_snapshots ON DELETE CASCADE
  producto        text  CHECK IN ('DB5','REGULAR','PREMIUM')
  ranking         integer  -- 1 = más barato
  razon_social    text
  direccion       text
  precio_centimos bigint
  es_nuestro      bool  DEFAULT false  -- true = es el grifo propio
```

---

### 5.6 Reglas generales del esquema

- **Dinero siempre en céntimos enteros** (`bigint`). Nunca `float`/`double`/`real`.
  Formatear a `S/ 0.00` solo en la capa de presentación.
- `created_at` / `updated_at` en todas las tablas con `DEFAULT now()`.
- Llaves foráneas siempre declaradas con `REFERENCES` + `ON DELETE` explícito.
- **RLS activado en cada tabla.** Políticas por rol:

  | Tabla | grifero | admin_grifo | superadmin |
  |-------|---------|-------------|------------|
  | `cierres_caja` | SELECT/INSERT propios (`colaborador_id = uid`) | SELECT/UPDATE todos | todo |
  | `cierre_denominaciones` | via cierre propio | SELECT todos | todo |
  | `cierre_vales` | SELECT/INSERT/DELETE propios | SELECT todos | todo |
  | `registro_ventas` | — | SELECT/INSERT/UPDATE/DELETE | todo |
  | `precios_diarios` | SELECT | SELECT/INSERT/UPDATE | todo |
  | `empresas_clientes` | SELECT | SELECT/INSERT/UPDATE | todo |
  | `proveedores` | — | SELECT | todo |
  | `compras_combustible` | — | SELECT/INSERT/UPDATE | todo |
  | `turnos`, `tanques`, `tipos_combustible` | SELECT | SELECT/UPDATE | todo (CRUD) |
  | `proveedores` | — | SELECT/INSERT/UPDATE | todo |
  | `app_config` | — | SELECT (lectura) | todo |
  | `profiles` | SELECT propio | SELECT/UPDATE griferos | todo |
  | `osinergmin_*` | SELECT | SELECT | todo |

  - Edge Functions usan `service_role` (bypassa RLS) solo para el job OSINERGMIN.
  - `superadmin` es la única cuenta que puede crear/desactivar `admin_grifo`.

---

## 6. Buenas prácticas de código

### Generales
- **TypeScript estricto** (`"strict": true`). Nada de `any` salvo último recurso.
- Componentes pequeños y de una sola responsabilidad. Si un archivo pasa de ~200
  líneas, dividir.
- Lógica de negocio (cálculos) **separada de la UI**: ponerla en `lib/` o `hooks/`,
  testeable de forma aislada.
- Nombres en español o inglés, pero **consistentes** en todo el proyecto.
- ESLint + Prettier configurados; formato automático al guardar.

### Manejo de dinero (crítico en un grifo)
- Guardar y operar en **céntimos enteros**; formatear a `S/ 0.00` solo para mostrar.
- Comparaciones de diferencia con tolerancia ya prevista en el prototipo
  (`> 0.0005`), pero idealmente todo en enteros elimina el problema de redondeo.
- Helpers centralizados en `lib/money.ts` (`toCentimos`, `formatSoles`).

### Seguridad de datos
- Las **claves** (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) van en `.env`,
  **nunca** hardcodeadas ni commiteadas. La `service_role key` **solo** en el
  servidor/Edge Functions, jamás en el frontend.
- Validar entradas tanto en el cliente como con **constraints en Postgres**.
- Toda la autorización real vive en **RLS**, no en el frontend (el front solo oculta UI).

### React / UI
- Estado del servidor → TanStack Query (no `useEffect` manual para fetch).
- Inputs numéricos: validar y normalizar (el prototipo ya hace `Math.max(0, …)`).
- Accesibilidad básica: `label` en inputs, foco visible, botones con tamaño táctil.
- Diseño **móvil/kiosco primero**: botones grandes, alto contraste, flujo lineal.

---

## 7. PWA y modo kiosco

- `manifest.json`: `name`, `short_name`, íconos 192/512, `"display": "fullscreen"`,
  `"start_url": "/grifero"`, `theme_color`.
- Service worker vía `vite-plugin-pwa` (estrategia de cache para que cargue rápido).
- **Offline básico:** si una zona pierde señal, guardar el cierre en `localStorage`/
  IndexedDB y sincronizar con Supabase al reconectar (definir si se prioriza más
  adelante; arrancar online y endurecer luego).
- Lanzar Chrome en la PC del grifo en modo kiosco: `chrome --kiosk https://tu-dominio`.

---

## 8. CI/CD — GitHub + Cloudflare Pages

- Repositorio en GitHub con **dos ramas**:
  - `dev` — desarrollo. Cloudflare genera *preview deployments* automáticos.
  - `main` — producción. Cada merge despliega al dominio real.
- Flujo: trabajar en ramas de feature → PR a `dev` → probar en preview → merge a
  `main` cuando esté estable.
- **No commitear** `.env`, `node_modules/`, ni claves. Mantener `.gitignore`.
- Las migraciones SQL viven en `supabase/migrations/` y se versionan en git.
- (Recomendado más adelante) GitHub Actions: lint + typecheck + build en cada PR.

---

## 9. Job horario de OSINERGMIN

**Qué hace:** cada hora descarga el Excel público de OSINERGMIN, lo filtra
por distrito y guarda los top 10 de cada combustible + la posición del grifo.
**No hay scraping** — es una descarga directa de archivo Excel.

**Fuente:**
```
URL: https://www.osinergmin.gob.pe/empresas/hidrocarburos/scop/documentos-scop
Archivo: Ultimos-Precios-Registrados-EVPC.xlsx
Tamaño aprox: ~1.5 MB | ~17,000 filas (todo el Perú)
Tras filtrar Arequipa distrito: ~84 filas | ~24 por combustible
```

**Implementación — Supabase Edge Function (Deno):**
```typescript
// supabase/functions/osinergmin-job/index.ts
// Cron: "0 * * * *" (cada hora) vía pg_cron o Supabase Scheduled Functions

1. fetch(URL_EXCEL) → ArrayBuffer
2. XLSX.read(buffer) → sheet_to_json()
3. Filtrar: DEPARTAMENTO==='AREQUIPA' && DISTRITO===config.distrito
4. Por cada producto ('Diesel B5 S-50 UV', 'GASOHOL REGULAR', 'GASOHOL PREMIUM'):
   a. filter + sort por PRECIO_VENTA asc
   b. slice(0, 10) → top 10
   c. findIndex donde RAZON incluye config.nombre_establecimiento → ranking
5. INSERT osinergmin_snapshots + osinergmin_top10 (30 filas máx)
6. Catch: INSERT en jobs_log con el error; no lanzar excepción (no rompe la app)
```

**Configuración (tabla `app_config`, editable desde el panel admin → Configuración):**
- `osinergmin_nombre_grifo` = `'ALEXMATH'`
  (el admin lo cambia desde la UI; el distrito se deriva automáticamente del Excel)

**Estimación de peso en Supabase:**
- 30 filas × 24 horas × 365 días = ~262,800 filas/año en `osinergmin_top10`.
  Con ~200 bytes/fila ≈ **52 MB/año**. Muy manejable con el plan gratuito.
- Opcional: purgar registros de más de 90 días con un job mensual.

---

## 10. Interfaz Admin — Sistema Integrado de Ventas

Módulo principal del panel admin. Permite al administrador hacer el **cierre diario**
consolidando los 4 turnos. Título en pantalla: `SISTEMA INTEGRADO DE VENTAS`.

### 10.1 Header (fijo en todos los modos)

```
[ dd/mm/aaaa ▼ ]   DIESEL: [__]   REGULAR: [__]   PREMIUM: [__]
                              [ ABREVIADO ]  [ COMPLETO ]  [ BASE DATOS ]          [REINICIAR DÍA]
```

- **Selector de fecha:** carga los datos del día seleccionado.
- **Precios de combustible (DIESEL / REGULAR / PREMIUM):** el admin ingresa los precios
  de venta del día (S//galón). Se guardan en la tabla `precios_diarios`.
  Son necesarios para calcular el total esperado y para la validación cruzada con OSINERGMIN.
- **Toggles de modo:** cambian la vista de la tabla principal (no recargan datos).
- **REINICIAR DÍA:** acción destructiva — borra/resetea el cierre en borrador del día.
  Requiere confirmación modal antes de ejecutar.

### 10.2 Modo ABREVIADO

Vista compacta: una fila por turno, créditos agrupados.

| TURNO | TOTAL CONSOLA | YAPE | OPEN PAY | DSCTOS VALES | TOTAL CRÉDITOS ★ | PRUEBA | REDONDEO X EFECTIVO | EFECTIVO FINAL |
|-------|--------------|------|----------|-------------|-----------------|--------|---------------------|----------------|
| 1 | editable | editable | editable | editable | **calculado** (amarillo) | editable | editable | **calculado** |
| 2 | … | … | … | … | … | … | … | … |
| 3 | … | … | … | … | … | … | … | … |
| 4 | … | … | … | … | … | … | … | … |

- **★ TOTAL CRÉDITOS** (fondo amarillo): suma de Corporación + Licitaciones + Particulares + Chevron.
  Es de solo lectura; se alimenta desde la tabla de transacciones del modo COMPLETO.
- **EFECTIVO FINAL** = `TOTAL CONSOLA − YAPE − OPEN PAY − DSCTOS VALES − TOTAL CRÉDITOS − PRUEBA − REDONDEO X EFECTIVO`

### 10.3 Modo COMPLETO

Igual que ABREVIADO pero **TOTAL CRÉDITOS se expande** en columnas individuales
+ aparece una segunda tabla de transacciones corporativas/vales.

**Tabla superior (mismas 4 filas de turno):**

| TURNO | TOTAL CONSOLA | YAPE | OPENPAY | DSCTOS VALES | CORPORACIÓN ★ | LICITACIONES ★ | PARTICULARES ★ | CHEVRON ★ | PRUEBA | REDONDEO X EFECTIVO | EFECTIVO FINAL |
|-------|--------------|------|---------|-------------|--------------|----------------|----------------|-----------|--------|---------------------|----------------|

- Las 4 columnas con ★ (fondo gris, solo lectura): se calculan sumando las
  transacciones de la tabla inferior que corresponden a ese turno.

**Tabla inferior — Registro de transacciones corporativas/vales:**

| FECHA | CLIENTE | VALE | PLACA | TICKET | CONDUCTOR | DNI | TURNO | PRODUCTO | GALONES | PRECIO TOTAL | VARIACIÓN ★ |
|-------|---------|------|-------|--------|-----------|-----|-------|---------|---------|-------------|-------------|

- Fila de entrada editable en la parte inferior (la fila visible tiene `Buscar...` en CLIENTE).
- **CLIENTE:** buscador/autocompletar sobre `empresas_clientes`.
- **PRODUCTO:** dropdown (Diesel / Regular / Premium).
- **PRECIO TOTAL** = `GALONES × precio_unit` (del vale o precio acordado).
- **★ VARIACIÓN** (en naranja): diferencia entre el precio de venta del día y el precio
  del vale → `(precio_diario − precio_vale) × galones`. Indica si el vale fue emitido
  a un precio diferente al del día.
- Cada fila guardada actualiza automáticamente las columnas CORPORACIÓN / LICITACIONES /
  PARTICULARES / CHEVRON de la tabla superior según el tipo de empresa y turno.

### 10.3.1 Flujo grifero → modal de vales → vista admin

**En la interfaz del grifero (PC isla):**
- El grifero ve botones por tipo de vale: Licitaciones, Corporación, CITV, Chevron, Crédito.
- Al hacer clic en cualquiera → se abre un **modal con mini-tabla**:
  ```
  | Descripción (cliente/empresa)  | Monto S/ |  [✕] |
  | [campo texto]                  | [campo]  |      |
  | [+ Agregar fila]               |          |      |
  | ─────────────────────────────────────────────── |
  | TOTAL LICITACIONES:                    S/ 0.00  |
  ```
- El grifero escribe descripción y monto por cada vale. La app suma en tiempo real.
- Al cerrar el modal: el total se refleja automáticamente en el campo correspondiente
  del cierre de caja. **No necesita calculadora.**
- Cada fila del modal = 1 registro en `cierre_vales`.

**En el panel del administrador del grifo:**
- Vista resumen (tabla de los 4 turnos): muestra solo el TOTAL por categoría.
- Botón "Ver detalle" o clic en la celda → abre modal con la misma mini-tabla
  que ingresó el grifero (solo lectura para el admin en este nivel).
- Desde el modo COMPLETO: el admin puede vincular esos registros a `registro_ventas`
  (cliente formal con RUC, factura, etc.) para la contabilidad completa.

---

### 10.4 Modo BASE DATOS

Tercera opción del toggle. Propósito a definir — probablemente muestra las tablas
brutas de datos (sin cálculos) para auditoría o exportación a Excel. **Pendiente de
especificación por el usuario.**

### 10.5 Fórmula general EFECTIVO FINAL (por turno)

```
efectivo_final =
  total_consola
  − yape
  − openpay
  − dsctos_vales           (suma de todos los vales del turno)
  − total_creditos          (corporación + licitaciones + particulares + chevron)
  − prueba                  (serafinado/contaminación ajustada)
  − redondeo_x_efectivo     (diferencias mínimas de cambio)
```

> La columna `DSCTOS VALES` en la tabla superior es un resumen; el desglose vive
> en `cierre_vales` vinculado al `cierre_caja` del turno.

---

## 11. Plan de trabajo sugerido (orden)

1. **Scaffold:** crear repo GitHub → Vite + React + TS + Tailwind + Supabase client.
   Configurar `.env`. Configurar ESLint + Prettier.
2. **Supabase:** crear proyecto → aplicar migraciones del esquema §5 → activar RLS
   → crear usuarios de prueba (1 grifero, 1 admin) → poblar `app_config`.
3. **Módulo Grifero — Cierre de Caja:** migrar del prototipo `.dc.html` a
   componentes React. Conectar a Supabase (guardar/leer cierre).
4. **Módulo Grifero — Varillaje:** diseñar pantalla (el prototipo la tiene vacía).
5. **Panel Admin — Sistema Integrado de Ventas (§10):** cierre diario modos ABREVIADO
   y COMPLETO con tabla de transacciones corporativas/vales.
6. **Panel Admin — Ventas Diarias:** vista histórica de cierres consolidados por día.
7. **Panel Admin — Registro Corporativo/Vales:** CRUD de ventas a empresas.
8. **Panel Admin — Compras de Combustible + Comparador de Proveedores.**
9. **PWA + manifest + modo kiosco** (Chrome `--kiosk`).
10. **Cloudflare Pages** + conectar GitHub (ramas dev/main) + **Zero Trust Access**.
11. **Job OSINERGMIN** (Edge Function + pg_cron): descarga Excel → filtra MIRAFLORES
    → top 10 + posición de ALEXMATH → inserta en Supabase.
12. **Panel Admin — Módulo OSINERGMIN:** ranking histórico de los 3 combustibles.
13. **Panel Admin — Configuración:** edición de `app_config` (nombre grifo, distrito, etc.).

---

## Resumen de "qué SÍ y qué NO"

✅ TypeScript + React + Vite + Supabase + Cloudflare + Tailwind
✅ Dinero en céntimos enteros · RLS en todas las tablas · `.env` para secretos
✅ Reutilizar la maqueta del prototipo como referencia visual
❌ C (no aplica a apps web) · ❌ floats para dinero · ❌ claves en el código
❌ confiar la seguridad solo al frontend (la verdad está en RLS)
