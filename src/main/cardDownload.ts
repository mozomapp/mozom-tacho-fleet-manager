/**
 * Office driver-card download: PC/SC reader → Appendix 7 file → vault, with the
 * card holder auto-matched to a driver subject so the 28-day tracker updates.
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseDriverCardFile } from '@mozomdev/tacho'
import type { CardDownloadOptions, CardDownloadResult, CardHolderSummary } from '../shared/types'
import { assignFileSubject, createSubject, findSubjectByLabel } from './db'
import { withCard } from './pcsc'
import { downloadDriverCard, type ProgressFn } from './tachoCard'
import { archiveBuffer } from './vault'

/** Filename-safe: letters, digits, dash; spaces → dash (GloboFleet-style naming). */
function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9-]/g, '')
}

function holderOf(file: Buffer): CardHolderSummary {
  const parsed = parseDriverCardFile(new Uint8Array(file))
  const h = parsed.holder
  if (!h) throw new Error('EF_Identification missing or unreadable in downloaded data')
  return { cardNumber: h.cardNumber, surname: h.surname, firstNames: h.firstNames }
}

/** `C_YYYYMMDD_HHMM_FirstNames_Surname_CardNumber.ddd` (local time, as GloboFleet names them). */
export function cardFileName(h: CardHolderSummary, at: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}_${p(at.getHours())}${p(at.getMinutes())}`
  return `C_${stamp}_${slug(h.firstNames)}_${slug(h.surname)}_${slug(h.cardNumber)}.ddd`
}

export interface RunOptions extends CardDownloadOptions {
  /** Also write a plain copy here (for byte-comparison against GloboFleet output). */
  outDir?: string
  onProgress?: ProgressFn
}

export async function downloadCardToVault(opts: RunOptions): Promise<CardDownloadResult> {
  const started = Date.now()
  const warnings: string[] = []
  try {
    const dl = await withCard(opts.readerName, (tx) =>
      downloadDriverCard(tx, {
        updateCardDownloadDate: opts.updateCardDownloadDate,
        onProgress: opts.onProgress
      })
    )
    warnings.push(...dl.warnings)

    const now = new Date()
    const holder = holderOf(dl.file)
    const fileName = cardFileName(holder, now)
    if (opts.outDir) {
      fs.mkdirSync(opts.outDir, { recursive: true })
      fs.writeFileSync(path.join(opts.outDir, fileName), dl.file)
    }

    const { outcome, file } = archiveBuffer(dl.file, fileName, now.toISOString())
    const label = `${holder.firstNames} ${holder.surname}`.trim()
    const subjectId = findSubjectByLabel('driver', label) ?? createSubject('driver', label)
    if (file.subjectId === null) assignFileSubject(file.id, subjectId)

    return {
      ok: true,
      fileName,
      sizeBytes: dl.file.length,
      generation: dl.generation,
      holder,
      archive: outcome,
      vaultPath: file.vaultPath,
      subjectId,
      durationMs: Date.now() - started,
      warnings
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), warnings }
  }
}
