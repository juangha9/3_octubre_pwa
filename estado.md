---
name: proyecto-grifo-estado
description: "Estado actual de construcción del Sistema Grifo — qué está hecho, qué falta, dónde nos quedamos"
metadata:
  node_type: memory
  type: project
  originSessionId: 2846fb7a-3ed9-41a7-bca2-7b57da65d443
---

Última actualización: **2026-07-16** (**LOCAL-FIRST fases 1-2 CONSTRUIDAS**: Ventas y Seguimiento leen/escriben en IndexedDB (Dexie) con outbox + sync worker + badge de estado; ⚠️ falta **aplicar la migración 016** para que el sync funcione — ver sección 2026-07-16)

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
  - **Tabla de Turnos**: **grid tipo hoja de cálculo** (mismo motor que la de vales, ver sesión 2026-07-12). Consola, yape, openpay, depósito, dsctos vales, pruebas, redondeo y colaborador se editan celda a celda y guardan al confirmar, con **refresco silencioso (flicker-free)**. Guarda en `cierres_caja`.
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
- **Excel real**: `Imágenes soporte/Ultimos-Precios-Registrados-EVPC (1).xlsx`, 1 hoja, ~17k filas. Link: `https://www.osinergmin.gob.pe/seccion/centro_documental/hidrocarburos/SCOP/SCOP-DOCS/2026/Registro-precios/Ultimos-Precios-Registrados-EVPC.xlsx`. Cabecera real (18 cols): `NRO_REGISTRO, RUC, RAZON, DEPARTAMENTO, PROVINCIA, DISTRITO, DIRECCION, FCHA_REGISTRO, COD_PRODUCTO, PRODUCTO, PRECIO_VENTA, UNIDAD, CODIGO_OSINERG, ACTIVIDAD, COD_ACTIVIDAD, MARCA, ULT_PRECIO_DIF_CERO, PRODUCTO_ACTIVO`. ⚠️ La fecha es **`FCHA_REGISTRO`**, sin la "E" (typo del propio OSINERGMIN). Una fila por establecimiento×producto. Mapeo producto (coincide con `tipos_combustible.nombre_osinergmin`): DB5→'Diesel B5 S-50 UV', REGULAR→'GASOHOL REGULAR', PREMIUM→'GASOHOL PREMIUM'.
- **Ranking (reescrito 2026-07-10, migración 015)** — tres reglas que NO se pueden relajar, cada una nació de un bug real:
  1. **La zona es DEPARTAMENTO+PROVINCIA+DISTRITO.** Filtrar solo por distrito mezclaba mercados: hay **36 distritos homónimos** en el Excel y MIRAFLORES existe en Arequipa **y en Lima** — el ranking del grifo se calculaba contra 110 filas (41 Arequipa + 69 Lima) y el "total establecimientos" salía 15 en vez de 12.
  2. **Compite el ESTABLECIMIENTO (`CODIGO_OSINERG`), no el RUC.** Una empresa puede tener varios grifos en el mismo distrito (**310 casos** en el país; COESTI tiene 2 en Miraflores). El dedup por RUC borraba al segundo → desaparecía un competidor del Top 10 y todos los de abajo subían un puesto.
  3. **Desempate determinista**: precio asc → `FCHA_REGISTRO` asc (quien registró antes gana) → `CODIGO_OSINERG`. Sin el tercer criterio los empates quedaban al orden crudo del Excel y el puesto bailaba entre corridas.
  - Además: descarta `PRODUCTO_ACTIVO='NO'` y `precio<=0`. Las columnas se resuelven por **alias canónico** (`canon()`: sin tildes ni guiones bajos); si falta una **obligatoria** la función aborta con 422 + la cabecera recibida, y si falta una **opcional** lo devuelve en `avisos` (la app lo muestra). Un cambio de cabecera nunca debe degradar el ranking en silencio — así se coló meses el desempate roto (buscaba `FECHA_REGISTRO`, el Excel trae `FCHA_REGISTRO`).
  - Guarda `osinergmin_snapshots` (ranking+precio por producto, **zona completa**, total de la zona + **total por producto** = el "de N" de las tarjetas, `fecha_consulta`) + `osinergmin_top10` por producto (con `codigo_osinerg`, `direccion` y flag `es_nuestro`). El top10 **CRECE** hasta incluir tu grifo si queda fuera del 10.
  - ⚠️ Los snapshots **anteriores** a la migración 015 se calcularon con el algoritmo viejo (zona contaminada, competidores faltantes): el histórico previo a esa fecha no es fiable.
- **FUENTE DE DATOS — decidido 2026-07-10, NO volver a replantearlo sin leer esto:**
  - Se usa el Excel **EVPC** (`Ultimos-Precios-Registrados-EVPC.xlsx`, ~17k filas, estaciones de venta al público). Se descarga de la página SCOP → "Registro de últimos precios".
  - ⚠️ **El Excel y la web de OSINERGMIN (facilito) NO están sincronizados.** Facilito consulta una base viva; el Excel es un volcado. El 2026-07-10 la web listaba **13** grifos con Gasohol Regular en Miraflores y el Excel solo **12**: faltaba `GRUPO CONSTRUCTOR FAMEK S.A.C` (17.56, AV. PRO HOGAR N° 406). Se buscó `FAME`/`HOGAR`/`CONSTRUCTOR` en RAZON y DIRECCION en las 17k filas del Excel en vivo: **no existe en el archivo, en ningún distrito del país**. No es un bug del cron ni una variante de escritura. La app lo advierte en pantalla (nota de fuente en `OsinergminPage`).
  - **Facilito NO se puede consumir desde el servidor**: `buscadorEESS.jsp` hace POST a `PreciosCombustibleAutomotorAction.do` con un **token de reCAPTCHA v3** generado en el navegador. Usarlo exigiría derrotar el CAPTCHA → descartado (es la barrera anti-bot que pusieron a propósito, y el Excel es el canal que sí publican para consumo automático).
    - ⚠️ **REVISADO 2026-07-14 — esta conclusión era incompleta.** El reCAPTCHA v3 gatea SOLO el **POST** del navegador; el MISMO action por **GET** devuelve los datos **sin token**. **Facilito SÍ es consumible server-side** y es más fresco que el Excel. NO se bypassea nada (es un GET a datos públicos). Endpoint, códigos y prueba de frescura en la **sesión 2026-07-14**.
  - **El otro archivo, `Ultimos-precios-registrados-DMAY.xlsx`, NO sirve para el ranking**: 532 filas, todas de actividad `DISTRIBUIDOR MAYORISTA DE COMBUSTIBLES LIQUIDOS`. Son los **mayoristas que nos venden**, no la competencia (ni ALEXMATH ni FAMEK aparecen). 💡 Candidato para el **Cotizador de Compras** como referencia de precio mayorista.
- **UNA sola Edge Function `osinergmin-cron`** hace TODO en el servidor (descarga + parseo + ranking + guardado) con lector liviano **fflate + lectura directa del XML**. Se usó fflate porque SheetJS con 17k filas revienta el edge (**error 546 WORKER_LIMIT**); el lector liviano es ~120–200ms y está validado como idéntico a SheetJS. La disparan los dos caminos:
  - **Manual** (botón "Actualizar precios ahora"): el navegador invoca `osinergmin-cron` como **superadmin** (~5s). Antes se descargaba y parseaba en el navegador con `xlsx` (~20s); **se eliminó** ese rodeo, la función `osinergmin-update` y la dependencia `xlsx` (2026-07-05 parte 2, unificación).
  - **Automático** (cron horario): pg_cron invoca `osinergmin-cron` con el header `x-cron-secret`.
  - Ambos: dedup por TODO el top10 (competencia incluida) — si nada cambió, NO duplica, solo refresca `fecha_consulta`. Escribe por service_role. Requiere CORS + OPTIONS en la función (para el botón).
- **Cron** (migración 008, pg_cron + pg_net): `0 * * * *` (cada hora en punto; UTC, pero Perú UTC-5 entero → coincide con :00 local). Auth por **header propio `x-cron-secret`** (NO service_role en `Authorization`: el gateway de Supabase lo transforma → daba 401). El secreto vive en `CRON_SECRET` (secreto de la función vía `supabase secrets set`) y en el header del cron SQL. Corre 24/7 en el servidor, independiente del navegador/Cloudflare.
- **OsinergminPage** (`/osinergmin`): tarjetas de posición (#ranking + precio + "de N **que lo venden**", no el total del distrito), Top 10 por producto (tu grifo resaltado, tabla `table-fixed`, nombre con `line-clamp-2` + **dirección debajo** — sin ella, dos grifos de la misma empresa se leen idénticos), evolución del ranking. **Auto-refresco por Realtime** (migración 009): suscripción a `osinergmin_snapshots`; la BD **empuja** el cambio y la app re-consulta sola (sin polling ni F5). "(hace X)" derivado de la `fecha_consulta` real. Focus-refetch como red de seguridad.

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

### Base de datos — migración 013 (✅ APLICADA en Supabase)
- `013_registro_ventas_auditoria_softdelete.sql`:
  - `registro_ventas.deleted_at/deleted_by` + índice parcial.
  - Tabla `registro_ventas_log` (jsonb old/new, `usuario_id = auth.uid()`, sin FK para sobrevivir a borrados físicos) + trigger `trg_audit_registro_ventas` (SECURITY DEFINER) que registra INSERT/UPDATE/SOFT_DELETE/RESTORE/DELETE y omite updates sin cambios.
  - RLS: log SELECT solo admin+; en `registro_ventas` se reemplazó la política `FOR ALL` por políticas por operación — **DELETE físico solo superadmin** (la app ya no lo usa).
  - La UI de Seguimiento/Ventas consulta `deleted_at` y el log.

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
7. **Combobox editable** (`src/components/Combobox.tsx`): componente reutilizable — editable (se escribe para filtrar) pero **solo guarda un valor que coincida** con una opción; sin coincidencia al salir, revierte (no persiste texto libre). Menú `position: fixed` (no lo recorta el `overflow` de las tablas); teclado (flechas/Enter/Escape); opciones con `tabIndex={-1}` para que Tab salga directo a la celda siguiente (antes hacía falta pulsar Tab 2 veces). Prop `id` opcional para enfocar el input por programación. **Se usa solo en CLIENTE** (fila de alta y edición en línea) y en el turno del crédito rápido (Abreviado). `handleRegBlur(id, override?)` acepta el valor recién confirmado para no depender de estado stale.
8. **PRODUCTO y TURNO → `<select>` nativo con selección por tecla** (decisión de UX: el combobox resultó incómodo ahí): se revirtieron a `<select>`, pero con `onKeyDown` propio que selecciona **al instante con cada tecla** y hace `preventDefault()` (el typeahead nativo acumula teclas en un búfer ~1s y se trababa: R,P,D → "RPD" sin coincidencia). Helpers `combustibleCodigoPorTecla` (D→DB5, R→REGULAR, P→PREMIUM, por inicial del código) y `turnoIdPorTecla` (1–4 → turno por posición). Aplica en fila de alta y edición en línea.
9. **Foco a CLIENTE tras Enter en GALONES**: al crear la fila (Enter en galones), el foco vuelve al combobox de CLIENTE (`id="venta-nuevo-cliente"`) para encadenar el siguiente registro sin ratón.
10. **Arrastre de TURNO y PRODUCTO en la fila nueva** (intencional, documentado en `saveRegistro`): al guardar se conservan `turno_id`, `tipo_atencion` y `tipo_combustible` del registro anterior; el resto se limpia. Acelera el registro de varios vales del mismo turno/combustible.
11. **Botón "+ Agregar" movido a la columna ACCIONES** (antes estaba en VARIACIÓN); VARIACIÓN muestra "—" en la fila de alta.

### Seguimiento (CorporativoPage)
12. **Columna ACCIONES configurable**: la columna de botones (Historial / Editar / Eliminar) pasó a ser un miembro más de `COLUMNAS` (key `'acciones'`), así aparece en **"Editar encabezado"** con checkbox de visibilidad y **reordenable** por arrastre, como el resto. En modo lectura `contenidoVista('acciones')` pinta los botones (o Restaurar en papelera); en edición `controlEdicion('acciones')` pinta Guardar/Cancelar. Se quitó la `<th>`/`<td>` fija del final y la constante `ANCHO_ACCIONES` (ahora es `width` en `COLUMNAS`); `colSpan`/`anchoTabla`/`filaTotales` ya no suman una columna extra. Nota: al agregar futuras columnas seguir la guía del bloque 2026-07-07 (registrar en `COLUMNAS`, `controlEdicion`, `contenidoVista`, `CLASE_VISTA`, y `COL_ALIGN` si es numérica).
13. **Historial "Creado" con TODOS los campos**: la entrada INSERT del historial mostraba solo galones/producto/importe/empresa; ahora lista **todos** los campos con los que se creó la fila (conductor, DNI, placa, ticket, vale, fecha, turno, precio, factura, estado…) recorriendo `CAMPOS_LOG` sobre `datos_new` (omite vacíos) en una tabla campo → valor.

- `npm run build` (tsc -b + vite) verificado en verde. Commit `d0999af` (push a `main`).

## Cambios de esta sesión (2026-07-09)

### Tema oscuro — variantes `hover:` con color fijo
1. **Los desplegables de Seguimiento se resaltaban en blanco sobre texto claro**: el bloque de overrides de `index.css` redefinía `.bg-white` / `.bg-slate-50`, pero Tailwind emite la variante hover como una **clase distinta** (`.hover\:bg-slate-50:hover`) que esas reglas no alcanzaban. Se añadieron los overrides de las variantes hover (mayor especificidad → ganan sin `!important`). Cubre `MultiSelectDropdown`, "Editar encabezado", OSINERGMIN y Ventas. El `<select>` de Estado nunca falló: lo pinta el navegador vía `color-scheme: dark`.

### Ventas (VentasDelDiaPage) — grid tipo hoja de cálculo en modo COMPLETO
2. **Nuevo `src/components/CeldaGrid.tsx`**: celda con semántica de Sheets. Un clic **selecciona** sin entrar en edición; Enter / F2 / doble clic / teclear encima montan el editor. El `<input>` solo existe mientras se edita: así el foco vive en el `<td>` y las flechas navegan en vez de mover el cursor. *Roving tabindex* (solo la celda activa es tabulable).
   - **Señal de la celda activa** (`.celda-activa`, `index.css`): marco sólido de 2px + **halo que late** hacia afuera + tirador en la esquina inferior derecha (como Excel), y la **fila se tiñe** (`tr:has(td.celda-activa)`). El color es el token propio `--c-sel-ring` (el `primary` de la app es un azul de fondo, como borde no se distinguía de la rejilla). El halo va en `box-shadow` de un `::before` → **no ocupa espacio: el latido no mueve la tabla** (`::after` está tomado por `.celda-copiada`; una celda puede estar seleccionada y copiada a la vez). Con `prefers-reduced-motion` se apaga el latido y quedan marco+tirador+fila.
   - **Columnas del grid = posición en el `<tr>`, de 1 a 11** (FECHA=0 y ACCIONES=12 quedan fuera). Al añadir/mover columnas hay que actualizar `CAMPO_POR_COL`, `COLS_TEXTO`, `COL_MAX` y los índices literales de `onGridKeyDown` (7=TURNO, 8=PRODUCTO, 9=GALONES, 1=CLIENTE).
3. **Teclado**: flechas navegan; Ctrl+C copia la celda (con **"marching ants"** animadas, `.celda-copiada`, borde de guiones en `::after`); Ctrl+V pega solo en columnas de texto libre (`COLS_TEXTO`); Supr/Retroceso las vacían; teclear reemplaza; en TURNO/PRODUCTO la tecla (1-4 / R,P,D) aplica el valor sin abrir el `<select>`.
4. **Ctrl+Z — un solo nivel, solo celdas**: `ultimoCambio` guarda `{id, campo, anterior}`. No deshace altas ni bajas (las bajas van a Papelera). **`bloquearDeshacerFueraDelGrid`** (`onKeyDownCapture` en la raíz de la página) **bloquea el Ctrl+Z/Ctrl+Y nativo fuera del grid**: los inputs de precios y de turnos guardan en `onBlur`, así que un deshacer nativo revertía el texto sin verse y el blur persistía el valor viejo (llegó a reescribir el precio de un producto).
5. **Fecha persistente**: `sessionStorage['ventas.fecha']`. Sobrevive a cambiar de pestaña (la página se desmonta), pero **no** a cerrar el navegador — al día siguiente arranca en hoy y no se registra sobre la fecha de ayer.
6. **Alta solo con Enter**: en la fila azul, Enter sobre GALONES da de alta el registro (`salirEdicion(guardar, confirmarNuevo)`); Tab, flechas y clic fuera dejan el borrador intacto. `guardandoNuevoRef` evita el doble alta (blur + clic en "+ Agregar").

### Ventas — el precio del día dejó de ser retroactivo
7. **`handleRegBlur` reescribía `precio_unit_centimos` con el precio de hoy** cada vez que se tocaba *cualquier* celda de una fila ya guardada (no había trigger en BD; era todo del frontend). Nuevo **`precioDeFila(r, codigo)`**: conserva el precio con el que se grabó la venta y solo recurre al precio del día si la fila no tiene precio propio (créditos rápidos, que nacen en 0) o si se le cambia el producto.

### Base de datos — migración 014 (✅ APLICADA en Supabase)
8. `014_registro_ventas_importe_declarado.sql`: **`registro_ventas.importe_declarado_centimos`** (bigint, nullable).
   - La consola cobra con un precio unitario de **más de 2 decimales**; `precios_diarios` guarda 2. Al completar en COMPLETO un crédito registrado en ABREVIADO, `galones × precio` no coincide con el total de consola por 1-2 céntimos (el techo real es `galones × 0.005`, **no** una constante: 20 gl pueden dar 0.10 → nunca validar contra un máximo fijo).
   - `importe_centimos` = lo que se factura al cliente de crédito (galones × precio). `importe_declarado_centimos` = lo que marcó la consola; se escribe en el alta rápida y **nunca se sobrescribe** al completar la fila. `NULL` si la venta nació en COMPLETO (ahí el sistema no puede saber que hubo variación).
   - Backfill: los rápidos aún sin completar copian su importe. Los ya completados antes de la migración perdieron el dato → quedan `NULL` y VARIACIÓN muestra `—`, no cero.
9. **VARIACIÓN redefinida** = `importe_centimos − importe_declarado_centimos`. Ya no mira el precio del día (cambiarlo no la mueve) y **persiste** tras guardar. Solo vive en Ventas (Seguimiento ya no la tiene) y es ilustrativa.
10. **Redondeo sugerido por turno** (`redondeoSugeridoPorTurno`): Σ VARIACIÓN de las filas del turno. Aparece como `sug. +0.03` clicable bajo el input de REDONDEO. La cuenta cierra sola: `efectivo = consola − … − Σ importe_centimos + redondeo` ⇒ con `redondeo = Σ variación` queda `consola − Σ importe_declarado`, que es lo que la consola cobró de verdad.
11. **`handleShiftInputBlur(turnoId, override?)`**: mismo patrón que `handleRegBlur`. El `<select>` de Colaborador reimplementaba a mano el payload completo dentro de un `setInputsMap` (efectos dentro de un state updater); ahora ambos llaman al mismo sitio.

### Ventas — Combobox de CLIENTE
12. **Ya no se vacía al primer clic**: `onFocus` hacía `setQuery('')` y el texto visible es la query con el menú abierto. Nuevo estado `tecleado`: al enfocar muestra la opción actual seleccionada de punta a punta (teclear la reemplaza), la lista sigue completa, y entrar y salir sin escribir no toca el valor ni dispara guardado.
13. **Sugerencia del cliente anterior** (`sugerencia` + `abrirAlEnfocar={false}`): en la fila de alta no despliega el menú al entrar; propone el cliente del último vale del día como `placeholder` (tenue, "al fondo de la celda") y lo acepta con Enter o Tab. Escribir lo descarta; `↓` despliega la lista.
14. **Bug sutil corregido**: salir de CLIENTE con Tab tras escribir perdía el texto — `setEditando(false)` desmonta el Combobox y **React no emite `blur` al quitar del DOM un nodo enfocado**. `salirEdicion` fuerza el blur antes de desmontar.

- `npm run build` (tsc -b + vite) verificado en verde.

### ⚠️ Nota de despliegue en desarrollo (Vite)
Cambios en **`tailwind.config.ts`** o en la definición de **variables/tema en `index.css`** (nuevas clases utilitarias, `@layer`, tokens) requieren **reiniciar el servidor de Vite** (`Ctrl+C` y `npm run dev`), NO basta `Ctrl+Shift+R`: Vite/PostCSS solo regeneran el CSS de Tailwind al arrancar o cuando cambia un archivo observado, y añadir clases nuevas puede no invalidar el caché de HMR. Cambios solo en JSX/TS/valores existentes sí refrescan con `Ctrl+Shift+R`. Ver **BUENAS_PRACTICAS.md §12**.

## Cambios de esta sesión (2026-07-12)

### El motor de hoja de cálculo se extrajo y ahora lo usan las DOS tablas de Ventas
1. **Nuevo `src/lib/useGridHoja.ts`**. Toda la mecánica de grid (selección, navegación,
   edición, portapapeles, deshacer) vivía suelta dentro de `VentasDelDiaPage` y solo servía
   a la tabla de vales de COMPLETO. Ahora es un hook con callbacks (`editable`, `texto`,
   `numero`, `valor`, `aplicar`, `guardar`, `revertir`, `deshacer`, `teclaDirecta`…): el hook
   solo sabe de **coordenadas**, y qué hay en cada celda lo resuelve la página.
2. **La Tabla de Turnos dejó de ser inputs sueltos con `onBlur`** y pasó a ser un grid con el
   mismo motor: clic selecciona, Enter/F2/doble clic editan, teclear encima reemplaza, Tab,
   Ctrl+C/V, Ctrl+Z de un nivel (`ultimoCambioTurno`), Supr vacía. COLABORADOR se resuelve
   tecleando su inicial (`colaboradorPorTecla`), igual que TURNO y PRODUCTO.
   - ⚠️ **Sus columnas se corren con el modo**: los créditos ocupan 4 columnas en COMPLETO y
     1 en ABREVIADO, así que PRUEBA/REDONDEO/EFECTIVO/COLABORADOR se **calculan** (`colTurno`,
     desde `T_COL_CREDITO`), no se fijan a mano. `campoTurno(c)` mapea columna → campo.
   - Los dos grids se enlazan por refs (`soltarTurnos` / `soltarRegistros`): al tomar el foco
     uno, el otro suelta su selección — en una hoja de cálculo hay **una sola** celda activa.
3. **`CeldaGrid`** gana `textoCopia` (qué se lleva Ctrl+C cuando lo visible es un placeholder
   o lleva moneda/anexo) y `pie` (anexo bajo el contenido, fuera de la copia: el `sug.` de
   REDONDEO y el `↻` de reprecio).

### Casillas numéricas — el `useHardenNumberInputs` tenía un agujero
4. **La `e` entraba en GALONES** pese al hook global: este solo vigila lo que se teclea
   **dentro** de un `<input type="number">`, y en un grid el valor entra por dos caminos que
   no pasan por el input — al **teclear sobre la celda seleccionada** (la 1ª tecla se siembra
   en el estado y el input se monta después) y al **pegar** con Ctrl+V. Nuevo
   **`src/lib/numero.ts`** (`esTeclaNumerica`, `sanearNumero`); `useGridHoja` los aplica en
   esos dos caminos si la celda se declara `numero`. **Los dos frentes hay que cubrirlos.**
5. **Las flechas ya no incrementan** una casilla numérica: navegan entre celdas (era el
   comportamiento nativo del spinner en la tabla de turnos, que no era grid).
6. **`-` ahora es configurable**: se sigue bloqueando en todas las cajas salvo las marcadas
   con **`data-negativo`** (hoy solo REDONDEO, la única que puede restar céntimos). En el
   grid se declara con `negativo` en la celda.

### Ventas — el precio del día: no retroactivo, pero **corregible**
7. `precioDeFila` (2026-07-09) protege lo ya registrado, pero si el precio se cargó **mal**,
   esas filas quedaban valoradas al precio equivocado y **editarlas no las arreglaba**
   (conservan su `precio_unit_centimos`). Se mantiene la no-retroactividad —el precio puede
   subir de verdad a media jornada y convivir dos precios el mismo día— y se añaden **dos
   salidas explícitas, nunca automáticas**:
   - **En bloque**: `filasDesfasadas` / `resumenDesfase` → banda ámbar con el desglose
     (`REGULAR 3 × S/10.00 → S/9.00`) y botón **Reajustar**. El *"No, están bien"* descarta el
     aviso por **firma `fecha|precios`**: si el precio vuelve a cambiar, la advertencia es
     nueva y reaparece.
   - **Fila a fila**: la celda PRECIO TOTAL de una venta desfasada muestra `↻ 9.00 = S/ 18.00`
     (un `pie` clicable); revalora **solo esa fila**. Es la salida cuando unas ventas del día
     están bien y otras no.
   - `reajustarPrecios(filas)` reescribe `precio_unit_centimos` + `importe_centimos` ⇒ VARIACIÓN
     y el redondeo sugerido se recolocan solos. Los créditos rápidos (sin galones) no entran:
     su importe se digita a mano, no sale de un precio.

### Combobox de CLIENTE — dos bugs de teclado
8. **Se perdía la 1ª letra**: la celda se comía la tecla para abrir el editor y el `Combobox`
   se montaba *después*, ya sin ella. Nueva prop **`semilla`**: la tecla viaja al combo y se
   usa como filtro inicial en su primer foco.
9. **Tab no confirmaba lo resaltado**: no miraba `activeIdx`, se dejaba caer al `blur` →
   `closeAndCommit`, que **solo acierta con coincidencia exacta o cuando queda UNA opción
   filtrada**. Con dos o más, bajar con ↓ y tabular revertía al valor anterior. Ahora, con la
   lista abierta, Tab confirma lo resaltado igual que Enter (y cierra el menú antes del blur,
   para que este no revierta).

- `npx tsc --noEmit` y `npm run build` en verde. **Sin migraciones**: todo es frontend.

## Cambios de esta sesión (2026-07-14)

### OSINERGMIN — diagnóstico del "ranking desfasado" + recon de fuente en vivo (Facilito)

**Motivo**: el usuario reportó que un cambio de precio registrado en el Excel el 13/07 11:18 (`FCHA_REGISTRO`; nuestro grifo bajó a **S/18.99 = #1** en Diesel B5) recién se reflejó en la app el **14/07 05:00** (~18 h después), pese al cron horario. Y que el gráfico muestra varios puntos el mismo día "a intervalos aleatorios".

1. **El desfase NO es bug del ranking — es latencia del Excel EVPC.** `FCHA_REGISTRO` = cuándo el grifo declaró el precio al sistema **vivo** de OSINERGMIN, NO cuándo entra al Excel que descargamos. El Excel EVPC es un **volcado batch** que OSINERGMIN regenera ~1 vez al día de madrugada; el cron horario solo ve el cambio tras esa regeneración (por eso apareció justo en la corrida de las 05:00). La lógica de detección (huella del Top 10) **sí** habría capturado el cambio si el Excel lo trajera. Además: `fecha_datos_excel` se guarda como `new Date()` (día de la corrida, **no** del contenido del Excel) y `FCHA_REGISTRO` se descarta tras desempatar → la app **no tiene forma de saber cuán viejo está el Excel**.
2. **Los "varios puntos el mismo día" tampoco son bug.** Dos mecanismos: (a) se crea snapshot cuando cambia la **huella**, que cubre TODO el Top 10 de los 3 productos + los conteos → un competidor que mueve su precio genera snapshot aunque nuestro puesto no cambie; (b) el **eje X del gráfico es por índice, no por tiempo** (`x(i)=ml+band*(i+0.5)` en `OsinergminPage`), así que varios snapshots del mismo día se reparten en franjas iguales y la etiqueta DD/MM se repite. El tooltip sí trae la hora.

**Recon "Opción A" — consumir Facilito en vivo desde el servidor (ÉXITO):**
- **La web de Facilito (`www.facilito.gob.pe`, app Struts/JSP) SÍ se consume server-side por GET, SIN reCAPTCHA.** El reCAPTCHA v3 (site key `6Le5C4cfAAAAABbO98BHMzZKAUVimVJSzcKrbK03`, action `PreciosCombustibleAutomotorAction`) gatea **solo el POST** del navegador; el mismo action por **GET** devuelve los datos igual. Esto **corrige** la conclusión del 2026-07-10 (bloque "FUENTE DE DATOS", ya anotado ahí).
- **Endpoint (probado en vivo)**:
  ```
  GET https://www.facilito.gob.pe/facilito/actions/PreciosCombustibleAutomotorAction.do
      ?method=cambiarProducto
      &departamento=<D>&departamentoAux=<D>&provincia=<P>&distrito=<Dist>&producto=<40|126|127>
  ```
  - Métodos del cascade en el MISMO action: `inicio` (provincias), `cambiarProvincia` (distritos), `cambiarProducto`/`cambiarDistrito` (tabla de precios).
  - **Códigos**: departamento = INEI×10000 (**Arequipa=`40000`**); provincia (**Arequipa=`40100`**); distrito (**Miraflores=`40110`**); **producto: `40`=Diesel B5, `126`=Gasohol Regular, `127`=Gasohol Premium**. Charset **Cp1252**.
  - Devuelve tabla HTML **ordenada por precio ascendente** (= el orden de ranking de OSINERGMIN): distrito, razón social, dirección, teléfono, **precio**; y el **`CODIGO_OSINERG` de cada fila en `irMapa('<codigo>')`**. **NO trae RUC ni `FCHA_REGISTRO`.**
  - Alternativa estructurada: `MapaAction.do?...&method=mostrarMapa` expone por establecimiento `codigoOsinergmin`, `precioVenta`, lat/long.
- **Frescura PROBADA** (con corrección de identidad, ver ⚠️ abajo): nuestro grifo es **GRIFO ALEXMATH (código `21728`)** — verificado 2026-07-15: sus precios DB5 19.56 / Regular 17.28 / Premium 18.28 calzan **exacto** con el tooltip del snapshot del 14/07 05:00. El **13/07 11:18 un competidor**, **ESTACIÓN DE SERVICIOS ARAGON (código `34453`)**, registró **S/18.99** y nos arrebató el #1 de Diesel B5; el Excel recién reflejó nuestra caída a #2 el 14/07 05:00 (~18 h después). La web además lista **GRUPO CONSTRUCTOR FAMEK (código `186001`)** que el Excel no traía. Los códigos coinciden **exactos** con la columna `CODIGO_OSINERG` del Excel (21728, 34453, 6949, 8165, 8245, 149204, 8812, 84478, 8307, 8543, 9269, 16593 + el extra 186001).
  - ⚠️ **Ojo (corregido 2026-07-15)**: en el primer borrado de esta sesión etiqueté por error el código `34453` (ARAGON) como "nuestro grifo". **NO**: `34453` es un competidor; **el nuestro es `21728` (ALEXMATH)**. El RUC configurado en `app_config` ya apunta a ALEXMATH (por eso las tarjetas de la app siempre calzaron con 21728).

**Adaptación cuando se implemente (aún NO hecho):**
- Identificar NUESTRO grifo por **`CODIGO_OSINERG` = `21728` (GRIFO ALEXMATH)**, no por RUC (la web no trae RUC) — más preciso (es el establecimiento, que es justo lo que compite). Guardar el código en `app_config` (junto al RUC actual).
- **Confiar en el orden de filas de la página** (es el orden canónico de OSINERGMIN) → nuestro puesto = posición de nuestro código. No hace falta el desempate por `FCHA_REGISTRO` (que la web no da).
- 3 GET por corrida (uno por producto) para nuestro distrito. Encaja en `osinergmin-cron`: se reemplaza `parseXlsx` por fetch+parse de HTML; **la lógica de ranking/dedup/snapshot se reutiliza**.

**Advertencias:**
- El GET-sin-token es **incidental** (gatearon el POST, no el GET) → podrían cerrarlo sin aviso. Como es crítico → **fuente primaria = Facilito, fallback automático = Excel + `aviso`** si Facilito falla o cambia de formato.
- Endpoint no documentado de datos públicos: consumir con **cortesía** (por hora, sin golpear).
- **Datos Abiertos** (datosabiertos.gob.pe) se descartó de plano: su dataset de precios es **mensual**, peor que el Excel.

**Siguiente paso:** montar un **spike de validación** — Edge Function que baje Miraflores 40/126/127 por este endpoint, calcule el ranking y lo muestre **lado a lado** con el del Excel unos días; si cuadra, cambiar la fuente. Evaluar también añadir **push al admin cuando cambie su puesto** (el valor real para "reaccionar a cambios de ranking"). → **HECHO 2026-07-15, ver abajo.**

## Cambios de esta sesión (2026-07-15)

### OSINERGMIN — spike de validación de fuente (Facilito en vivo vs Excel) CONSTRUIDO

Objetivo: comparar unos días, **sin tocar producción**, el ranking de la fuente en vivo (Facilito) contra el snapshot del Excel, para decidir si cambiamos la fuente del cron.

- **Nueva Edge Function `osinergmin-spike`** (`supabase/functions/osinergmin-spike/index.ts`), **read-only** (no escribe nada): baja los 3 productos de Miraflores por GET (stateless, un GET por producto), parsea la tabla, calcula NUESTRO puesto por posición del código `21728`, lee el **último snapshot** de `osinergmin_snapshots`/`osinergmin_top10` (el lado Excel) y devuelve un **diff por producto** (¿coincide puesto?/¿precio?/notas) + la antigüedad del snapshot. Misma auth que el cron (`x-cron-secret` o sesión superadmin); CORS + OPTIONS; `verify_jwt=false` en `config.toml`.
  - Parser validado en vivo (node, contra el HTML real): los 3 productos parsean 13 establecimientos, **todos ascendentes**, y sitúan a ALEXMATH (21728) en **DB5 #1 / Regular #4 / Premium #3** hoy (ARAGON subió su DB5 de 18.99 a 19.99 → volvimos a #1). Regex de fila: `irMapa\('(\d+)'…<td>razón…<td>dirección…<td>teléfono…align="center">precio`. Decodifica **Windows-1252** con `TextDecoder`.
  - **Supuesto clave que valida el propio spike**: se confía en el **orden de la página** (ascendente = orden canónico de OSINERGMIN, con su desempate). La función marca `ordenado_por_precio:false` si algún día no viniera ascendente.
- **Panel temporal solo-superadmin** en `OsinergminPage`: `SpikeFacilitoPanel.tsx` (botón "Comparar ahora" → invoca la función; muestra por producto dos mini-tablas **Facilito | Excel** con nuestra fila resaltada y un badge coincide/difiere). Montado al fondo de la página tras `{esSuperadmin && …}`. `npx tsc -p tsconfig.app.json --noEmit` en verde.

**Para probarlo (pendiente, requiere credenciales que no tengo aquí):**
1. Desplegar: `npx supabase functions deploy osinergmin-spike --project-ref acvavpzdeichdvsgblcn --no-verify-jwt` (con `$env:SUPABASE_ACCESS_TOKEN` y `Set-ExecutionPolicy -Scope Process Bypass`, igual que el cron).
2. Reiniciar Vite (hay componente nuevo) y entrar a OSINERGMIN como **superadmin** → "Comparar ahora".
3. Observar unos días: donde difieran, la diferencia debe explicarse por **latencia del Excel** (el snapshot viejo) o por grifos que el Excel no trae (FAMEK). Si el lado Facilito es consistentemente correcto y más fresco → cambiar la fuente de `osinergmin-cron`.

**Al terminar la validación**: borrar la función `osinergmin-spike`, su bloque en `config.toml`, `SpikeFacilitoPanel.tsx` y su import/uso en `OsinergminPage`.

**Productionizar (cuando se apruebe la fuente):** en `osinergmin-cron`, reemplazar `fetch`+`parseXlsx` del Excel por el fetch+parse de Facilito (3 GET, uno por producto); identificar nuestro grifo por `CODIGO_OSINERG` (guardar `21728` en `app_config`); mapear la zona a los códigos Facilito (40000/40100/40110) o guardarlos en config; **mantener el Excel como fallback + `aviso`** si Facilito falla/cambia. La lógica de dedup/snapshot/Top-10 se reutiliza igual.

### Desplegado y en observación + aclaraciones de diseño (2026-07-15)
- **`osinergmin-spike` DESPLEGADO y funcionando**: el usuario lo desplegó (CLI con token) y el panel muestra las tablas comparativas Facilito | Excel. **Acordado: observar 2 días** con clics manuales antes de decidir el cambio de fuente. Si se quiere registro automático, se agregaría una tablita de log + cron horario propio del spike (aún NO hecho).
- **Aclaraciones de arquitectura (para no re-explicar en futuras sesiones):**
  - La data NO la trae el navegador: la trae la **Edge Function** (servidor). Cadena: navegador → función en Supabase → GET a Facilito → parseo → JSON. Desde el navegador Facilito bloquearía por CORS.
  - **Multi-grifo**: para otro grifo hacen falta 4 datos hoy hardcodeados que deberían ir en `app_config`: los **3 códigos de zona** de Facilito + el **`CODIGO_OSINERG`** del grifo (identificación por establecimiento, no por RUC).
  - **Fragilidad**: es scraping de HTML no documentado; si Facilito cambia el maquetado/endpoint, el regex devuelve 0 filas o basura → producción debe llevar chequeo "0 filas = error" + **Excel como fallback + `aviso`**. Si se rompe, es arreglo de código (regex/params).
  - **Poll, no push**: OSINERGMIN no da API/webhook, no nos avisa. Nos enteramos al **consultar** (poll, hoy cada hora). Internamente sí somos responsivos: el cron detecta el cambio (huella) y **Realtime lo empuja al navegador**. Única palanca de frescura = el intervalo de consulta (se puede bajar a 30/15 min).

## EN PLANIFICACIÓN (2026-07-15): OCR de reportes de consola → cuadre de caja

> **Plan detallado en [`PLAN-cuadre-consola-y-localfirst.md`](PLAN-cuadre-consola-y-localfirst.md)** (documento de diseño vivo, armado 2026-07-15). Vive en **Ventas** (ahí ocurre el cuadre). Resumen abajo.

- **Qué**: leer los reportes que imprime la **consola** (controlador de playa) desde **screenshots** (el PDF/Excel que exporta es solo-ventas y más extenso → no conviene). Reportes: **REPORTE PRODUCTO** (por producto: Ventas/Volumen/Importe + fila **RSM = total**, sirve de auto-validación) y **REPORTE STOCK** (por tanque: Inicio/Final; tanque 1=DB5, 2=G.REG, 3=G.PRE).
- **Imágenes/día (objetivo)**: **~6** — 4 por turno (ventas del turno) + 2 generales del día (stock del día + ventas consolidadas del día). **Hoy son solo 2/día.** ⚠️ **RECORDATORIO pedido por el usuario**: en el futuro este proceso de screenshots *se simplificará más* — recordárselo al retomar.
- **Captura**: la sube el **admin del grifo al día siguiente** para cuadrar lo de ayer. Se guarda la imagen en **Supabase Storage en WebP** (~50–200 KB c/u → free tier alcanza ~años; se guarda para auditoría).
- **Qué se guarda**: **todo el historial de ventas por turno**. El **stock** es referencia PERO también se guarda y **se compara contra el varillaje** para detectar variaciones / posibles **descalibraciones** de tanque.
- **Uso en el cuadre**: **autocompletar el total** del turno = `importe_declarado_centimos` (hoy tecleado a mano), **editable** (líos reales: dos turnos que son uno, relevo que llega tarde → mismo turno/cierre; la app propone, el humano decide). Toda **edición manual del total de consola dispara una alerta al superadmin** (reutiliza el audit `registro_ventas_log`).
- **Motor de lectura** (dos caminos):
  - **Online (principal)**: LLM multimodal (Gemini 2.5 Flash o Claude vision) → **JSON estricto**. Inmune a la escala/marco del screenshot; una pasada lee ambos reportes. Validaciones cruzadas (filas suman RSM; `Importe ≈ Volumen × precio`) para cazar errores de un dígito. Ojo formato peruano (coma miles, punto decimal, volúmenes 3 decimales).
  - **Offline**: NO YOLO. **Template matching** (anclar por el encabezado/título, robusto a más/menos marco; **multi-escala** por si cambian monitor/resolución) + **Tesseract con whitelist numérica**. Corre client-side (WASM) en la PWA.
- **YOLO descartado**: la UI de consola es fija → no hace falta detección entrenada ni reentrenar cada mes; calidad = validaciones cruzadas + confirmación humana, no un modelo que mantener.
- **Local-first**: **DECIDIDO hacerlo desde ya** (fase 1 del plan) para Ventas + Seguimiento — IndexedDB (Dexie) + cola de sync; ~30 días en local; ~200 filas/día. Da **escritura instantánea** (sin latencia de red: hoy ~cientos de ms por el viaje a Supabase → ~1-5 ms local) y resiliencia ante caídas de internet **y** de Supabase. ⚠️ Acoplamiento: el total de consola alimenta el cuadre → por eso el OCR offline (WASM) va como última fase, **sobre** la base local-first, no antes.
- **Fases** (detalle en el plan): 1) fundación local-first en Ventas · 2) local-first en Seguimiento · 3) datos+captura de consola · 4) extracción online (LLM)+autocompletado+alerta · 5) stock vs varillaje · 6) OCR offline (WASM). **Orden DECIDIDO 2026-07-15**: local-first (fases 1-2) primero, luego el OCR.
- **LLM (fase 4)**: costo trivial a ~180 img/mes (Haiku 4.5 ~$0.5–1/mes, Sonnet 5 ~$1.5–2, Opus 4.8 ~$3) → elegir por precisión. ⚠️ **Privacidad**: API de pago de Claude NO entrena con tus datos; Gemini **gratis** (AI Studio) SÍ → usar Claude API o Gemini de pago, nunca el gratis. **Money-critical**: Supabase = fuente de verdad + validaciones/alertas server-side; estado de sync visible; conflictos de dinero resueltos explícito (no LWW silencioso).

## Cambios de esta sesión (2026-07-16) — LOCAL-FIRST FASES 1 y 2 CONSTRUIDAS

**Ventas y Seguimiento ahora son local-first** (plan `PLAN-cuadre-consola-y-localfirst.md`, fases 1-2). La UI lee y escribe SIEMPRE en IndexedDB (Dexie) → respuesta instantánea y funcionamiento sin internet; un worker replica contra Supabase (que sigue siendo la fuente de verdad).

### Motor nuevo — `src/lib/local/` (genérico: extender otro módulo = registrar tablas + migrar sus lecturas/escrituras)
- **`db.ts`** — Dexie `grifo-local`: espejos de `registro_ventas`, `cierres_caja`, `precios_diarios` + catálogos (`turnos`, `empresas_clientes`, `tipos_combustible`, `profiles`) + `outbox` (cola FIFO de mutaciones) + `meta` (cursores de pull).
- **`sync.ts`** — worker: **flush** del outbox en orden estricto (error de red → reintenta al reconectar/tick de 45 s; rechazo real del servidor → bloquea la cola y se muestra en rojo, nunca se descarta plata en silencio); **hidratación** inicial ~35 días; **pull incremental** por `updated_at` (LWW: el servidor pisa lo local SALVO filas con cambios aún en cola); `asegurarRango()` para rangos históricos bajo demanda (quedan cacheados); catálogos con reemplazo-solo-si-cambió (evita re-emitir liveQuerys y pisar celdas a medio tipear — igual los merges saltan filas con `updated_at` idéntico). `iniciarSync()` arranca en `AdminLayout` (RLS admin).
- **`repo.ts`** — API tipada: `insertRegistroVenta` (uuid generado en cliente → id definitivo aun offline), `updateRegistroVenta`, `softDelete/restaurarRegistroVenta`, `upsertCierreCaja` (por **clave natural fecha+turno**, sin id en el payload → el pull reconcilia ids), `upsertPrecioDiario` (por fecha), y lecturas para `useLiveQuery`: `leerDia`, `leerCierresRango`, `leerRegistrosRango`, `leerCatalogos` (joins de nombres hechos localmente). Escritura local + entrada de outbox en LA MISMA transacción Dexie.
- **`useSyncStatus.ts`** + **`components/SyncBadge.tsx`** — badge en la barra superior: verde=sincronizado, ámbar=sin conexión/pendientes, rojo=rechazo del servidor (tooltip con el error); clic = sincronizar ya.

### Migración de las páginas
- **`VentasDelDiaPage`** (fase 1): `loadDia`/`loadHistorial` eliminados → `useLiveQuery(leerDia(fecha))` y `leerCierresRango(mes)`; todas las mutaciones van por el repo (cierres→upsert natural, precios→upsert por fecha — ya no hace falta `precioId`, la herencia del precio anterior se resuelve local). "Corregir fecha" sigue **online-only** (reparación rara que exige vista completa del servidor; avisa si no hay conexión y re-sincroniza al terminar).
- **`CorporativoPage`** (fase 2): rango DESDE→HASTA desde Dexie + `asegurarRango` en segundo plano; alta/edición/pago/papelera/restaurar por el repo. El **historial de auditoría** (`registro_ventas_log`) sigue online-only (vive solo en el servidor, correcto así).
- **`AuthContext`**: perfil cacheado en localStorage (`grifo-profile-cache`) → la app arranca sin internet con sesión persistida (solo si el id coincide con la sesión).

### Migración BD — **`016_localfirst_sync.sql` — ✅ APLICADA (2026-07-16, confirmado por el usuario)**
- `updated_at` + trigger en `registro_ventas` y `precios_diarios` (cierres ya lo tenía) + índices → pull incremental y LWW.
- **UNIQUE (fecha, turno_id) en `cierres_caja`** (con dedup previo conservando el más reciente) → los upserts offline no duplican cierres.
- Sin aplicar: el pull de esas tablas falla (columna inexistente) y el upsert de cierres se bloquea (falta el índice del onConflict) → badge rojo.

### Verificado en vivo + próximo paso
- **Probado por el usuario (2026-07-16)**: offline → 7 registros encolados (badge ámbar "7 por enviar"); al volver online la cola se vació sola → badge verde. Fix aplicado en la sesión: catálogos memoizados (`useMemo` sobre `catalogos`) en Ventas y Seguimiento — el `?? []` sin memo creaba un array nuevo por render y el efecto de `inputsMap` entraba en bucle ("Maximum update depth exceeded").
- **PRÓXIMO PASO acordado**: el usuario sigue probando (llegada real a Supabase, pull inverso); si todo bien → **continuar con las fases 3+ del plan** (tablas `consola_*` + Storage + UI de carga, luego OCR con LLM).

### Notas
- **Cadencia del sync — DECIDIDO (2026-07-16): poll cada 45 s** (`INTERVALO_MS` en `sync.ts`), no Realtime. Razón: un solo admin hace el cuadre → lo que ve en pantalla es lo que él mismo teclea (reflejado en ms desde Dexie); el pull solo cubre el caso raro de ediciones desde otro dispositivo/dashboard, donde 45 s de retraso es irrelevante. OJO: el **push es instantáneo** (cada guardado dispara el envío; el tick de 45 s es solo reintento de respaldo + pull). Si algún día hay cuadre multi-usuario real → agregar suscripción **Realtime → Dexie** (la UI ya reacciona sola vía `useLiveQuery`, no habría que tocar las páginas). Bajar el intervalo = cambiar un número.
- **`navigator.storage.persist()`** se pide al arrancar el sync (2026-07-16): blinda IndexedDB (datos + outbox) contra el desalojo automático del navegador con disco lleno. Si el navegador lo niega, todo funciona igual (se loguea en consola).
- Deps nuevas: `dexie`, `dexie-react-hooks`. `tsc -b` y `npm run build` (PWA incluida) en verde. La PWA ya precacheaba el app shell (vite-plugin-pwa) → con esto la app **carga y opera** offline.
- Comportamiento offline esperado: escribir funciona siempre (cola ámbar con contador); al volver la conexión se vacía sola. Conflicto real (dos dispositivos editan lo mismo offline) → gana el último en llegar (LWW), rastro en `registro_ventas_log`.
- Pendiente natural: fases 3-6 del plan (captura de consola + OCR); extender local-first a Compras/Varillaje si se quiere (el motor ya es genérico).

## Correcciones de arquitectura importantes (histórico)
- **AuthContext** (`src/features/auth/AuthContext.tsx`) — contexto de auth compartido. `useAuth.ts` re-exporta desde él. `main.tsx` envuelve con `<AuthProvider>`. Evita múltiples instancias de `useAuth` con race conditions.
- **Fix refresh al minimizar** — `onAuthStateChange` ignora `TOKEN_REFRESHED` y `SIGNED_IN` si ya hay perfil cargado (usa `profileRef`).
- **Refresco Silencioso (Flicker-Free)** — la recarga tras guardar en `VentasDelDiaPage` se hace en segundo plano sin desmontar la UI.
- **Robustez de carga** — todo `load*` con `try/catch/finally`; los datos de Supabase se validan con `Array.isArray` antes de iterar (el tipo puede venir como `GenericStringError`).

## Convenciones / utilidades nuevas en `lib/`
- **`useHardenNumberInputs.ts`** — hook global (1 llamada en `App.tsx`) que endurece todos los inputs numéricos. Para futuros inputs: basta `type="number"`, ya queda cubierto. `-` bloqueado salvo en inputs con **`data-negativo`** (hoy solo REDONDEO). ⚠️ **No cubre** lo que entra sin pasar por el input (grid: teclear sobre la celda, pegar) → ver `numero.ts`.
- **`numero.ts`** — `esTeclaNumerica` / `sanearNumero`: el otro frente de las casillas numéricas (lo que se siembra en el estado o se pega). `useGridHoja` los aplica en las celdas `numero`.
- **`useGridHoja.ts`** — motor de hoja de cálculo (selección, navegación, edición, Ctrl+C/V/Z) sobre una tabla de `<CeldaGrid>`. **Toda tabla de captura debe usarlo**, no inputs sueltos.
- **`usePersistedState.ts`** — `useState` que persiste en `localStorage`. Usar para filtros; claves con prefijo de módulo (`'seguimiento.mes'`). Pesa bytes → no satura el navegador.
- Convenciones documentadas en **BUENAS_PRACTICAS.md §6** (rev 5: tablas de captura = hoja de cálculo; inputs numéricos con sus **dos** frentes).

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
    013_registro_ventas_auditoria_softdelete.sql ← aplicada: log auditoría + soft delete registro_ventas
    014_registro_ventas_importe_declarado.sql    ← aplicada: importe_declarado_centimos (total de consola del alta ABREVIADO)
```

**Why:** Registrar el estado exacto para que futuras sesiones puedan continuar sin re-derivar qué se hizo.
**How to apply:** Al iniciar nueva sesión, leer este archivo y preguntar al usuario qué módulo construir a continuación. Próximos candidatos: **Compras** u **OSINERGMIN** (ambos placeholders), o **Varillaje** (grifero).
