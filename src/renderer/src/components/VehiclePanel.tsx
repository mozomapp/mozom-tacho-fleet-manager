import type { VehicleAnalysis, VuEvent } from '../../../shared/types'

interface Props {
  analysis: VehicleAnalysis
  label: string
  onClose: () => void
}

const fmtDate = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString() : '—')
const fmtDateTime = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString() : '—')
const hm = (min: number): string => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`

function Tile({ title, value, sub, tone }: { title: string; value: string; sub?: string; tone?: string }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{title}</p>
      <p className={`mt-1 text-lg font-semibold ${tone ?? ''}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  )
}

function groupEvents(events: VuEvent[]): { name: string; count: number; last: string | null }[] {
  const m = new Map<string, { name: string; count: number; last: string | null }>()
  for (const e of events) {
    const key = e.kind === 'overspeed' ? 'Over speeding' : e.name
    const g = m.get(key) ?? { name: key, count: 0, last: null }
    g.count++
    if (!g.last || (e.begin ?? '') > g.last) g.last = e.begin
    m.set(key, g)
  }
  return [...m.values()].sort((a, b) => b.count - a.count)
}

export default function VehiclePanel({ analysis, label, onClose }: Props): React.JSX.Element {
  const { vu } = analysis
  const cal = vu.calibrations[0]
  const calDueMs = cal?.nextDue ? Date.parse(cal.nextDue) - Date.now() : null
  const calTone = calDueMs === null ? '' : calDueMs < 0 ? 'text-red-400' : calDueMs < 60 * 86400e3 ? 'text-amber-400' : 'text-emerald-400'
  const noCardTotal = analysis.noCardDays.reduce((n, d) => n + d.minutes, 0)
  const drivingDays = vu.days.filter((d) => d.drivingMin > 0).length
  const groups = groupEvents(vu.events)

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-semibold uppercase tracking-wide text-cyan-400">Vehicle unit — {label}</h2>
          <p className="text-sm text-slate-400">
            {vu.registrationNation} {vu.registration} · VIN {vu.vin} · {vu.vu ? `${vu.vu.manufacturer} ${vu.vu.partNumber} sw ${vu.vu.softwareVersion}` : 'VU unknown'} · Gen{vu.generation} ·{' '}
            {vu.days.length} days recorded from {analysis.filesUsed} file{analysis.filesUsed === 1 ? '' : 's'} · as of {fmtDateTime(analysis.asOf)}
          </p>
        </div>
        <button onClick={onClose} className="text-sm text-slate-400 hover:text-slate-200">
          ✕ Close
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile title="Downloadable period" value={`${fmtDate(vu.downloadablePeriod?.from)} → ${fmtDate(vu.downloadablePeriod?.to)}`} sub={`VU clock ${fmtDateTime(vu.vuClockAtDownload)}`} />
        <Tile title="Previous download" value={fmtDate(vu.previousDownload?.at)} sub={vu.previousDownload?.company || undefined} />
        <Tile title="Next calibration" value={fmtDate(cal?.nextDue)} sub={cal ? `${cal.workshop} · last ${fmtDate(cal.at)}` : 'no calibration record'} tone={calTone} />
        <Tile title="Driving without card" value={hm(noCardTotal)} sub={`${analysis.noCardDays.length} day${analysis.noCardDays.length === 1 ? '' : 's'}`} tone={noCardTotal > 0 ? 'text-amber-400' : 'text-emerald-400'} />
        <Tile title="Company lock" value={vu.companyLocks[0] ? fmtDate(vu.companyLocks[0].lockedIn) : '—'} sub={vu.companyLocks[0]?.company} />
      </div>

      {(analysis.cardGaps.length > 0 || analysis.unknownCards.length > 0) && (
        <div className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium text-amber-300">Card vs vehicle cross-check</p>
          {analysis.cardGaps.slice(0, 10).map((g) => (
            <p key={`${g.date}${g.driver}`} className="text-slate-300">
              {fmtDate(g.date)} — VU recorded {hm(g.drivingMin)} driving for {g.driver}, but their card files have no record for that day.
            </p>
          ))}
          {analysis.cardGaps.length > 10 && <p className="text-slate-400">… {analysis.cardGaps.length - 10} more</p>}
          {analysis.unknownCards.map((u) => (
            <p key={u.cardNumber} className="text-slate-300">
              {u.holder} ({u.cardNumber}) drove this vehicle on {u.days} day{u.days === 1 ? '' : 's'} — no driver with this card in the archive.
            </p>
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Events & faults ({vu.events.length})</h3>
          <table className="mt-2 w-full text-sm">
            <tbody>
              {groups.slice(0, 12).map((g) => (
                <tr key={g.name} className="border-t border-slate-800">
                  <td className="py-1 pr-2 text-slate-300">{g.name}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{g.count}</td>
                  <td className="py-1 text-right text-slate-500">{fmtDate(g.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Recent days ({drivingDays} with driving)</h3>
          <div className="mt-2 max-h-72 overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1">Date</th>
                  <th>Km</th>
                  <th>Driving</th>
                  <th>Driver(s)</th>
                </tr>
              </thead>
              <tbody>
                {vu.days.filter((d) => d.drivingMin > 0 || d.insertions.length > 0).slice(0, 30).map((d) => (
                  <tr key={d.date} className="border-t border-slate-800">
                    <td className="py-1 pr-2">{fmtDate(d.date)}</td>
                    <td className="pr-2 tabular-nums">{d.distanceKm ?? '—'}</td>
                    <td className={`pr-2 tabular-nums ${d.noCardDrivingMin ? 'text-amber-400' : ''}`}>
                      {hm(d.drivingMin)}
                      {d.noCardDrivingMin > 0 && ` (${hm(d.noCardDrivingMin)} no card)`}
                    </td>
                    <td className="text-slate-300">{[...new Set(d.insertions.map((i) => i.holder))].join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  )
}
