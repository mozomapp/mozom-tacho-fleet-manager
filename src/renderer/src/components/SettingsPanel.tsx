import { useEffect, useState } from 'react'
import type { MirrorSyncResult, Settings } from '../../../shared/types'

interface Props {
  fileCount: number
}

/** Vault location (read-only display) and the mirror — the mandatory second copy. */
export default function SettingsPanel({ fileCount }: Props): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [sync, setSync] = useState<MirrorSyncResult | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async (): Promise<void> => setSettings(await window.api.getSettings())
  useEffect(() => {
    void load()
  }, [])

  const runSync = async (): Promise<void> => {
    setBusy(true)
    try {
      setSync(await window.api.syncMirror())
    } finally {
      setBusy(false)
    }
  }

  const chooseMirror = async (): Promise<void> => {
    const dir = await window.api.pickDir()
    if (!dir) return
    await window.api.setSetting('mirror_path', dir)
    await load()
    await runSync()
  }

  const clearMirror = async (): Promise<void> => {
    await window.api.setSetting('mirror_path', null)
    setSync(null)
    await load()
  }

  if (!settings) return <></>
  const mirrored = sync ? sync.copied + sync.present : null

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-sm">
      <h2 className="font-semibold">Storage</h2>
      <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-2">
        <dt className="text-slate-400">Vault</dt>
        <dd className="font-mono text-xs text-slate-300">{settings.vaultPath}</dd>
        <dt className="text-slate-400">Mirror copy</dt>
        <dd className="flex flex-wrap items-center gap-2">
          {settings.mirrorPath ? (
            <span className="font-mono text-xs text-slate-300">{settings.mirrorPath}</span>
          ) : (
            <span className="text-amber-400">
              Not set — the regulation requires a backup copy. Choose a second disk or a synced folder.
            </span>
          )}
          <button
            onClick={() => void chooseMirror()}
            disabled={busy}
            className="rounded-md border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800 disabled:opacity-50"
          >
            {settings.mirrorPath ? 'Change…' : 'Choose folder…'}
          </button>
          {settings.mirrorPath && (
            <>
              <button
                onClick={() => void runSync()}
                disabled={busy}
                className="rounded-md border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800 disabled:opacity-50"
              >
                {busy ? 'Syncing…' : 'Sync now'}
              </button>
              <button
                onClick={() => void clearMirror()}
                disabled={busy}
                className="rounded-md px-2 py-1 text-xs text-slate-500 hover:text-red-400"
              >
                Clear
              </button>
            </>
          )}
        </dd>
        {sync && (
          <>
            <dt className="text-slate-400">Last sync</dt>
            <dd className={sync.errors.length ? 'text-amber-400' : 'text-emerald-400'}>
              {mirrored}/{fileCount} originals mirrored ({sync.copied} copied now)
              {sync.errors.length > 0 && ` · ${sync.errors.length} errors: ${sync.errors.join('; ')}`}
            </dd>
          </>
        )}
      </dl>
    </section>
  )
}
