# Plan — OCR de reportes de consola + arquitectura local-first (Ventas y Seguimiento)

> Estado: **PLANIFICADO (2026-07-15)**, aprobado para implementar por fases. Documento de diseño vivo. El estado de avance vive en `estado.md`; los requisitos y decisiones, aquí.

## 1. Objetivo

Automatizar la carga del **cuadre de caja** leyendo con IA/OCR los **screenshots de los reportes que imprime la consola** (controlador de playa), y de paso volver **local-first** los módulos de Ventas y Seguimiento (respuestas instantáneas + resiliencia ante caídas de internet **y** de Supabase).

## 2. Decisiones tomadas (sesión 2026-07-15) — no re-litigar sin leer esto

| Tema | Decisión |
|---|---|
| Fuente | **Screenshot** de la consola (el PDF/Excel que exporta es solo-ventas y más extenso → no conviene) |
| Motor online | **LLM multimodal** (Gemini 2.5 Flash o Claude vision) → **JSON estricto**. Inmune a escala/marco |
| Motor offline | **Template matching** (anclar por encabezado; multi-escala) + **Tesseract** con whitelist numérica. **NO YOLO** (UI fija → no hace falta detección entrenada ni reentrenos) |
| Control de calidad | Validaciones cruzadas (fila **RSM** = suma; `Importe ≈ Volumen × precio`) + **confirmación humana**. No hay modelo que mantener |
| Autocompletado | Autocompleta el **TOTAL CONSOLA** del turno, **editable** (casos reales: 2 turnos que son 1, relevo tardío = mismo turno). Toda **edición manual dispara alerta al superadmin** (reutiliza `registro_ventas_log`) |
| Arquitectura | **Local-first desde ya** para Ventas + Seguimiento (IndexedDB + cola de sync). ~30 días en local, ~200 filas/día → factible |
| UI | Vive en **Ventas** (ahí ocurre el cuadre) |
| Almacenamiento imágenes | **Supabase Storage en WebP** (~50–200 KB c/u → free tier ~años) + copia local. Se guardan para auditoría |

⚠️ **Recordatorio del usuario**: hoy son 2 screenshots/día; el objetivo son ~6, pero **a futuro este proceso de captura se simplificará** — recordárselo al retomar.

## 3. Origen de datos: las ~6 imágenes/día

El admin del grifo las sube **al día siguiente** para cuadrar lo de ayer:

- **4 × REPORTE PRODUCTO por turno** → cada uno da el **TOTAL CONSOLA de ese turno**.
- **1 × REPORTE PRODUCTO consolidado del día** → **cruce**: Σ(4 turnos) debe = consolidado.
- **1 × REPORTE STOCK del día** → por tanque Inicio/Final → **se compara contra varillaje**.

Contenido de cada reporte:
- **PRODUCTO**: filas por producto (`DB5`, `G.PRE`→PREMIUM, `G.REG`→REGULAR) con **Ventas** (nº), **Volumen** (gl, 3 decimales), **Importe** (S/). Fila **`RSM` = total** (no es un producto; sirve de auto-validación).
- **STOCK**: filas por tanque (**1=DB5, 2=G.REG, 3=G.PRE**) con **Inicio**/**Final** (gl).
- **Metadatos**: nº de turno, fecha/hora inicio y fin, "Solicitud" (cuándo se generó), Ventas totales.

⚠️ Formato peruano: **coma de miles, punto decimal**; volúmenes con **3 decimales** (`117.917`). Hay que indicárselo explícito al LLM.

## 4. Modelo de datos (borrador — se afina en implementación)

```
consola_reportes
  id uuid pk
  fecha date
  tipo text  check (ventas_turno | ventas_dia | stock_dia)
  turno_id uuid null  -- fk turnos (solo ventas_turno)
  imagen_path text    -- Supabase Storage (webp)
  extraido jsonb      -- salida cruda del LLM/OCR (respaldo)
  ventas_total int
  importe_total_centimos bigint
  estado text  check (pendiente | confirmado)
  editado_manual bool default false
  fuente text  check (llm | ocr_local | manual)
  subido_por uuid, created_at, updated_at, deleted_at

consola_reporte_productos     -- líneas de PRODUCTO (para historial/consultas)
  reporte_id fk, producto text, ventas int,
  volumen_gl numeric(12,3), importe_centimos bigint

consola_reporte_stock         -- líneas de STOCK
  reporte_id fk, tanque_id uuid fk, producto text,
  inicio_gl numeric(12,3), final_gl numeric(12,3)
```

- El `importe_total_centimos` de un `ventas_turno` **autocompleta el TOTAL CONSOLA** de ese turno (hoy a mano) → el cuadre se recalcula solo.
- RLS: solo **admin+** (es back-office). Auditoría de ediciones vía el patrón existente.

## 5. Arquitectura local-first

**Enfoque recomendado (proporcionado a la escala, sin infra extra):**
- **IndexedDB con Dexie.js** como base local (Ventas + Seguimiento + imágenes de consola).
- **Escrituras optimistas**: la UI escribe en Dexie y refleja al instante; una **cola de mutaciones (outbox)** registra el cambio.
- **Worker de sync**: al haber conexión, vacía la cola contra Supabase; al reconectar, hace *pull* de cambios (o mantiene la suscripción Realtime → Dexie).
- **Hidratación**: al iniciar sesión, baja los **últimos ~30 días** a Dexie.
- **Conflictos**: **last-write-wins por `updated_at`** (para un admin haciendo el cuadre del día siguiente, los conflictos son rarísimos; el `registro_ventas_log` ya deja rastro).
- **Service Worker (PWA)**: cachea el *app shell* para que la app **cargue sin internet**.

**Alternativa** (si crece la complejidad multi-dispositivo): motores de sync dedicados **PowerSync** o **ElectricSQL** (pensados para Postgres/Supabase). Añaden un servicio aparte → hoy es sobredimensionado; se reevalúa si aparecen conflictos reales.

**Beneficio directo**: inserciones **instantáneas** (sin latencia de red); resiliencia ante caídas de internet y de Supabase.

**Riesgo**: es la pieza más grande; toca el núcleo de Ventas. Mitigación: Supabase sigue siendo la fuente de verdad, LWW simple, y se prueba como fase propia **antes** de montarle el OCR.

## 6. Motor de OCR

**Online (v1) — Edge Function `consola-ocr`:**
1. Recibe la imagen (o su `imagen_path` de Storage).
2. Llama al LLM multimodal con un **esquema JSON estricto**:
```json
{
  "tipo": "ventas_turno|ventas_dia|stock_dia",
  "turno": { "numero": 1, "inicio": "...", "fin": "...", "ventas_total": 283 },
  "productos": [ { "producto": "DB5", "ventas": 22, "volumen": 117.917, "importe": 2308.98 } ],
  "total_rsm": { "ventas": 283, "volumen": 812.831, "importe": 14777.81 },
  "stock": [ { "tanque": 1, "producto": "DB5", "inicio": 540.085, "final": 422.168 } ]
}
```
3. **Valida**: Σ productos = `total_rsm`; `importe ≈ volumen × precio del día` (tolerancia). Si no cuadra → marca dudoso, no autoconfirma.

**Offline (v2) — client-side (WASM):** template matching (OpenCV.js) para ubicar la tabla por ancla + recorte por celda + **Tesseract.js** con whitelist numérica. Mismo esquema de salida. Corre 100% en el navegador.

**Provider del LLM**: decisión de implementación (Gemini 2.5 Flash por costo/latencia vs Claude vision por precisión). El esquema estricto es el mismo para ambos.

## 7. UI en Ventas

- **Zona de carga** (día siguiente): el admin sube las ~6 imágenes; se guardan en Dexie + cola de subida a Storage.
- **Vista previa de lo extraído** por imagen, con las validaciones en verde/ámbar.
- **Confirmar / editar**: al confirmar un `ventas_turno`, su total **autocompleta el TOTAL CONSOLA** del turno. Editar el total → `editado_manual = true` → **alerta al superadmin**.
- **Cruce del día**: aviso si Σ(4 turnos) ≠ consolidado del día.

## 8. Stock consola vs varillaje

- El `stock_dia` (Inicio/Final por tanque de la consola) se **compara** con las lecturas de **varillaje** del mismo día (mapear `tanque` consola 1/2/3 → `tanque_id` de la app).
- Si la diferencia supera una **tolerancia** → se marca posible **descalibración** del tanque (aviso, no bloqueo). Sirve para detectar tanques mal calibrados sin depender de la memoria del operador.

## 9. Fases de entrega

| Fase | Qué | Riesgo | Valor |
|---|---|---|---|
| **1. Fundación local-first — Ventas** | Dexie + outbox + sync worker + service worker + hidratación 30 d. Migrar lecturas/escrituras de Ventas | Alto (núcleo) | Escritura instantánea + offline en el cuadre |
| **2. Local-first — Seguimiento** | Extender el mismo motor | Medio | Consistencia offline en ambos módulos |
| **3. Datos + captura de consola** | Tablas `consola_*`, bucket Storage, UI de carga (local-first) | Bajo | Guardar imágenes + historial |
| **4. Extracción online (LLM)** | Edge Function `consola-ocr` + autocompletado + validaciones + alerta de edición | Medio | El cuadre se autocompleta |
| **5. Stock vs varillaje** | Comparación + aviso de descalibración | Bajo | Control de calibración |
| **6. OCR offline (WASM)** | Template matching + Tesseract.js client-side | Medio-Alto | Lectura sin internet |

**Orden — DECIDIDO (2026-07-15): se empieza por local-first (fases 1 → 2), luego el OCR (3 → 4 → 5), y el OCR offline (6) al final.** (La alternativa de hacer el OCR primero sobre la arquitectura actual se descartó: el usuario prioriza que Ventas/Seguimiento sean local-first e impecables desde ya, porque de ahí salen los descuentos al personal y el cobro de créditos.)

## 10. Decisiones abiertas (para el arranque)

1. ~~Orden~~ → **DECIDIDO**: local-first (fases 1-2) primero.
2. **Provider LLM** (se elige en fase 4): a **~180 imágenes/mes el costo es trivial en cualquier modelo** (centavos a pocos dólares/mes) → elegir por **precisión**, no por costo. Referencia Claude (con prompt caching baja aún más): **Haiku 4.5 ~$0.5–1/mes**, **Sonnet 5 ~$1.5–2/mes**, **Opus 4.8 ~$3/mes**. **Privacidad**: la API **de pago** de Claude **no entrena con tus datos** (política de Anthropic); Gemini **gratis** (AI Studio) sí puede usarlos → usar Claude API o Gemini **de pago**, nunca el gratis. Plan: probar Haiku 4.5 y subir a Sonnet 5 si hace falta precisión.
3. **Motor de sync**: Dexie casero (recomendado) vs PowerSync/ElectricSQL.
4. **Política de conflictos** si algún día hay cuadre multi-dispositivo (hoy: LWW).
5. **Correctitud money-critical**: Supabase sigue siendo la **fuente de verdad**; validaciones server-side (constraints/triggers) + **alertas de inconsistencia** por Realtime; estado de sync visible (pendiente/confirmado); conflictos en campos de dinero se resuelven explícito, no LWW silencioso.
