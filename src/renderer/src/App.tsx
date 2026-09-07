import { useCallback, useEffect, useState } from 'react'
import type { ArchivedFile, DriverAnalysis, ImportResult, Subject, SubjectKind, VehicleAnalysis } from '../../shared/types'
import CardReaderPanel from './components/CardReaderPanel'
import DuePanel from './components/DuePanel'
import DriverAnalysisPanel from './components/DriverAnalysisPanel'
import VehiclePanel from './components/VehiclePanel'
import FileTable from './components/FileTable'
import SettingsPanel from './components/SettingsPanel'

export default function App(): React.JSX.Element {
  const [files, setFiles] = useState<ArchivedFile[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [status, setStatus] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [analysis, setAnalysis] = useState<{ subject: Subject; result: DriverAnalysis } | null>(null)
  const [vehicle, setVehicle] = useState<{ subject: Subject; result: VehicleAnalysis } | null>(null)

  const refresh = useCallback(async () => {
    const [f, s] = await Promise.all([window.api.listFiles(), window.api.listSubjects()])
    setFiles(f)
    setSubjects(s)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const reportImport = (r: ImportResult): void => {
    const parts = [`${r.imported} imported`, `${r.duplicates} duplicates`]
    if (r.moved) parts.push(`${r.moved} moved to downloaded/ on the key`)
    if (r.errors.length) parts.push(`${r.errors.length} errors: ${r.errors.join('; ')}`)
    setStatus(parts.join(' · '))
  }

  const runImport = async (fn: () => Promise<ImportResult>): Promise<void> => {
    setBusy(true)
    try {
      reportImport(await fn())
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const scanKey = async (): Promise<void> => {
    setBusy(true)
    try {
      const { scan, result } = await window.api.importFromKey()
      if (scan.candidateFiles.length === 0) {
        setStatus(
          scan.volumes.length === 0
            ? 'No removable drives detected — plug in the Downloadkey.'
            : `No tacho files found on: ${scan.volumes.join(', ')}`
        )
        return
      }
      reportImport(result)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const createSubject = async (kind: SubjectKind, label: string): Promise<void> => {
    await window.api.createSubject(kind, label)
    await refresh()
  }

  const assign = async (fileId: number, subjectId: number | null): Promise<void> => {
    await window.api.assignFile(fileId, subjectId)
    await refresh()
  }

  const analyze = async (subject: Subject): Promise<void> => {
    setBusy(true)
    try {
      if (subject.kind === 'vehicle') {
        const v = await window.api.analyzeVehicle(subject.id)
        if (v.ok) {
          setVehicle({ subject, result: v.analysis })
          setStatus('')
        } else {
          setVehicle(null)
          setStatus(v.error)
        }
        return
      }
      const res = await window.api.analyzeDriver(subject.id)
      if (res.ok) {
        setAnalysis({ subject, result: res.analysis })
        setStatus('')
      } else {
        setAnalysis(null)
        setStatus(res.error)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Mozom Tacho Fleet Manager</h1>
          <p className="text-sm text-slate-400">
            Tachograph download archive — driver card every 28 days, vehicle unit every 90 days.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void scanKey()}
            disabled={busy}
            className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
          >
            Scan Downloadkey
          </button>
          <button
            onClick={() => void runImport(() => window.api.pickAndImportFiles())}
            disabled={busy}
            className="rounded-md border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"
          >
            Import files…
          </button>
          <button
            onClick={() => void runImport(() => window.api.pickAndImportFolder())}
            disabled={busy}
            className="rounded-md border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"
          >
            Import folder…
          </button>
        </div>
      </header>

      {status && (
        <p className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-300">
          {status}
        </p>
      )}

      <CardReaderPanel onDownloaded={() => void refresh()} />

      <DuePanel
        subjects={subjects}
        onCreate={(k, l) => void createSubject(k, l)}
        onAnalyze={(s) => void analyze(s)}
      />
      {vehicle && (
        <VehiclePanel analysis={vehicle.result} label={vehicle.subject.label} onClose={() => setVehicle(null)} />
      )}
      {analysis && (
        <DriverAnalysisPanel
          analysis={analysis.result}
          driverLabel={analysis.subject.label}
          onClose={() => setAnalysis(null)}
        />
      )}
      <FileTable
        files={files}
        subjects={subjects}
        onAssign={(f, s) => void assign(f, s)}
        onReveal={(p) => void window.api.revealInVault(p)}
      />
      <SettingsPanel fileCount={files.length} />
    </div>
  )
}
