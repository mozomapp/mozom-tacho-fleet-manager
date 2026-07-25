import type { ArchivedFile, Subject } from '../../../shared/types'

const KIND_LABELS: Record<ArchivedFile['kind'], string> = {
  driver_card: 'Driver card',
  vehicle_unit: 'Vehicle unit',
  unknown: 'Unknown'
}

function fmtSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

interface Props {
  files: ArchivedFile[]
  subjects: Subject[]
  onAssign: (fileId: number, subjectId: number | null) => void
  onReveal: (vaultPath: string) => void
}

export default function FileTable({ files, subjects, onAssign, onReveal }: Props): React.JSX.Element {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-cyan-400">
        Archive ({files.length} files)
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2 pr-3">File</th>
              <th className="py-2 pr-3">Type</th>
              <th className="py-2 pr-3">Downloaded</th>
              <th className="py-2 pr-3">Size</th>
              <th className="py-2 pr-3">Signature</th>
              <th className="py-2 pr-3">Assigned to</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {files.map((f) => (
              <tr key={f.id}>
                <td className="max-w-64 truncate py-2 pr-3 font-mono text-xs" title={f.originalName}>
                  {f.originalName}
                </td>
                <td className="py-2 pr-3">{KIND_LABELS[f.kind]}</td>
                <td className="py-2 pr-3">{new Date(f.downloadedAt).toLocaleDateString()}</td>
                <td className="py-2 pr-3">{fmtSize(f.sizeBytes)}</td>
                <td className="py-2 pr-3">
                  <span
                    className={
                      f.signatureStatus === 'valid'
                        ? 'text-emerald-400'
                        : f.signatureStatus === 'invalid'
                          ? 'text-red-400'
                          : 'text-slate-500'
                    }
                  >
                    {f.signatureStatus}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  <select
                    value={f.subjectId ?? ''}
                    onChange={(e) => onAssign(f.id, e.target.value ? Number(e.target.value) : null)}
                    className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs"
                  >
                    <option value="">— unassigned —</option>
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 text-right">
                  <button
                    onClick={() => onReveal(f.vaultPath)}
                    className="text-xs text-cyan-400 hover:text-cyan-300"
                  >
                    Show
                  </button>
                </td>
              </tr>
            ))}
            {files.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-slate-500">
                  No files archived yet — plug in the Downloadkey and scan, or import files manually.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
