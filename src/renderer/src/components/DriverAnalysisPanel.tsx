import type { DriverAnalysis } from '../../../shared/types'

function fmtMin(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : '—'
}

function fmtDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—'
}

const SEVERITY_STYLES: Record<string, string> = {
  minor: 'bg-slate-500/15 text-slate-300',
  serious: 'bg-amber-500/15 text-amber-400',
  very_serious: 'bg-red-500/15 text-red-400'
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-100">{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  )
}

interface Props {
  analysis: DriverAnalysis
  driverLabel: string
  onClose: () => void
}

export default function DriverAnalysisPanel({ analysis, driverLabel, onClose }: Props): React.JSX.Element {
  const { holder, availability: av, infringements, recentDays, weekTotals } = analysis
  const holderName = holder ? `${holder.firstNames} ${holder.surname}` : driverLabel

  return (
    <section className="rounded-xl border border-cyan-900/60 bg-slate-900/60 p-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-cyan-400">
            Driver activity — {holderName}
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            {holder && (
              <>
                Card {holder.cardNumber} · expires {fmtDate(holder.cardExpiryDate)} ·{' '}
              </>
            )}
            {analysis.daysRecorded} recorded days ({fmtDate(analysis.firstDay)} → {fmtDate(analysis.lastDay)}) from{' '}
            {analysis.filesUsed} file{analysis.filesUsed === 1 ? '' : 's'}
          </p>
        </div>
        <button onClick={onClose} className="text-sm text-slate-400 hover:text-slate-200">
          ✕ Close
        </button>
      </div>

      <h3 className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Availability now
      </h3>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Drive left today" value={fmtMin(av.drivingRemainingTodayMin)} />
        <Tile label="Left this week" value={fmtMin(av.drivingRemainingWeekMin)} sub="of 56h" />
        <Tile label="Left this fortnight" value={fmtMin(av.drivingRemainingFortnightMin)} sub="of 90h" />
        <Tile label="Break due after" value={fmtMin(av.breakDueInMin)} sub="of driving" />
        <Tile
          label="Extended days used"
          value={`${av.extendedDrivingDaysUsedThisWeek}/2`}
          sub={`reduced rests ${av.reducedDailyRestsUsed}/3`}
        />
        <Tile label="Weekly rest by" value={fmtDateTime(av.weeklyRestDueAt)} />
      </div>

      <h3 className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Infringements ({infringements.length})
      </h3>
      {infringements.length === 0 ? (
        <p className="text-sm text-emerald-400">No infringements detected in the recorded period.</p>
      ) : (
        <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-800">
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-slate-800">
              {[...infringements].reverse().map((inf, i) => (
                <tr key={i}>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-400">
                    {new Date(inf.at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-semibold ${SEVERITY_STYLES[inf.severity] ?? ''}`}
                    >
                      {inf.severity.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-300">{inf.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Advisory analysis (single-driver rules; double-manned periods may be over-flagged). The signed files
        in the vault remain the legal record.
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Weekly driving (fixed weeks)
          </h3>
          <div className="space-y-1">
            {weekTotals.map((w) => (
              <div key={w.weekStart} className="flex items-center gap-2 text-sm">
                <span className="w-24 shrink-0 text-xs text-slate-400">{fmtDate(w.weekStart)}</span>
                <div className="h-3 flex-1 overflow-hidden rounded bg-slate-800">
                  <div
                    className={`h-full ${w.drivingMin > 3360 ? 'bg-red-500' : 'bg-cyan-500'}`}
                    style={{ width: `${Math.min(100, (w.drivingMin / 3360) * 100)}%` }}
                  />
                </div>
                <span className="w-16 text-right text-xs text-slate-300">{fmtMin(w.drivingMin)}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Recent days
          </h3>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-900 uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-1.5">Date</th>
                  <th className="px-2 py-1.5">Start</th>
                  <th className="px-2 py-1.5">End</th>
                  <th className="px-2 py-1.5">Driving</th>
                  <th className="px-2 py-1.5">Work</th>
                  <th className="px-2 py-1.5">Rest</th>
                  <th className="px-2 py-1.5 text-right">km</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {recentDays.map((d) => (
                  <tr key={d.date} className={d.drivingMin > 0 ? '' : 'text-slate-500'}>
                    <td className="px-2 py-1.5">{fmtDate(d.date)}</td>
                    <td
                      className="max-w-28 truncate px-2 py-1.5"
                      title={d.startPlace ? `${d.startPlace.label} @ ${fmtDateTime(d.startPlace.time)} · odo ${d.startPlace.odometerKm} km` : undefined}
                    >
                      {d.startPlace?.label ?? '—'}
                    </td>
                    <td
                      className="max-w-28 truncate px-2 py-1.5"
                      title={d.endPlace ? `${d.endPlace.label} @ ${fmtDateTime(d.endPlace.time)} · odo ${d.endPlace.odometerKm} km` : undefined}
                    >
                      {d.endPlace?.label ?? '—'}
                    </td>
                    <td className="px-2 py-1.5">{d.drivingMin ? fmtMin(d.drivingMin) : '—'}</td>
                    <td className="px-2 py-1.5">{d.workMin ? fmtMin(d.workMin) : '—'}</td>
                    <td className="px-2 py-1.5">{d.restMin ? fmtMin(d.restMin) : '—'}</td>
                    <td className="px-2 py-1.5 text-right">{d.distanceKm || '—'}</td>
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
