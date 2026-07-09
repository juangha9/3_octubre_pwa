---
name: proyecto-grifo-estado
description: "Estado actual de construcción del Sistema Grifo — qué está hecho, qué falta, dónde nos quedamos"
metadata:
  node_type: memory
  type: project
  originSessionId: 2846fb7a-3ed9-41a7-bca2-7b57da65d443
---

Última actualización: **2026-07-08** (tema oscuro global, combobox editable en Ventas, fix 400 al escribir fecha, gráfico OSINERGMIN tematizado)

## Módulos completados

### Grifero
- **HomePage** — saludo con nombre, reloj en vivo, dos botones (Cierre de Caja / Varillaje)
- **CierreCajaPage** — contador de monedas/billetes (DenomCounter), medios de pago (Yape/OpenPay), modales de vales (licitacion/corporacion/citv/chevron/credito), resumen con diferencia SOBRA/FALTA/EXACTO, guarda en `cierres_caja` + `cierre_denominaciones` + `cierre_vales`
- **ValeModal** — tabla mini con Enter para agregar fila, total automático
- **VarillajePage** — CONSTRUIDO (medición en cm por tanque en grilla, galones ocultos al grifero; ver sesión 2026-07-05 parte 2)

### Admin
- **AdminLayout** — barra nav top: Ventas, **Seguimiento**, Compras, OSINERGMIN, Configuración + botón Salir.
  - ⚠️ "Corporativo / Vales" fue **renombrado a "Seguimiento"**; la ruta pasó de `/corporativo` a `/seguimiento` (el componente sigue siendo `CorporativoPage.tsx`).
- **ConfiguracionPage** — 6 sub-tabs con CRUD completo:
  - Turnos, Combustibles, Tanques, Empresas Clientes, Proveedores
  - Sistema — `app_config` editable por `admin_grifo` y `superadmin` (política RLS actualizada en migración `002_app_config_admin_write.sql`, **aplicada con éxito**)
- **Ventas del Día & Ventas Diarias (Unificados)** ← **CONSTRUIDO Y PERFECCIONADO** (`src/features/admin/ventas/VentasDelDiaPage.tsx`)
  - **Toolbar**: fecha, precios DIESEL/REGULAR/PREMIUM (auto-save en `precios_diarios`, **heredados** del día anterior más reciente si hoy no tiene precio propio — ver sesión 2026-07-03), toggle ABREVIADO/COMPLETO, botón **"Corregir fecha"** (mover el día completo a otra fecha, solo si el destino está vacío). **Ya NO existe** el botón REINICIAR DÍA (se quitó por decisión de negocio: nada debe borrar en masa a nivel de BD).
  - **Tabla de Turnos (Editable e Instantánea)**: Celdas de consola, yape, openpay, depósito, pruebas, redondeo y colaborador editables directamente. Auto-guardan en `onBlur` (o al cambiar colaborador) con **refresco silencioso (flicker-free)**. Guarda en `cierres_caja`.
  - **Registro Rápido de Créditos** (modo Abreviado): Turno + Monto S/. → `registro_ventas` (fila con `cantidad_galones = 0`). Se muestran en **4 columnas** (una por turno) con subtotal cada una, sin altura fija (antes era una mini-tabla de 48px con scroll).
  - **Registros de Vales (modo Completo)**: tabla 100% editable en línea, **sin botón "Editar"** — cada celda auto-guarda en `onBlur` (mismo patrón que la Tabla de Turnos). Las filas que vinieron de Registro Rápido (aún con `cantidad_galones = 0` o recién completadas) se resaltan en ámbar; hay un aviso arriba de la tabla con el conteo de pendientes por completar. Al ingresar los galones reales, el importe se recalcula como `galones × precio` (autoritativo, viene del documento/contrato) y se muestra una alerta si difiere del monto rápido original en más de 5 céntimos (tolerancia de redondeo normal).
  - **Historial Mensual**: pestaña con agrupación de cierres por día, total acumulado del mes, faltantes/sobrantes por turno/día, imprimir reporte. Lee de `cierres_caja`.
- **Seguimiento (ex Corporativo / Vales)** ← **CONSTRUIDO** (`src/features/admin/corporativo/CorporativoPage.tsx`)
  - CRUD sobre **`registro_ventas`** (la MISMA tabla que usa Ventas → así están "conectados": los vales/créditos de Ventas aparecen aquí).
  - Tabs **Registros** (tabla con variación vs precio del día, totales, pendiente de cobro) y **Por Empresa** (agrupado).
  - Filtros por mes / tipo / empresa / estado de pago, **persistidos** (ver abajo).
  - Modal nuevo/editar registro; toggle estado PAGADO/PENDIENTE; eliminar con confirmación.

## Cambios de esta sesión (2026-07-01)
1. **Bug "Cargando…" infinito al cambiar de fecha** (Ventas y Seguimiento): faltaba `try/catch/finally` en `loadDia` / `loadMes` → si Supabase fallaba (502), el spinner quedaba atascado. Corregido en ambos.
2. **Parpadeo + carga lenta al inicio de Ventas**: `loadDia` dependía de `turnos` → doble fetch. Ahora depende solo de `[fecha]`; la construcción de `inputsMap` se movió a un `useEffect` reactivo a `[cierresMap, turnos]` (sin red). `loadingDia` inicia en `true` (spinner instantáneo, sin destello).
3. **Celdas en 0 → placeholder**: yape/openpay/depósito/prueba/redondeo quedan `value=''` con `placeholder="0.00"` cuando valen 0, para que al escribir no se antepongan dígitos ("5" no se vuelve "50").
4. **Cierres "fantasma" evitados**: `handleShiftInputBlur` ya **no** inserta un cierre de puros ceros si no hay dato significativo (antes cualquier blur creaba filas vacías que ensuciaban el historial).
5. **Tablas más legibles**: `.table-excel` pasó a filas 36px, celdas 14px (antes 28px/12px). El font-size se fija por selector compuesto para prevalecer sobre `text-xs` en línea (incluye inputs/selects).
6. **Inputs numéricos endurecidos (GLOBAL)**: `useHardenNumberInputs()` en `App.tsx` + CSS. Bloquea teclear `e/E/+/-/*//`, el scroll del ratón no cambia el valor, y se ocultan las flechas (spinners). Aplica a TODO `<input type="number">` actual y futuro.
7. **Ancho adaptativo**: la raíz de Ventas y Seguimiento ahora usa `flex-1 min-w-0` → las páginas llenan el ancho del monitor (1080p/1440p). Antes solo ocupaban el ancho de su contenido (~medio monitor en 2K).
8. **Filtros persistidos**: `usePersistedState` (localStorage) recuerda el filtro de mes/tipo/empresa/estado en Seguimiento al cambiar de módulo o recargar.

## Cambios de esta sesión (2026-07-02)
1. **Botón "REINICIAR DÍA" eliminado** de `VentasDelDiaPage.tsx` (estado `confirmReinicio`, función `handleReinicio` y el JSX del botón). Decisión de negocio: no debe existir un borrado masivo/irreversible a nivel de BD; correcciones puntuales se hacen fila por fila. `BUENAS_PRACTICAS.md` §10.1 actualizado para reflejarlo.
2. **Rol de experto agregado a `BUENAS_PRACTICAS.md`**: nota al inicio del documento indicando actuar como desarrollador full-stack senior (25+ años) en este proyecto.
3. **Decisión de negocio — CHEVRON no es "crédito"**: sigue restándose del EFECTIVO FINAL igual que Corporación/Licitaciones/Particulares (es un medio de pago no-efectivo), pero conceptualmente no es un "vale a crédito". No se tocó `calcEfectivoFinal` — ya se comportaba así.
4. **Decisión de negocio — reconciliación Registro Rápido → Completo**: al completar el detalle real de un registro rápido, el importe se recalcula desde `galones × precio` (autoritativo — así lo exigen los contratos de licitación), **no** se fuerza a mantener el monto rápido original. La variación esperada por redondeo es normal; solo se avisa si supera 5 céntimos.
5. **"Créditos Rápidos del Día" (modo Abreviado)** rediseñado: pasó de una mini-tabla de altura fija (48px, con scroll) a **4 columnas** (una por turno), cada una con su lista de créditos y subtotal, creciendo libremente en altura.
6. **"Registros guardados" (modo Completo)** rediseñado: se quitó el flujo "Editar → Guardar/Cancelar" (`editingId`/`editForm`/`startEdit`/`saveEdit`). Ahora la tabla es 100% editable en línea con auto-guardado en `onBlur` (nuevo estado `regInputsMap` + `handleRegInputChange`/`handleRegBlur`), igual patrón que la Tabla de Turnos. Se agregó resaltado ámbar para pendientes, aviso de conteo de pendientes, y alerta de variación vs. monto rápido (tolerancia 5 céntimos).
7. `npx tsc --noEmit` verificado sin errores tras los cambios.

## Cambios de esta sesión (2026-07-03)
1. **Precios "continuos" (arrastre de precio)**: `loadDia` ya no exige un registro de `precios_diarios` exacto por fecha. Si la fecha seleccionada no tiene precio propio, se hereda el más reciente anterior (`fecha < seleccionada`, `order desc`, `limit 1`) y se muestra pre-cargado. Al editar un campo de precio con un valor heredado, se **inserta una fila nueva** para la fecha actual (no se pisa la fila histórica) — `precioId` se deja en `null` cuando el precio viene heredado, precisamente para forzar el insert en vez de update. Esto también resuelve el conflicto de la restricción `UNIQUE(fecha)` de cara a la corrección de fecha (punto 2): la mayoría de los días ya no tienen fila propia en `precios_diarios`.
2. **Botón "Corregir fecha"** agregado junto al selector de fecha: permite mover TODO lo registrado bajo la fecha actual (`registro_ventas`, `cierres_caja`, `precios_diarios`) hacia otra fecha, para el caso de error humano (ej. registrar el cierre del sábado bajo la fecha del domingo por accidente). **Solo se permite si la fecha destino está completamente vacía** en las 3 tablas — si tiene cualquier dato, se bloquea con un aviso y no se fusiona ni se sobrescribe nada (decisión de negocio: la fusión automática es más riesgosa que útil). Función `handleFixDate()` en `VentasDelDiaPage.tsx`.
3. `npx tsc --noEmit` verificado sin errores tras los cambios.

## Cambios de esta sesión (2026-07-05)
1. **Encabezado de tabla inmóvil (sticky)**: `.table-excel thead th` ahora es `position: sticky; top: 0` (con `box-shadow` interno que reemplaza los bordes que `border-collapse` pierde al fijarse). Aplica a TODAS las tablas de la app. Decisión de UI: los filtros de Seguimiento se dejan en la barra superior (ya está fuera del scroll → siempre visibles), NO en el `<thead>`, porque la tabla tiene 16 columnas con scroll horizontal.
2. **Módulo Compras — pestaña Cotizador CONSTRUIDA** (`src/features/admin/compras/`):
   - `ComprasPage.tsx` — shell con tabs **Cotizador** | **Registro de Compras** (este último aún placeholder). Ruta `/compras` ya conectada en `AdminLayout` (reemplazó el placeholder).
   - `CotizadorPage.tsx` — herramienta de decisión "a quién comprar" (basada en `COMPRA_GALONES.png`). Panel de tanques (capacidad de `tanques` + stock auto del varillaje, con fallback manual + a comprar), tabla comparativa por proveedor (precio/gl editable → subtotal → descuento → total), **semáforo verde/rojo** del precio/gl más barato/caro por producto, y optimizador **"mejor precio" (compra dividida)** con ahorro vs. mejor proveedor único.
   - **Sin botón de guardar/registrar** (decisión de UX del usuario): es una tabla tipo Excel que auto-guarda en `localStorage` vía `usePersistedState` (claves `compras.cotizador.*`). NO persiste en BD.
   - Precisión: el cotizador NO usa céntimos (permite 4 decimales en precio/gl como el Excel); trabaja con floats porque es efímero (localStorage), no dato autoritativo de BD.
3. **Decisiones de negocio registradas para el Registro de Compras (pendiente)**:
   - Modelo **cabecera + líneas + fletes**: una compra puede ser de 1, 2 o 3 productos; hasta **3 fletes distintos** por compra (distintos transportistas), cada flete con estado pagado/pendiente y **a qué productos aplica** (uno/varios/todos).
   - **Stock** se guiará del **Varillaje** (sí se implementará) como fuente principal; el reporte de consola (screenshot, galones vendidos al inicio del día) irá en **pestaña aparte como referencia**, sin contaminar el cálculo del tanque.
   - **Arquitectura**: Varillaje + Cierre de Caja se mantienen en la **misma app** (un repo). La seguridad ya vive en RLS + rutas por rol, no en separar el código; separar solo aportaría aislamiento de despliegue/kiosco, que se resuelve a nivel de build cuando toque. Revisar al montar kioscos físicos.
4. `npx tsc --noEmit` verificado sin errores.

## Cambios de esta sesión (2026-07-05 — parte 2: acceso grifero, Varillaje, OSINERGMIN)

### Acceso del superadmin a la app del grifero + fix pantalla en blanco
1. **Pestaña "Grifero" en Admin (SOLO superadmin)**: `AdminLayout` monta `GriferoLayout` en `/grifero/*`, réplica fiel de lo que ve el grifero (HomePage con tarjetas Cierre/Varillaje). `admin_grifo` NO la ve (filtro `soloSuperadmin` en `NAV_ITEMS` + rutas condicionadas a `esSuperadmin`). El botón "Cerrar sesión" del HomePage se oculta cuando `base` != '' (para que el superadmin no cierre su sesión desde ahí).
2. **Patrón `base` prop**: `GriferoLayout`/`HomePage`/`CierreCajaPage`/`VarillajePage` aceptan `base` para montarse en dos rutas sin duplicar componentes: grifero real (`base=''` → `/`, `/cierre`, `/varillaje`) y superadmin (`base='/grifero'`). Rutas internas relativas (`index`, `cierre`, `varillaje`).
3. **Fix pantalla en blanco al cambiar de rol**: `BrowserRouter` recuerda la URL; si el superadmin estaba en `/compras` y luego entra un grifero (cuyo layout no tiene esa ruta) → pantalla en blanco. Se agregó `<Route path="*" element={<Navigate to=… replace/>}>` en ambos layouts (redirige al inicio del rol).
4. **Compras/Cotizador**: la tabla "Comparativo de proveedores" pasó a `w-auto` (antes se estiraba a todo el ancho de la pantalla).

### Varillaje (grifero) — CONSTRUIDO (migraciones 005 + 006)
- **Medición en cm + tabla de aforo**: la varilla mide **centímetros**; cada tanque tiene su **tabla de aforo** (cm→galones, no lineal por ser tanque horizontal) provista de fábrica. Tablas nuevas: `tanque_aforo` (calibración) y `varillaje_lecturas` (mediciones). `tanques` recibió `layout_fila`/`layout_columna` para la disposición visual.
- **Motivos de medición** (columna `tipo`): `cambio_turno` (con turno) y `control_osinergmin` (control diario obligatorio ~7am por norma). Confirmado por el usuario: se mide en cada cambio de turno y todos los días a las 7am.
- **Editor de disposición visual** (superadmin, Config→Tanques): `TanqueLayoutEditor.tsx` — grilla drag&drop; cada tanque se arrastra a su celda (fila/col), auto-guarda al soltar; soltar sobre celda ocupada → intercambio. (Son 4 tanques: 1 diesel, 1 regular, 2 premium.)
- **Editor de tabla de aforo** (Config→Tanques, botón "Aforo"): `TanqueAforoModal.tsx` — se pega la hoja cm→galones (separador tab/;/,/espacio), reemplaza toda la tabla del tanque.
- **VarillajePage (grifero)**: reproduce la MISMA grilla del superadmin; cada tanque = tarjeta con última lectura de referencia (en cm) + input de cm. El grifero SOLO ve/registra cm.
- **Galones OCULTOS al grifero (real, no solo visual)** — migración 006: la conversión cm→galones se hace en el SERVIDOR (trigger `fn_varillaje_set_volumen` + función `fn_aforo_interpolar`, ambas `SECURITY DEFINER`). `tanque_aforo` SELECT restringido a admin+. El grifero nunca recibe galones (su query selecciona columnas SIN `volumen_galones`). El admin sí los ve.
- **Enlace Varillaje → Compras ✅ (2026-07-05 parte 3)** — migración 010: `fn_stock_actual()` (RPC `SECURITY DEFINER`, **solo admin+**) devuelve la última lectura por tanque activo en galones (`DISTINCT ON (tanque_id) ORDER BY created_at DESC`). El Cotizador (`CotizadorPage.tsx`) la consume: la columna "STOCK ACTUAL (GL)" se autocompleta por producto (suma de sus tanques) con sello "varillaje · hace X" y aviso "N/M tanques medidos" si es parcial; productos sin lectura conservan el input manual (fallback). Botón "↻ Stock del varillaje" para recargar. Los galones siguen ocultos al grifero (la RPC rechaza a no-admin).

### OSINERGMIN — CONSTRUIDO (migraciones 007, 008, 009 + 2 Edge Functions)
- **Config→OSINERGMIN** (`OsinergminSection.tsx`, solo superadmin): pega el link de descarga del Excel (`app_config.osinergmin_url_excel`) y el RUC del grifo (`osinergmin_ruc`). El grifo se identifica por **RUC** (único/estable), NO por nombre — la semilla `osinergmin_nombre_grifo='ALEXMATH'` era placeholder y NO existe en el Excel real.
- **Excel real**: `Imágenes soporte/Ultimos-Precios-Registrados-EVPC (1).xlsx`, 1 hoja, ~17k filas, cols `RUC/RAZON/DISTRITO/DIRECCION/PRODUCTO/PRECIO_VENTA…` (3 filas por estación). Link: `https://www.osinergmin.gob.pe/seccion/centro_documental/hidrocarburos/SCOP/SCOP-DOCS/2026/Registro-precios/Ultimos-Precios-Registrados-EVPC.xlsx`. Mapeo producto (coincide con `tipos_combustible.nombre_osinergmin`): DB5→'Diesel B5 S-50 UV', REGULAR→'GASOHOL REGULAR', PREMIUM→'GASOHOL PREMIUM'.
- **Ranking**: filtra por el DISTRITO del grifo, dedup por RUC, ordena por precio asc. Guarda `osinergmin_snapshots` (tu ranking+precio por producto, distrito, total estab., `fecha_consulta`) + `osinergmin_top10` por producto (con flag `es_nuestro` para resaltarte). El top10 **CRECE** hasta incluir tu RUC si quedas fuera del 10.
- **UNA sola Edge Function `osinergmin-cron`** hace TODO en el servidor (descarga + parseo + ranking + guardado) con lector liviano **fflate + lectura directa del XML**. Se usó fflate porque SheetJS con 17k filas revienta el edge (**error 546 WORKER_LIMIT**); el lector liviano es ~120–200ms y está validado como idéntico a SheetJS. La disparan los dos caminos:
  - **Manual** (botón "Actualizar precios ahora"): el navegador invoca `osinergmin-cron` como **superadmin** (~5s). Antes se descargaba y parseaba en el navegador con `xlsx` (~20s); **se eliminó** ese rodeo, la función `osinergmin-update` y la dependencia `xlsx` (2026-07-05 parte 2, unificación).
  - **Automático** (cron horario): pg_cron invoca `osinergmin-cron` con el header `x-cron-secret`.
  - Ambos: dedup por TODO el top10 (competencia incluida) — si nada cambió, NO duplica, solo refresca `fecha_consulta`. Escribe por service_role. Requiere CORS + OPTIONS en la función (para el botón).
- **Cron** (migración 008, pg_cron + pg_net): `0 * * * *` (cada hora en punto; UTC, pero Perú UTC-5 entero → coincide con :00 local). Auth por **header propio `x-cron-secret`** (NO service_role en `Authorization`: el gateway de Supabase lo transforma → daba 401). El secreto vive en `CRON_SECRET` (secreto de la función vía `supabase secrets set`) y en el header del cron SQL. Corre 24/7 en el servidor, independiente del navegador/Cloudflare.
- **OsinergminPage** (`/osinergmin`): tarjetas de posición (#ranking + precio), Top 10 por producto (tu grifo resaltado, tabla `table-fixed` + nombres con `line-clamp-2`), evolución del ranking. **Auto-refresco por Realtime** (migración 009): suscripción a `osinergmin_snapshots`; la BD **empuja** el cambio y la app re-consulta sola (sin polling ni F5). "(hace X)" derivado de la `fecha_consulta` real. Focus-refetch como red de seguridad.

### Despliegue de Edge Functions (procedimiento validado)
- CLI: `npx supabase functions deploy <fn> --project-ref acvavpzdeichdvsgblcn --no-verify-jwt` con `$env:SUPABASE_ACCESS_TOKEN="sbp_…"` (token de Account→Access Tokens) y `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force` en PowerShell.
- `supabase/config.toml`: `verify_jwt = false` para ambas funciones (validan por dentro; sin eso el preflight OPTIONS/CORS del navegador se rechaza).
- Secretos auto-inyectados por Supabase: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Secreto propio: `CRON_SECRET`.

### Gotchas nuevos (Edge/OSINERGMIN) — para futuras sesiones
- **546 WORKER_LIMIT**: parsear el Excel completo con SheetJS revienta el edge → parseo pesado movido al navegador (manual) y a fflate+XML liviano (cron).
- **401 con service_role en `Authorization`**: el gateway transforma ese header → la función no ve la clave igual. Solución: header propio `x-cron-secret`.
- **CORS "preflight doesn't pass"**: casi siempre = función NO desplegada, slug mal escrito (`osinergmin-cron` con guion, ojo "osinerGMIn" no "osinerMING"), o `verify_jwt` activo.
- **Bundler del dashboard bloquea `cdn.sheetjs.com`**: importar librerías en el edge desde **esm.sh** (`https://esm.sh/xlsx@0.18.5`, `https://esm.sh/fflate@0.8.2`).
- **Deploy "Via Editor" del dashboard**: al pegar perdía el `// ` inicial → error de parseo. Usar CLI (lee el archivo del disco).
- **Realtime**: hay que activarlo por tabla (`alter publication supabase_realtime add table …`, migración 009).

## Cambios de esta sesión (2026-07-05 — parte 3: enlace stock + Registro de Compras)

### Enlace Varillaje → Cotizador (migración 010)
- `fn_stock_actual()` (RPC `SECURITY DEFINER`, **solo admin+**): última lectura por tanque activo en galones (`DISTINCT ON (tanque_id) ORDER BY created_at DESC`). Reutilizable por un futuro bot ("¿cuánto stock hay?").
- `CotizadorPage.tsx`: la columna **STOCK ACTUAL** ya **no es editable** — viene solo del varillaje (suma por producto), con sello "varillaje · hace X" y aviso "N/M tanques medidos" si es parcial. Sin lectura → muestra `—` (y DISPONIBLE también `—`, no se asume tanque lleno). Botón "↻ Stock del varillaje". Los galones siguen ocultos al grifero (la RPC rechaza a no-admin).

### Registro de Compras — CONSTRUIDO (migración 011)
- **Modelo normalizado** (reemplaza la tabla plana `compras_combustible`, que queda obsoleta/sin uso): `compras` (cabecera) + `compra_lineas` (1–3 productos, `precio_gl numeric(12,4)` = soles con 4 decimales como el Excel, NO céntimos) + `compra_fletes` (0–3 fletes, **`precio_gl` = tarifa POR GALÓN** —migración 012; el total se calcula = tarifa × galones aplicables. Verificado contra la hoja: 3650 gl × 0.28 = S/1022.00, 4410 gl × 0.25 = S/1102.50—, `aplica_a text[]` de códigos —null=todos—, estado pagado/pendiente, fecha_pago). RLS **solo admin+**.
- **`fn_guardar_compra(p jsonb)`**: guarda cabecera+líneas+fletes de forma **atómica** (en edición borra y reinserta líneas/fletes). SECURITY INVOKER: la RLS exige admin+. El borrado usa `DELETE` directo sobre `compras` (CASCADE).
- **UI** (`src/features/admin/compras/`): `ComprasPage.tsx` ya enruta la pestaña **Registro** a `RegistroComprasPage.tsx` (antes placeholder). Tabla estilo hoja "COMPRAS" (galones y precio/gl por producto Diesel/Premium/Regular, monto pagado = Σ galones×precio, flete, estado, **utilidad/gl** = precio de venta actual de `precios_diarios` − precio de compra, en verde/rojo) + fila de TOTALES. `CompraModal.tsx` (overlay propio más ancho que `.modal-box`) para alta/edición: fecha, proveedor, 3 líneas de producto, hasta 3 fletes con checkboxes de "aplica a".
- Dinero: precio/gl en soles 4 dec (efímero-preciso como el cotizador); montos de flete en céntimos (`toCentimos`). `npx tsc --noEmit` OK.

## Cambios de esta sesión (2026-07-06)

### OSINERGMIN — desempate de ranking + gráfico de evolución
1. **Desempate del ranking por fecha de registro** (`osinergmin-cron`): a IGUAL precio, va primero el grifo que registró su precio antes (columna `FECHA_*` del Excel; candidatas `FECHA_HORA/FECHA_PRECIO/FECHA_REGISTRO/FECHA_ACTUALIZACION/FECHA`, acepta serial de Excel o texto dd/mm/yyyy). El puesto ahora es la **posición real en la lista desempatada** (`ourIdx + 1`, antes `count(precio menor)+1` que daba puestos compartidos en empate, inconsistente con el Top 10). Sin columna de fecha → se respeta el orden del Excel (sort estable). **⚠️ Requiere redeploy**: `npx supabase functions deploy osinergmin-cron --project-ref acvavpzdeichdvsgblcn --no-verify-jwt`.
2. **Gráfico "Evolución de tu ranking"** (`OsinergminPage`): SVG a mano (sin dependencias), tipos **LÍNEAS/BARRAS** conmutables, filtro por producto (chips-leyenda, mínimo 1 activo; el color SIGUE al producto: DB5 azul `#2a78d6`, Regular aqua `#1baf7a`, Premium ámbar `#eda100` — paleta validada con el validador de dataviz sobre blanco), **eje Y invertido** (#1 arriba = mejor), tooltip por snapshot (puesto, total estab., precio), crosshair, etiquetas al final de línea con anti-colisión, ResizeObserver para ancho. Preferencias persistidas (`osinergmin.grafico.*`). La tabla de detalle se mantiene debajo como respaldo accesible.
   - **Rango de fechas propio del gráfico** (añadido 2026-07-06): el `RankingChart` ya NO recibe `snapshots` por prop; **carga su propia serie** por rango `fecha_consulta` (DESDE/HASTA, se escribe o se elige en calendario con botón 📅 encadenado + presets 7d/30d/90d/1a; default últimos 30 días). Se desacopla del límite de 30 de la página. La página le pasa `refreshKey={actual?.id}` para que re-consulte cuando Realtime trae un snapshot nuevo.
   - **Comparativo "Nº empresas"** (toggle): añade una línea gris punteada con el `total_establecimientos` del distrito. Como el ranking y el total de empresas son la MISMA unidad (posiciones), se dibuja en el MISMO eje (NO es doble eje — regla dataviz): al activarlo, `yMax` sube hasta el total de empresas y las líneas de producto se ven "en contexto" (#5 de 12 ≠ #5 de 60). El total también sale en el tooltip.

### Seguimiento (CorporativoPage) — rework mayor
3. **Filtro de rango DESDE/HASTA** reemplaza el switch MES/DÍA: dos `input type="date"` (se puede escribir o abrir calendario), botón 📅 que abre el calendario de "desde" y encadena el de "hasta" (`showPicker()`), botón "Mes actual". Default: mes en curso completo. Si el rango se cruza, se auto-corrige. Persistido (`seguimiento.desde/hasta`).
4. **Columna VARIACIÓN eliminada** (y su cálculo + query a `precios_diarios`): el descuadre por redondeo se ve en la columna REDONDEO de Ventas. La tabla quedó en 15 columnas con `table-fixed` + anchos explícitos (minWidth 1420).
5. **Edición EN LÍNEA (sin modal)**: "Editar" resalta la fila (`!bg-blue-50`) y **opaca el resto** (`opacity-30 pointer-events-none`); los inputs quedan en las mismas celdas + una fila secundaria (DNI, empresa/fecha facturación, fecha pago) con Guardar/Cancelar. El modal quedó SOLO para "+ Nuevo registro". Recargar/cambiar filtros cancela la edición.
6. **Historial de auditoría por registro**: clic en cualquier fila (fuera de controles) abre el modal "Historial de cambios" — lee `registro_ventas_log` por el **uuid** del registro; muestra acción (Creado/Modificado/Papelera/Restaurado), fecha/hora, autor (join manual a `profiles`) y el **diff campo a campo** (antes → después, con formato de moneda/catálogos).
7. **Soft delete + Papelera**: eliminar = marcar `deleted_at/deleted_by` (nada se borra físicamente). Toggle **🗑 Papelera** en la barra: muestra solo eliminados con botón "↩ Restaurar". Las consultas normales filtran `.is('deleted_at', null)`.
8. **Fix conexión Ventas↔Seguimiento**: el insert de "Nuevo registro" NO enviaba `colaborador_id` (NOT NULL) → fallaba **silenciosamente** (tampoco se leía `error`). Ahora envía `profile.id` y todas las operaciones (guardar/toggle pago/eliminar/restaurar) alertan si Supabase devuelve error. Ambos módulos siguen sobre la MISMA tabla `registro_ventas`; los registros rápidos de Ventas aparecen en Seguimiento y viceversa.

### Ventas (VentasDelDiaPage)
9. **Ancho de tablas FIJO (no dinámico)**: la Tabla de Turnos y la tabla de Registros (modo Completo) pasaron a `table-fixed` con `minWidth` = suma exacta de columnas (1390/1094 y 1200) — el contenido largo (nombres de cliente en selects, montos) ya NO ensancha la tabla; si no entra, scroll horizontal del contenedor.
10. **Soft delete también aquí**: "Eliminar" marca `deleted_at/deleted_by` (recuperable desde Seguimiento→Papelera); `loadDia` y el chequeo de "Corregir fecha" filtran eliminados.

### Base de datos — migración 013 (⚠️ PENDIENTE DE APLICAR en Supabase)
- `013_registro_ventas_auditoria_softdelete.sql`:
  - `registro_ventas.deleted_at/deleted_by` + índice parcial.
  - Tabla `registro_ventas_log` (jsonb old/new, `usuario_id = auth.uid()`, sin FK para sobrevivir a borrados físicos) + trigger `trg_audit_registro_ventas` (SECURITY DEFINER) que registra INSERT/UPDATE/SOFT_DELETE/RESTORE/DELETE y omite updates sin cambios.
  - RLS: log SELECT solo admin+; en `registro_ventas` se reemplazó la política `FOR ALL` por políticas por operación — **DELETE físico solo superadmin** (la app ya no lo usa).
  - **La UI de Seguimiento/Ventas consulta `deleted_at` y el log → aplicar la migración ANTES de desplegar este build.**

### Otros
- **Fix build pre-existente**: `npm i -D @types/node` + `vite.config.ts` migrado de `path/__dirname` a `fileURLToPath(new URL(...))`; `CompraModal.tsx` tipa `productosEnCompra: string[]` (error TS2345). `npm run build` (tsc -b + vite) ahora pasa en verde.

## Cambios de esta sesión (2026-07-07)

### OSINERGMIN — el gráfico mostraba puestos distintos a las tarjetas
1. **Fix desfase gráfico ↔ tarjetas** (`OsinergminPage`): el gráfico daba 2/3/3 cuando las tarjetas (último snapshot) decían 2/5/4 porque su serie propia dejaba fuera el snapshot más reciente. Tres causas corregidas:
   - **`fecha_consulta` es `timestamptz`** pero el filtro comparaba contra el texto `YYYY-MM-DD` (medianoche UTC) → recortaba las últimas 5 h del día en Perú (UTC-5), justo donde cae el snapshot del cron. Ahora manda instantes UTC (`new Date(\`${desde}T00:00:00\`).toISOString()` … `T23:59:59.999`).
   - **`hasta` se guardaba como fecha absoluta** en localStorage → al día siguiente excluía lo nuevo. Ahora **sigue a "hoy"** salvo que el usuario lo fije a mano (`osinergmin.grafico.hastaSigueHoy`; `aplicarHasta()` decide).
   - **`refreshKey`** ahora es `${id}:${fecha_consulta}` (antes solo `id`): cuando el Top 10 no cambia, el cron solo refresca `fecha_consulta` del MISMO snapshot y el gráfico no re-consultaba.

### Seguimiento (CorporativoPage) — encabezado configurable + quitar DOC
2. **Columna DOC eliminada**: todos los registros son vales → se quitó `tipo_documento` del tipo `RegistroRow`, `FormState`, `FORM_INIT`, el modal, la edición en línea y `CAMPOS_LOG`. Al **insertar** se manda fijo `tipo_documento: TIPO_DOC_FIJO` ('vale') porque la columna es `NOT NULL` con CHECK en BD; en **update** ya no se toca.
3. **"Editar encabezado"** (botón nuevo junto a 🗑 Papelera): panel para **mostrar/ocultar** columnas (checkbox), **reordenar arrastrando** (⠿, HTML5 drag&drop) y **Restablecer**. Es SOLO presentación — los datos siempre se guardan/traen completos desde Ventas. Preferencia persistida (`seguimiento.columnas`). TICKET y DNI se **añadieron** como columnas (antes no estaban en la tabla) y salen **ocultas por defecto** (`PREFS_DEFECTO`). Si editas y una columna está oculta, su campo aparece igual en la fila secundaria de edición (para que ocultar nunca impida corregir). La tabla, los `<th>`, los totales y "pendiente de cobro" se generan **dinámicamente** desde `cols` (`filaTotales()` calcula los `colSpan`).
   - **⚠️ AL AGREGAR UNA COLUMNA NUEVA A SEGUIMIENTO en el futuro**: hay que registrarla en el arreglo **`COLUMNAS`** (key/label/width) al inicio de `CorporativoPage.tsx`, y añadir su `case` en **`controlEdicion()`** (input de edición), **`contenidoVista()`** (modo lectura) y **`CLASE_VISTA`** (tipografía de la celda). Con eso aparece automáticamente en el editor de encabezado (checkbox + arrastre) y en la tabla; no hay que tocar el `<thead>`/`<tbody>` a mano. Si la columna es numérica, agregar también su alineación en `COL_ALIGN` y, si debe sumarse, su valor en las llamadas a `filaTotales()`. Por defecto queda visible salvo que se excluya en `PREFS_DEFECTO`.

### Ventas (VentasDelDiaPage) — modo COMPLETO
4. **`VALE` → `VALE LIC.`** en el encabezado de la tabla de vales (modo Completo).
5. **PLACA ↔ TICKET intercambiadas**: el orden pasó a VALE LIC. · **TICKET** · **PLACA** (antes VALE · PLACA · TICKET), tanto en la fila de entrada rápida como en las filas editables. Los campos subyacentes no cambian (`numero`/`serie`/`placa`); solo el orden visual de las celdas.

- `npx tsc -p tsconfig.app.json --noEmit` verificado sin errores.

## Cambios de esta sesión (2026-07-08)

### Tema oscuro GLOBAL (claro/oscuro)
1. **Sistema de tema por variables CSS** (`src/index.css` + `tailwind.config.ts`): los tokens de color de Tailwind (`primary`, `success`, `app.bg/surface/border/muted/text`, etc.) ahora se resuelven vía `rgb(var(--c-…) / <alpha-value>)`. Se definen dos juegos de variables en `:root` (claro) y `:root[data-theme='dark']` (oscuro, estilo Supabase: superficies slate oscuras + texto claro). Al cambiar `data-theme` en `<html>`, TODA la app se re-tematiza sola — cualquier clase `bg-primary`, `text-app-text`, `border-app-border`… adapta sin tocar componentes.
2. **Overrides para utilidades de color fijo**: las clases Tailwind con color literal que NO pasan por tokens (`bg-white`, `bg-slate-50/100`, `text-slate-*`, `text-green-*`, `bg-blue-50`, `bg-amber-50`, etc.) se sobreescriben bajo `:root[data-theme='dark'] .clase { … }` (mayor especificidad → ganan sin `!important`). Variantes con `!important` (p. ej. `!bg-blue-50` de la fila en edición de Seguimiento) tienen su propio override con `!important`.
3. **Celdas de color de Ventas → variables**: los ~55 colores hex inline de `VentasDelDiaPage.tsx` pasaron a variables temáticas (`--c-hl-credit`, `--c-hl-cash`, `--c-hl-warn`, `--c-pos-fg`, `--c-neg-fg`, …), con valor claro y oscuro.
4. **`ThemeProvider` + `ThemeToggle`**: `src/lib/theme.tsx` (contexto, recuerda preferencia en `localStorage` clave `app.theme`, respeta el SO la 1ª vez) y `src/components/ThemeToggle.tsx` (botón ☀️/🌙). Toggle colocado en la barra del Admin, Home del grifero, Cierre, Varillaje y Login. `main.tsx` fija `data-theme` **antes** del primer render (sin parpadeo) y envuelve con `<ThemeProvider>`. `color-scheme` oscurece controles nativos (fechas, selects, scrollbars).
5. **Gráfico OSINERGMIN tematizado** (`OsinergminPage` `RankingChart`): los atributos de presentación SVG (`stroke`/`fill`) **no** resuelven `var()` de CSS, así que el gráfico lee el tema con `useTheme()` y usa una paleta `CHART` clara/oscura (rejilla, ejes, etiquetas, aro de puntos). Los colores de serie (DB5/Regular/Premium) se mantienen. Este era el motivo de que OSINERGMIN "casi no cambiara" en oscuro.

### Ventas (VentasDelDiaPage)
6. **Fix 400 (Bad Request) al escribir la fecha a mano**: al teclear en `<input type="date">` el valor queda vacío/incompleto → se consultaba Supabase con `fecha=eq.` (vacío) → 400. Nuevo helper `esFechaValida()` en `lib/date.ts`; `loadDia` y `handleFixDate` ignoran la carga hasta que la fecha sea completa y real.
7. **Comboboxes (Cliente, Producto, Turno)**: nuevo componente reutilizable `src/components/Combobox.tsx` — editable (se escribe para filtrar) pero **solo guarda un valor que coincida** con una opción; sin coincidencia al salir, revierte (no persiste texto libre). Menú `position: fixed` para no ser recortado por el `overflow` de las tablas; teclado (flechas/Enter/Escape). Turno usa opciones 1–4 (solo reconoce 1 a 4). Reemplaza los `<select>` de Cliente/Producto/Turno en la fila de alta, la edición en línea y el crédito rápido. `handleRegBlur(id, override?)` acepta el valor recién confirmado para no depender de estado stale.

- `npm run build` (tsc -b + vite) verificado en verde.

### ⚠️ Nota de despliegue en desarrollo (Vite)
Cambios en **`tailwind.config.ts`** o en la definición de **variables/tema en `index.css`** (nuevas clases utilitarias, `@layer`, tokens) requieren **reiniciar el servidor de Vite** (`Ctrl+C` y `npm run dev`), NO basta `Ctrl+Shift+R`: Vite/PostCSS solo regeneran el CSS de Tailwind al arrancar o cuando cambia un archivo observado, y añadir clases nuevas puede no invalidar el caché de HMR. Cambios solo en JSX/TS/valores existentes sí refrescan con `Ctrl+Shift+R`. Ver **BUENAS_PRACTICAS.md §12**.

## Correcciones de arquitectura importantes (histórico)
- **AuthContext** (`src/features/auth/AuthContext.tsx`) — contexto de auth compartido. `useAuth.ts` re-exporta desde él. `main.tsx` envuelve con `<AuthProvider>`. Evita múltiples instancias de `useAuth` con race conditions.
- **Fix refresh al minimizar** — `onAuthStateChange` ignora `TOKEN_REFRESHED` y `SIGNED_IN` si ya hay perfil cargado (usa `profileRef`).
- **Refresco Silencioso (Flicker-Free)** — la recarga tras guardar en `VentasDelDiaPage` se hace en segundo plano sin desmontar la UI.
- **Robustez de carga** — todo `load*` con `try/catch/finally`; los datos de Supabase se validan con `Array.isArray` antes de iterar (el tipo puede venir como `GenericStringError`).

## Convenciones / utilidades nuevas en `lib/`
- **`useHardenNumberInputs.ts`** — hook global (1 llamada en `App.tsx`) que endurece todos los inputs numéricos. Para futuros inputs: basta `type="number"`, ya queda cubierto. (`-` bloqueado en todos; si algún campo necesitara negativos, hacer el hook configurable.)
- **`usePersistedState.ts`** — `useState` que persiste en `localStorage`. Usar para filtros; claves con prefijo de módulo (`'seguimiento.mes'`). Pesa bytes → no satura el navegador.
- Convenciones documentadas en **BUENAS_PRACTICAS.md §6** (rev 4).

## Módulos pendientes (admin)

| Módulo | Ruta | Estado | Descripción |
|--------|------|--------|-------------|
| **Compras** | `/compras` | ✅ Cotizador + Registro | Ambas pestañas construidas. Cotizador (comparador de proveedores, stock del varillaje) y **Registro de Compras** (cabecera+líneas+fletes, ver parte 3). Imágenes: `COMPRA_GALONES.png`, `COMPRA_COMBUSTIBLE.png` |
| **OSINERGMIN** | `/osinergmin` | ✅ CONSTRUIDO | Ranking por distrito, manual (navegador) + cron horario (servidor) + Realtime. Ver sesión 2026-07-05 parte 2. |

## Módulos pendientes (grifero)
- (Varillaje ✅ construido en 2026-07-05 parte 2)

## Infraestructura pendiente
- ~~Enlazar Varillaje ↔ Compras~~ ✅ hecho (2026-07-05 parte 3, migración 010 `fn_stock_actual`).
- ~~Registro de Compras~~ ✅ hecho (2026-07-05 parte 3, migración 011).
- PWA kiosk mode: Chrome `--kiosk` config.
- Cloudflare Pages CI/CD + Zero Trust.

## Gotchas conocidos (para futuras sesiones)
- **Supabase 502 / CORS al cargar**: es infra, NO código. Probable proyecto pausado (plan free se pausa por inactividad) → reactivar en el dashboard de Supabase. El código ya no queda atascado si ocurre.
- ~~`npm run build` falla en `vite.config.ts` (faltaba `@types/node`)~~ ✅ corregido 2026-07-06 (`@types/node` instalado + `fileURLToPath`); `npm run build` en verde.
- **Lint**: el repo arrastra muchos `no-explicit-any` pre-existentes; `npm run lint` no está en verde. El build no usa eslint.

## Estructura de archivos clave
```
src/
  features/
    auth/
      AuthContext.tsx         — contexto compartido (AuthProvider + useAuth)
      useAuth.ts              — re-exporta desde AuthContext
    grifero/
      HomePage.tsx
      GriferoLayout.tsx
      cierre/
        CierreCajaPage.tsx
        DenomCounter.tsx
        ValeModal.tsx
      varillaje/VarillajePage.tsx
    admin/
      AdminLayout.tsx
      ventas/
        VentasDelDiaPage.tsx     ← MÓDULO UNIFICADO Y COMPLETADO
      corporativo/
        CorporativoPage.tsx      ← MÓDULO "SEGUIMIENTO" (ruta /seguimiento)
      configuracion/
        ConfiguracionPage.tsx
        _helpers.tsx
        TurnosSection.tsx
        TiposCombustibleSection.tsx
        TanquesSection.tsx
        EmpresasSection.tsx
        ProveedoresSection.tsx
        AppConfigSection.tsx
  components/
    Combobox.tsx              ← combobox editable (match-only-commit), menú fixed
    ThemeToggle.tsx           ← botón ☀️/🌙 (usa useTheme)
    MultiSelectDropdown.tsx   ← selección múltiple con checkboxes
  lib/
    supabase.ts
    money.ts                  — toCentimos, formatSoles, formatSolesRaw, sumCentimos
    date.ts                   — hoyLocal, formatFecha, formatHora, esFechaValida
    theme.tsx                 ← ThemeProvider + useTheme (data-theme en <html>, localStorage)
    useHardenNumberInputs.ts  ← endurece inputs numéricos (global)
    usePersistedState.ts      ← useState + localStorage (filtros)
  types/index.ts              — interfaces TypeScript
  index.css                   — variables de tema claro/oscuro (:root / [data-theme=dark]), overrides dark de utilidades, .table-excel (36px/14px), spinners off, .btn-*, .input, .card, .modal-*, .badge-*
  App.tsx                     — guards de auth + rutas por rol + useHardenNumberInputs()
  main.tsx                    — aplica data-theme temprano + <ThemeProvider> → <AuthProvider> → <QueryClientProvider> → <App>
  features/admin/
    osinergmin/
      OsinergminPage.tsx        ← ranking /osinergmin (Realtime + auto-refresco); botón manual invoca osinergmin-cron
    configuracion/
      OsinergminSection.tsx     ← config link + RUC
      TanqueLayoutEditor.tsx    ← grilla drag&drop de tanques
      TanqueAforoModal.tsx      ← pegar tabla de aforo cm→galones
supabase/
  functions/
    osinergmin-cron/index.ts    ← ÚNICA función OSINERGMIN: descarga+parseo(fflate)+ranking+guardado; sirve al cron y al botón manual
  config.toml                   ← verify_jwt=false para osinergmin-cron
  migrations/
    001_schema_completo.sql
    002_app_config_admin_write.sql  ← aplicada
    003_precios_diarios_audit_log.sql
    004_dscto_vales_editable.sql
    005_varillaje.sql               ← tanque_aforo, varillaje_lecturas, layout
    006_varillaje_volumen_server.sql ← trigger cm→galones, RLS aforo
    007_osinergmin_config_cron.sql  ← claves app_config OSINERGMIN
    008_osinergmin_cron_horario.sql ← pg_cron horario (x-cron-secret)
    009_osinergmin_realtime.sql     ← Realtime en osinergmin_snapshots
    010_varillaje_stock_cotizador.sql ← fn_stock_actual() (Varillaje→Cotizador)
    011_registro_compras.sql        ← compras + compra_lineas + compra_fletes + fn_guardar_compra()
    012_flete_por_galon.sql         ← flete por galón (compra_fletes.precio_gl) + RPC actualizada
    013_registro_ventas_auditoria_softdelete.sql ← ⚠️ POR APLICAR: log auditoría + soft delete registro_ventas
```

**Why:** Registrar el estado exacto para que futuras sesiones puedan continuar sin re-derivar qué se hizo.
**How to apply:** Al iniciar nueva sesión, leer este archivo y preguntar al usuario qué módulo construir a continuación. Próximos candidatos: **Compras** u **OSINERGMIN** (ambos placeholders), o **Varillaje** (grifero).
