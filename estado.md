---
name: proyecto-grifo-estado
description: "Estado actual de construcción del Sistema Grifo — qué está hecho, qué falta, dónde nos quedamos"
metadata:
  node_type: memory
  type: project
  originSessionId: 2846fb7a-3ed9-41a7-bca2-7b57da65d443
---

Última actualización: **2026-07-01**

## Módulos completados

### Grifero
- **HomePage** — saludo con nombre, reloj en vivo, dos botones (Cierre de Caja / Varillaje)
- **CierreCajaPage** — contador de monedas/billetes (DenomCounter), medios de pago (Yape/OpenPay), modales de vales (licitacion/corporacion/citv/chevron/credito), resumen con diferencia SOBRA/FALTA/EXACTO, guarda en `cierres_caja` + `cierre_denominaciones` + `cierre_vales`
- **ValeModal** — tabla mini con Enter para agregar fila, total automático
- **VarillajePage** — placeholder "en construcción"

### Admin
- **AdminLayout** — barra nav top: Ventas, **Seguimiento**, Compras, OSINERGMIN, Configuración + botón Salir.
  - ⚠️ "Corporativo / Vales" fue **renombrado a "Seguimiento"**; la ruta pasó de `/corporativo` a `/seguimiento` (el componente sigue siendo `CorporativoPage.tsx`).
- **ConfiguracionPage** — 6 sub-tabs con CRUD completo:
  - Turnos, Combustibles, Tanques, Empresas Clientes, Proveedores
  - Sistema — `app_config` editable por `admin_grifo` y `superadmin` (política RLS actualizada en migración `002_app_config_admin_write.sql`, **aplicada con éxito**)
- **Ventas del Día & Ventas Diarias (Unificados)** ← **CONSTRUIDO Y PERFECCIONADO** (`src/features/admin/ventas/VentasDelDiaPage.tsx`)
  - **Toolbar**: fecha, precios DIESEL/REGULAR/PREMIUM (auto-save en `precios_diarios`), toggle ABREVIADO/COMPLETO, REINICIAR DÍA (confirm inline, borrado completo de la fecha).
  - **Tabla de Turnos (Editable e Instantánea)**: Celdas de consola, yape, openpay, depósito, pruebas, redondeo y colaborador editables directamente. Auto-guardan en `onBlur` (o al cambiar colaborador) con **refresco silencioso (flicker-free)**. Guarda en `cierres_caja`.
  - **Registro Rápido de Créditos**: modo Abreviado, registra créditos con solo Turno y Monto S/. → `registro_ventas`, se suman en tiempo real.
  - **Edición en Línea de Vales**: tabla inferior (modo Completo) agrega/edita transacciones de `registro_ventas` en la misma fila.
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
| **Compras** | `/compras` | Placeholder | CRUD `compras_combustible` + comparador proveedores. Imágenes: `COMPRA_GALONES.png`, `COMPRA_COMBUSTIBLE.png` |
| **OSINERGMIN** | `/osinergmin` | Placeholder | Ranking histórico de precios. Imagen: `MODELO ÚLTIMOS PRECIOS.png` |

## Módulos pendientes (grifero)
- **Varillaje** — medición y registro de tanques (sin diseño definido)

## Infraestructura pendiente
- OSINERGMIN Edge Function (job horario, lectura Excel, ranking dinámico por distrito)
- PWA kiosk mode: Chrome `--kiosk` config
- Cloudflare Pages CI/CD + Zero Trust

## Gotchas conocidos (para futuras sesiones)
- **Supabase 502 / CORS al cargar**: es infra, NO código. Probable proyecto pausado (plan free se pausa por inactividad) → reactivar en el dashboard de Supabase. El código ya no queda atascado si ocurre.
- **`npm run build` (= `tsc -b && vite build`) falla en `vite.config.ts`**: faltan `@types/node` (`Cannot find module 'path'`, `__dirname`). Pre-existente, NO afecta `vite dev` ni `vite build` directo (que sí compila OK). Fix pendiente: `npm i -D @types/node`.
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
  lib/
    supabase.ts
    money.ts                  — toCentimos, formatSoles, formatSolesRaw, sumCentimos
    date.ts                   — hoyLocal, formatFecha, formatHora
    useHardenNumberInputs.ts  ← endurece inputs numéricos (global)
    usePersistedState.ts      ← useState + localStorage (filtros)
  types/index.ts              — interfaces TypeScript
  index.css                   — .table-excel (36px/14px), spinners off, .btn-*, .input, .card, .modal-*, .badge-*
  App.tsx                     — guards de auth + rutas por rol + useHardenNumberInputs()
  main.tsx                    — <AuthProvider> → <QueryClientProvider> → <App>
supabase/
  migrations/
    001_schema_completo.sql
    002_app_config_admin_write.sql  ← aplicada
```

**Why:** Registrar el estado exacto para que futuras sesiones puedan continuar sin re-derivar qué se hizo.
**How to apply:** Al iniciar nueva sesión, leer este archivo y preguntar al usuario qué módulo construir a continuación. Próximos candidatos: **Compras** u **OSINERGMIN** (ambos placeholders), o **Varillaje** (grifero).
