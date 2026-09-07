import fs from 'node:fs'
import path from 'node:path'
import { getSettings, listFiles } from './db'
import type { MirrorSyncResult } from '../shared/types'

/**
 * Backfill the mirror (second copy) with every vault original that is missing
 * there. Idempotent; never deletes. Files are laid out as in the vault:
 * <mirror>/originals/<year>/<hashprefix>__<name>.
 */
export function syncMirror(): MirrorSyncResult {
  const { mirrorPath } = getSettings()
  const result: MirrorSyncResult = { mirrorPath, copied: 0, present: 0, errors: [] }
  if (!mirrorPath) return result
  for (const f of listFiles()) {
    const year = f.downloadedAt.slice(0, 4)
    const dir = path.join(mirrorPath, 'originals', year)
    const dest = path.join(dir, path.basename(f.vaultPath))
    try {
      if (fs.existsSync(dest)) {
        result.present++
        continue
      }
      fs.mkdirSync(dir, { recursive: true })
      fs.copyFileSync(f.vaultPath, dest)
      fs.chmodSync(dest, 0o444)
      result.copied++
    } catch (err) {
      result.errors.push(`${f.originalName}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return result
}
