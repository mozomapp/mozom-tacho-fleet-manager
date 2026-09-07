import { useEffect, useState } from 'react'
import type { CardDownloadResult, ReaderStatus } from '../../../shared/types'

interface Props {
  onDownloaded: () => void
}

function readerLine(s: ReaderStatus): { text: string; tone: string } {
  if (!s.available) return { text: s.error ?? 'Smart card service unavailable', tone: 'text-red-400' }
  if (s.readers.length === 0) return { text: 'No card reader detected — plug in the reader.', tone: 'text-slate-400' }
  const withCard = s.readers.find((r) => r.cardPresent)
  if (withCard) return { text: `Card inserted in ${withCard.name}`, tone: 'text-emerald-400' }
  return { text: `Reader ready: ${s.readers.map((r) => r.name).join(', ')} — insert a driver card.`, tone: 'text-slate-300' }
}

export default function CardReaderPanel({ onDownloaded }: Props): React.JSX.Element {
  const [status, setStatus] = useState<ReaderStatus>({ available: false, error: null, readers: [] })
  const [updateCard, setUpdateCard] = useState(true)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [result, setResult] = useState<CardDownloadResult | null>(null)

  useEffect(() => {
    void window.api.getReaderStatus().then(setStatus)
    const offStatus = window.api.onReaderStatus(setStatus)
    const offProgress = window.api.onCardProgress((p) => setLog((l) => [...l, p.message]))
    return () => {
      offStatus()
      offProgress()
    }
  }, [])

  const cardPresent = status.readers.some((r) => r.cardPresent)

  const download = async (): Promise<void> => {
    setBusy(true)
    setLog([])
    setResult(null)
    try {
      const r = await window.api.downloadCard({ updateCardDownloadDate: updateCard })
      setResult(r)
      if (r.ok) onDownloaded()
    } finally {
      setBusy(false)
    }
  }

  const line = readerLine(status)

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Office card reader</h2>
          <p className={`text-sm ${line.tone}`}>{line.text}</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={updateCard}
              onChange={(e) => setUpdateCard(e.target.checked)}
              className="accent-cyan-500"
            />
            Write download date to card
          </label>
          <button
            onClick={() => void download()}
            disabled={busy || !cardPresent}
            className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
          >
            {busy ? 'Downloading…' : 'Download driver card'}
          </button>
        </div>
      </div>

      {(log.length > 0 || result) && (
        <div className="mt-3 space-y-2">
          {log.length > 0 && (
            <pre className="max-h-40 overflow-auto rounded-md bg-slate-950 p-2 text-xs text-slate-400">
              {log.join('\n')}
            </pre>
          )}
          {result &&
            (result.ok ? (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
                <p className="font-medium text-emerald-300">
                  {result.holder.firstNames} {result.holder.surname} · {result.holder.cardNumber} · Gen
                  {result.generation}
                </p>
                <p className="text-slate-300">
                  {result.fileName} — {result.sizeBytes.toLocaleString()} bytes in{' '}
                  {(result.durationMs / 1000).toFixed(1)}s ·{' '}
                  {result.archive === 'imported' ? 'archived to vault' : 'identical to an existing archive (no new data on card)'}
                </p>
                {result.warnings.map((w) => (
                  <p key={w} className="text-amber-400">
                    {w}
                  </p>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                {result.error}
                {result.warnings.map((w) => (
                  <p key={w} className="text-amber-400">
                    {w}
                  </p>
                ))}
              </div>
            ))}
        </div>
      )}
    </section>
  )
}
