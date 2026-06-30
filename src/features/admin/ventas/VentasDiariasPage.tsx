import { useState, useEffect, useMemo, Fragment } from 'react'
import { supabase } from '@/lib/supabase'
import { formatSoles, sumCentimos } from '@/lib/money'

interface CierreCajaDbRow {
  id: string
  turno_id: number
  fecha: string
  total_consola_centimos: number | null
  yape_centimos: number
  openpay_centimos: number
  deposito_transferencia_centimos: number
  corporacion_centimos: number
  licitaciones_centimos: number
  particulares_centimos: number
  chevron_centimos: number
  serafinado_centimos: number
  contaminacion_centimos: number
  redondeo_centimos: number
  entregado_grifero_centimos: number | null
  contabilizado_admin_centimos: number | null
  colaborador_id: string
  profiles: { nombre: string } | null
  cierre_vales: { monto_centimos: number }[]
}

interface CierreRowCalculated {
  id: string
  turno_id: number
  fecha: string
  colaborador_nombre: string
  total_consola_centimos: number
  yape_centimos: number
  openpay_centimos: number
  deposito_transferencia_centimos: number
  vales_total_centimos: number
  corporacion_centimos: number
  licitaciones_centimos: number
  particulares_centimos: number
  chevron_centimos: number
  serafinado_centimos: number
  contaminacion_centimos: number
  redondeo_centimos: number
  entregado_grifero_centimos: number | null
  contabilizado_admin_centimos: number | null
  efectivo_final_centimos: number
  faltante_sobrante_centimos: number | null
}

type Modo = 'abreviado' | 'completo'

export default function VentasDiariasPage() {
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    return `${y}-${m}`
  })
  const [modo, setModo] = useState<Modo>('abreviado')
  const [loading, setLoading] = useState(false)
  const [cierres, setCierres] = useState<CierreRowCalculated[]>([])

  // Cargar datos al cambiar de mes
  useEffect(() => {
    async function loadCierres() {
      setLoading(true)
      const year = parseInt(selectedMonth.substring(0, 4))
      const month = parseInt(selectedMonth.substring(5, 7))
      const lastDay = new Date(year, month, 0).getDate()
      const startDate = `${selectedMonth}-01`
      const endDate = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`

      try {
        const { data, error } = await supabase
          .from('cierres_caja')
          .select(`
            id,
            turno_id,
            fecha,
            total_consola_centimos,
            yape_centimos,
            openpay_centimos,
            deposito_transferencia_centimos,
            corporacion_centimos,
            licitaciones_centimos,
            particulares_centimos,
            chevron_centimos,
            serafinado_centimos,
            contaminacion_centimos,
            redondeo_centimos,
            entregado_grifero_centimos,
            contabilizado_admin_centimos,
            colaborador_id,
            profiles:colaborador_id ( nombre ),
            cierre_vales ( monto_centimos )
          `)
          .gte('fecha', startDate)
          .lte('fecha', endDate)
          .order('fecha', { ascending: true })
          .order('turno_id', { ascending: true })

        if (error) throw error

        const dbRows = (data as unknown as CierreCajaDbRow[]) || []

        const calculated: CierreRowCalculated[] = dbRows.map((raw) => {
          const totalConsola = raw.total_consola_centimos ?? 0
          const valesTotal = raw.cierre_vales.reduce((sum, v) => sum + v.monto_centimos, 0)
          const creditos =
            raw.corporacion_centimos +
            raw.licitaciones_centimos +
            raw.particulares_centimos +
            raw.chevron_centimos

          // efectivo_final = total_consola - yape - openpay - deposito - vales - creditos - serafinado + redondeo
          const efectivoFinal =
            totalConsola -
            raw.yape_centimos -
            raw.openpay_centimos -
            raw.deposito_transferencia_centimos -
            valesTotal -
            creditos -
            raw.serafinado_centimos +
            raw.redondeo_centimos

          // Si el admin contabilizó, usamos eso; si no, lo entregado por el grifero.
          const refDinero =
            raw.contabilizado_admin_centimos !== null
              ? raw.contabilizado_admin_centimos
              : raw.entregado_grifero_centimos !== null
              ? raw.entregado_grifero_centimos
              : null

          const faltanteSobrante = refDinero !== null ? refDinero - efectivoFinal : null

          return {
            id: raw.id,
            turno_id: raw.turno_id,
            fecha: raw.fecha,
            colaborador_nombre: raw.profiles?.nombre ?? '—',
            total_consola_centimos: totalConsola,
            yape_centimos: raw.yape_centimos,
            openpay_centimos: raw.openpay_centimos,
            deposito_transferencia_centimos: raw.deposito_transferencia_centimos,
            vales_total_centimos: valesTotal,
            corporacion_centimos: raw.corporacion_centimos,
            licitaciones_centimos: raw.licitaciones_centimos,
            particulares_centimos: raw.particulares_centimos,
            chevron_centimos: raw.chevron_centimos,
            serafinado_centimos: raw.serafinado_centimos,
            contaminacion_centimos: raw.contaminacion_centimos,
            redondeo_centimos: raw.redondeo_centimos,
            entregado_grifero_centimos: raw.entregado_grifero_centimos,
            contabilizado_admin_centimos: raw.contabilizado_admin_centimos,
            efectivo_final_centimos: efectivoFinal,
            faltante_sobrante_centimos: faltanteSobrante,
          }
        })

        setCierres(calculated)
      } catch (err) {
        console.error('Error al cargar cierres históricos:', err)
      } finally {
        setLoading(false)
      }
    }

    loadCierres()
  }, [selectedMonth])

  // Agrupar cierres por fecha
  const groupedTestData = useMemo(() => {
    const groups: Record<string, CierreRowCalculated[]> = {}
    for (const c of cierres) {
      if (!groups[c.fecha]) {
        groups[c.fecha] = []
      }
      groups[c.fecha].push(c)
    }
    return groups
  }, [cierres])

  // Nombre del mes para el gran total (ej: "ENERO", "FEBRERO")
  const nombreMes = useMemo(() => {
    const [_, m] = selectedMonth.split('-')
    const meses = [
      'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
      'JULIO', 'AGOSTO', 'SETIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
    ]
    const idx = parseInt(m, 10) - 1
    return meses[idx] || 'TOTAL'
  }, [selectedMonth])

  // Gran Total Mensual
  const totalMensual = useMemo(() => {
    const sum = (key: keyof CierreRowCalculated) =>
      cierres.reduce((acc, c) => acc + (Number(c[key]) || 0), 0)

    const sumNullables = (key: 'entregado_grifero_centimos' | 'contabilizado_admin_centimos' | 'faltante_sobrante_centimos') =>
      cierres.reduce((acc, c) => acc + (c[key] ?? 0), 0)

    return {
      total_consola: sum('total_consola_centimos'),
      yape: sum('yape_centimos'),
      openpay: sum('openpay_centimos'),
      deposito: sum('deposito_transferencia_centimos'),
      vales: sum('vales_total_centimos'),
      corporacion: sum('corporacion_centimos'),
      licitaciones: sum('licitaciones_centimos'),
      particulares: sum('particulares_centimos'),
      chevron: sum('chevron_centimos'),
      serafinado: sum('serafinado_centimos'),
      contaminacion: sum('contaminacion_centimos'),
      redondeo: sum('redondeo_centimos'),
      efectivo_final: sum('efectivo_final_centimos'),
      entregado_grifero: sumNullables('entregado_grifero_centimos'),
      contabilizado_admin: sumNullables('contabilizado_admin_centimos'),
      faltante_sobrante: sumNullables('faltante_sobrante_centimos'),
    }
  }, [cierres])

  // Formateador
  const fs = (v: number | null | undefined) => (v != null ? formatSoles(v) : '—')

  // Formateador especial para diferencia (con color rojo/verde)
  const renderDiferencia = (v: number | null) => {
    if (v === null) return <td className="text-right font-mono text-xs text-app-muted">—</td>
    if (v > 0) return <td className="text-right font-mono text-xs font-semibold text-green-600">+{formatSoles(v)}</td>
    if (v < 0) return <td className="text-right font-mono text-xs font-semibold text-red-600">-{formatSoles(Math.abs(v))}</td>
    return <td className="text-right font-mono text-xs text-app-muted">S/ 0.00</td>
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-slate-50">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-app-border bg-white px-4 py-2 shadow-sm">
        <h1 className="text-base font-bold text-slate-800 mr-4">Histórico de Ventas Diarias</h1>
        
        {/* Selector de Mes */}
        <input
          type="month"
          className="input w-44 text-sm"
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
        />

        {/* Toggle Modo */}
        <div className="ml-auto flex overflow-hidden rounded border border-app-border">
          {([
            ['abreviado', 'ABREVIADO'],
            ['completo', 'COMPLETO'],
          ] as [Modo, string][]).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setModo(m)}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                modo === m
                  ? 'bg-primary text-primary-text'
                  : 'bg-white text-app-muted hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Botón Imprimir / Exportar */}
        <button
          onClick={() => window.print()}
          className="btn bg-slate-800 text-white hover:bg-slate-700 text-xs py-1.5"
        >
          🖨️ Imprimir Reporte
        </button>
      </div>

      {/* Contenido principal */}
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : cierres.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center rounded-lg border-2 border-dashed border-app-border bg-white p-8 text-center shadow-sm">
            <p className="text-base font-medium text-slate-600">No hay registros de ventas para el mes seleccionado.</p>
            <p className="text-xs text-app-muted mt-1">Selecciona otro mes o asegúrate de que los griferos hayan enviado sus cierres de caja.</p>
          </div>
        ) : (
          <div className="inline-block min-w-full align-middle">
            <div className="overflow-hidden rounded-lg border border-app-border bg-white shadow-sm">
              <table className="table-excel min-w-full">
                <thead>
                  <tr>
                    <th style={{ width: 90 }}>FECHA</th>
                    <th style={{ width: 56 }}>TURNO</th>
                    <th style={{ width: 120 }}>INGRESO TOTAL</th>
                    <th style={{ width: 100 }}>YAPE</th>
                    <th style={{ width: 100 }}>OPEN PAY</th>
                    <th style={{ width: 110 }}>DEPÓSITO / TRANS.</th>
                    <th style={{ width: 110 }}>DSCTOS, VALES</th>
                    {modo === 'abreviado' ? (
                      <th style={{ width: 120, background: '#fef9c3', color: '#854d0e' }}>TOTAL CRÉDITOS</th>
                    ) : (
                      <>
                        <th style={{ width: 110, background: '#f1f5f9' }}>CORPORACIÓN</th>
                        <th style={{ width: 110, background: '#f1f5f9' }}>LICITACIONES</th>
                        <th style={{ width: 110, background: '#f1f5f9' }}>PARTICULARES</th>
                        <th style={{ width: 95,  background: '#f1f5f9' }}>CHEVRON</th>
                      </>
                    )}
                    <th style={{ width: 110, background: '#ffedd5', color: '#c2410c' }}>PRUEBAS / SERAF.</th>
                    <th style={{ width: 90 }}>REDONDEO</th>
                    <th style={{ width: 120, background: '#dcfce7', color: '#15803d' }}>EFECTIVO</th>
                    <th style={{ width: 130, background: '#dcfce7', color: '#15803d' }}>ENTREGADO SOBRE</th>
                    <th style={{ width: 130, background: '#dcfce7', color: '#15803d' }}>CONTABILIZADO</th>
                    <th style={{ width: 120, background: '#dcfce7', color: '#15803d' }}>FALTANTE/SOBRANTE</th>
                    <th style={{ width: 110 }}>COLABORADOR</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Fila de Gran Total Mensual */}
                  <tr className="font-semibold" style={{ background: '#ffedd5' }}>
                    <td className="text-left font-bold text-amber-900 px-2 py-1.5" colSpan={2}>
                      {nombreMes}
                    </td>
                    <td className="text-right font-mono text-xs text-amber-900">{fs(totalMensual.total_consola)}</td>
                    <td className="text-right font-mono text-xs text-amber-900">{fs(totalMensual.yape)}</td>
                    <td className="text-right font-mono text-xs text-amber-900">{fs(totalMensual.openpay)}</td>
                    <td className="text-right font-mono text-xs text-amber-900">{fs(totalMensual.deposito)}</td>
                    <td className="text-right font-mono text-xs text-amber-900">{fs(totalMensual.vales)}</td>
                    {modo === 'abreviado' ? (
                      <td className="text-right font-mono text-xs text-amber-900" style={{ background: '#fef9c3' }}>
                        {fs(totalMensual.corporacion + totalMensual.licitaciones + totalMensual.particulares + totalMensual.chevron)}
                      </td>
                    ) : (
                      <>
                        <td className="text-right font-mono text-xs text-amber-900" style={{ background: '#e2e8f0' }}>{fs(totalMensual.corporacion)}</td>
                        <td className="text-right font-mono text-xs text-amber-900" style={{ background: '#e2e8f0' }}>{fs(totalMensual.licitaciones)}</td>
                        <td className="text-right font-mono text-xs text-amber-900" style={{ background: '#e2e8f0' }}>{fs(totalMensual.particulares)}</td>
                        <td className="text-right font-mono text-xs text-amber-900" style={{ background: '#e2e8f0' }}>{fs(totalMensual.chevron)}</td>
                      </>
                    )}
                    <td className="text-right font-mono text-xs text-amber-900" style={{ background: '#fed7aa' }}>{fs(totalMensual.serafinado + totalMensual.contaminacion)}</td>
                    <td className="text-right font-mono text-xs text-amber-900">{fs(totalMensual.redondeo)}</td>
                    <td className="text-right font-mono text-xs text-green-800" style={{ background: '#bbf7d0' }}>{fs(totalMensual.efectivo_final)}</td>
                    <td className="text-right font-mono text-xs text-green-800" style={{ background: '#bbf7d0' }}>{fs(totalMensual.entregado_grifero)}</td>
                    <td className="text-right font-mono text-xs text-green-800" style={{ background: '#bbf7d0' }}>{fs(totalMensual.contabilizado_admin)}</td>
                    {renderDiferencia(totalMensual.faltante_sobrante)}
                    <td className="text-center text-xs text-amber-900">—</td>
                  </tr>

                  {/* Filas Agrupadas por Fecha */}
                  {Object.entries(groupedTestData).map(([fechaString, turnosDelDia]) => {
                    // Ordenar turnos por ID del 1 al 4
                    const turnosOrdenados = [1, 2, 3, 4].map(tNum => {
                      return turnosDelDia.find(c => c.turno_id === tNum) || null
                    })

                    // Calcular totales del día (DIA)
                    const diaTotalConsola = sumCentimos(turnosDelDia.map(c => c.total_consola_centimos))
                    const diaYape = sumCentimos(turnosDelDia.map(c => c.yape_centimos))
                    const diaOpenpay = sumCentimos(turnosDelDia.map(c => c.openpay_centimos))
                    const diaDeposito = sumCentimos(turnosDelDia.map(c => c.deposito_transferencia_centimos))
                    const diaVales = sumCentimos(turnosDelDia.map(c => c.vales_total_centimos))
                    const diaCorporacion = sumCentimos(turnosDelDia.map(c => c.corporacion_centimos))
                    const diaLicitaciones = sumCentimos(turnosDelDia.map(c => c.licitaciones_centimos))
                    const diaParticulares = sumCentimos(turnosDelDia.map(c => c.particulares_centimos))
                    const diaChevron = sumCentimos(turnosDelDia.map(c => c.chevron_centimos))
                    const diaSerafinado = sumCentimos(turnosDelDia.map(c => c.serafinado_centimos))
                    const diaContaminacion = sumCentimos(turnosDelDia.map(c => c.contaminacion_centimos))
                    const diaRedondeo = sumCentimos(turnosDelDia.map(c => c.redondeo_centimos))
                    const diaEfectivoFinal = sumCentimos(turnosDelDia.map(c => c.efectivo_final_centimos))
                    
                    const diaEntregado = turnosDelDia.some(c => c.entregado_grifero_centimos !== null)
                      ? sumCentimos(turnosDelDia.map(c => c.entregado_grifero_centimos))
                      : null
                    
                    const diaContabilizado = turnosDelDia.some(c => c.contabilizado_admin_centimos !== null)
                      ? sumCentimos(turnosDelDia.map(c => c.contabilizado_admin_centimos))
                      : null

                    const diaFaltanteSobrante = (diaContabilizado !== null ? diaContabilizado : (diaEntregado !== null ? diaEntregado : null)) !== null
                      ? (diaContabilizado !== null ? diaContabilizado : (diaEntregado ?? 0)) - diaEfectivoFinal
                      : null

                    // Formatear fecha para el usuario (ej: 15/06/2026)
                    const [yyyy, mm, dd] = fechaString.split('-')
                    const fechaFormateada = `${parseInt(dd, 10)}/${parseInt(mm, 10)}/${yyyy}`

                    return (
                      <Fragment key={fechaString}>
                        {/* Turnos 1 al 4 */}
                        {turnosOrdenados.map((c, idx) => {
                          const tNum = idx + 1
                          if (!c) {
                            // Turno vacío (sin registro)
                            return (
                              <tr key={`${fechaString}-${tNum}`} className="text-slate-300">
                                <td className="text-center text-xs bg-slate-50 font-medium text-slate-400">{fechaFormateada}</td>
                                <td className="text-center text-xs font-bold bg-slate-50 text-slate-400">{tNum}</td>
                                <td colSpan={13} className="text-center text-xs italic py-0.5 text-slate-300">
                                  Sin registros
                                </td>
                              </tr>
                            )
                          }

                          const totalCreditos =
                            c.corporacion_centimos +
                            c.licitaciones_centimos +
                            c.particulares_centimos +
                            c.chevron_centimos

                          return (
                            <tr key={c.id}>
                              <td className="text-center text-xs text-slate-500 bg-slate-50 font-medium">{fechaFormateada}</td>
                              <td className="text-center text-xs font-bold text-slate-700 bg-slate-50">{tNum}</td>
                              <td className="text-right font-mono text-xs">{fs(c.total_consola_centimos)}</td>
                              <td className="text-right font-mono text-xs">{fs(c.yape_centimos)}</td>
                              <td className="text-right font-mono text-xs">{fs(c.openpay_centimos)}</td>
                              <td className="text-right font-mono text-xs">{fs(c.deposito_transferencia_centimos)}</td>
                              <td className="text-right font-mono text-xs">{fs(c.vales_total_centimos)}</td>
                              
                              {modo === 'abreviado' ? (
                                <td className="text-right font-mono text-xs font-medium" style={{ background: '#fef9c3' }}>
                                  {fs(totalCreditos)}
                                </td>
                              ) : (
                                <>
                                  <td className="text-right font-mono text-xs" style={{ background: '#f1f5f9' }}>{fs(c.corporacion_centimos)}</td>
                                  <td className="text-right font-mono text-xs" style={{ background: '#f1f5f9' }}>{fs(c.licitaciones_centimos)}</td>
                                  <td className="text-right font-mono text-xs" style={{ background: '#f1f5f9' }}>{fs(c.particulares_centimos)}</td>
                                  <td className="text-right font-mono text-xs" style={{ background: '#f1f5f9' }}>{fs(c.chevron_centimos)}</td>
                                </>
                              )}

                              <td className="text-right font-mono text-xs" style={{ background: '#fff7ed' }}>
                                {fs(c.serafinado_centimos + c.contaminacion_centimos)}
                              </td>
                              <td className="text-right font-mono text-xs">{fs(c.redondeo_centimos)}</td>
                              <td className="text-right font-mono text-xs font-semibold" style={{ background: '#f0fdf4' }}>{fs(c.efectivo_final_centimos)}</td>
                              <td className="text-right font-mono text-xs" style={{ background: '#f0fdf4' }}>{fs(c.entregado_grifero_centimos)}</td>
                              <td className="text-right font-mono text-xs" style={{ background: '#f0fdf4' }}>{fs(c.contabilizado_admin_centimos)}</td>
                              {renderDiferencia(c.faltante_sobrante_centimos)}
                              <td className="text-center text-xs text-slate-600 truncate" style={{ maxWidth: 100 }}>{c.colaborador_nombre}</td>
                            </tr>
                          )
                        })}

                        {/* Fila consolidada del día (DIA) */}
                        <tr className="font-bold border-b-2 border-slate-300" style={{ background: '#dcfce7' }}>
                          <td className="text-center text-xs text-green-950">{fechaFormateada}</td>
                          <td className="text-center text-xs text-green-950 font-bold">DIA</td>
                          <td className="text-right font-mono text-xs text-green-950">{fs(diaTotalConsola)}</td>
                          <td className="text-right font-mono text-xs text-green-950">{fs(diaYape)}</td>
                          <td className="text-right font-mono text-xs text-green-950">{fs(diaOpenpay)}</td>
                          <td className="text-right font-mono text-xs text-green-950">{fs(diaDeposito)}</td>
                          <td className="text-right font-mono text-xs text-green-950">{fs(diaVales)}</td>
                          
                          {modo === 'abreviado' ? (
                            <td className="text-right font-mono text-xs text-green-950" style={{ background: '#fef9c3' }}>
                              {fs(diaCorporacion + diaLicitaciones + diaParticulares + diaChevron)}
                            </td>
                          ) : (
                            <>
                              <td className="text-right font-mono text-xs text-green-950" style={{ background: '#e2e8f0' }}>{fs(diaCorporacion)}</td>
                              <td className="text-right font-mono text-xs text-green-950" style={{ background: '#e2e8f0' }}>{fs(diaLicitaciones)}</td>
                              <td className="text-right font-mono text-xs text-green-950" style={{ background: '#e2e8f0' }}>{fs(diaParticulares)}</td>
                              <td className="text-right font-mono text-xs text-green-950" style={{ background: '#e2e8f0' }}>{fs(diaChevron)}</td>
                            </>
                          )}

                          <td className="text-right font-mono text-xs text-green-950" style={{ background: '#fed7aa' }}>{fs(diaSerafinado + diaContaminacion)}</td>
                          <td className="text-right font-mono text-xs text-green-950">{fs(diaRedondeo)}</td>
                          <td className="text-right font-mono text-xs text-green-800" style={{ background: '#bbf7d0' }}>{fs(diaEfectivoFinal)}</td>
                          <td className="text-right font-mono text-xs text-green-800" style={{ background: '#bbf7d0' }}>{fs(diaEntregado)}</td>
                          <td className="text-right font-mono text-xs text-green-800" style={{ background: '#bbf7d0' }}>{fs(diaContabilizado)}</td>
                          {renderDiferencia(diaFaltanteSobrante)}
                          <td className="text-center text-xs text-green-950">—</td>
                        </tr>
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
