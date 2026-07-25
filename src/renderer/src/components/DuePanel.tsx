import { useState } from 'react'
import type { DueStatus, Subject, SubjectKind } from '../../../shared/types'

const STATUS_STYLES: Record<DueStatus, { label: string; className: string }> = {
  ok: { label: 'OK', className: 'bg-emerald-500/15 text-emerald-400' },
  due_soon: { label: 'Due soon', className: 'bg-amber-500/15 text-amber-400' },
  overdue: { label: 'OVERDUE', className: 'bg-red-500/15 text-red-400' },
  never: { label: 'No downloads yet', className: 'bg-slate-500/15 text-slate-400' }
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : '—'
}

interface Props {
  subjects: Subject[]
  onCreate: (kind: SubjectKind, label: string) => void
  onAnalyze: (subject: Subject) => void
}

export default function DuePanel({ subjects, onCreate, onAnalyze }: Props): React.JSX.Element {
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<SubjectKind>('driver')

  const submit = (): void => {
    if (!label.trim()) return
    onCreate(kind, label.trim())
    setLabel('')
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-cyan-400">
        Download deadlines
      </h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {subjects.map((s) => {
          const style = STATUS_STYLES[s.dueStatus]
          return (
            <div key={s.id} className="rounded-lg border border-slate-800 bg-slate-950 p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{s.label}</span>
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${style.className}`}>
                  {style.label}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {s.kind === 'driver' ? 'Driver card · every 28 days' : 'Vehicle unit · every 90 days'}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Last: {fmtDate(s.lastDownloadAt)} · Due: {fmtDate(s.dueAt)}
              </p>
              {s.kind === 'driver' && (
                <button
                  onClick={() => onAnalyze(s)}
                  className="mt-2 rounded-md border border-cyan-800 px-2 py-1 text-xs text-cyan-400 hover:bg-cyan-950"
                >
                  Activity & infringements
                </button>
              )}
            </div>
          )
        })}
        {subjects.length === 0 && (
          <p className="text-sm text-slate-500">
            Add your driver card and each vehicle below to start tracking deadlines.
          </p>
        )}
      </div>
      <div className="mt-4 flex gap-2">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as SubjectKind)}
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
        >
          <option value="driver">Driver</option>
          <option value="vehicle">Vehicle</option>
        </select>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={kind === 'driver' ? 'Driver name / card no.' : 'Plate e.g. 1234 ABC'}
          className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm placeholder:text-slate-600"
        />
        <button
          onClick={submit}
          className="rounded-md bg-cyan-500 px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
        >
          Add
        </button>
      </div>
    </section>
  )
}
