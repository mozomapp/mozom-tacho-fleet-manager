import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { ArchivedFile, FileKind, ImportResult } from '../shared/types'
import { getFileBySha256, getSettings, insertFile } from './db'
import { verifyCardFile, verifyVuFile } from './signatures'

/**
 * Detect what a tachograph download file contains.
 * Card downloads start with an EF_ICC TLV block (tag 0x00 0x02);
 * VU downloads are a sequence of TREP blocks (tag 0x76).
 * Extension is the fallback for odd country formats (.tgd Spain, .v1b/.c1b France).
 */
export function detectKind(buf: Buffer, name: string): FileKind {
  if (buf.length >= 2) {
    if (buf[0] === 0x76) return 'vehicle_unit'
    if (buf[0] === 0x00 && buf[1] === 0x02) return 'driver_card'
  }
  const ext = path.extname(name).toLowerCase()
  if (ext === '.c1b') return 'driver_card'
  if (ext === '.v1b' || ext === '.v2b') return 'vehicle_unit'
  return 'unknown'
}

/** Best-effort download date: a YYYYMMDD in the filename, else the file's mtime. */
export function inferDownloadDate(name: string, mtime: Date): string {
  const m = name.match(/(20\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])/)
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`).toISOString()
  return mtime.toISOString()
}

function sha256Of(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

/**
 * Archive raw bytes into the vault (and mirror, if configured), read-only,
 * dedup by hash. Originals are never modified or deleted — append-only.
 */
export function archiveBuffer(
  buf: Buffer,
  name: string,
  downloadedAt: string
): { outcome: 'imported' | 'duplicate'; file: ArchivedFile } {
  const hash = sha256Of(buf)
  const existing = getFileBySha256(hash)
  if (existing) return { outcome: 'duplicate', file: existing }

  const { vaultPath, mirrorPath } = getSettings()
  const year = downloadedAt.slice(0, 4)
  const destDir = path.join(vaultPath, 'originals', year)
  fs.mkdirSync(destDir, { recursive: true })
  const destPath = path.join(destDir, `${hash.slice(0, 12)}__${name}`)
  fs.writeFileSync(destPath, buf, { flag: 'wx' })
  fs.chmodSync(destPath, 0o444)

  if (mirrorPath) {
    const mirrorDir = path.join(mirrorPath, 'originals', year)
    fs.mkdirSync(mirrorDir, { recursive: true })
    const mirrorDest = path.join(mirrorDir, path.basename(destPath))
    if (!fs.existsSync(mirrorDest)) {
      fs.copyFileSync(destPath, mirrorDest)
      fs.chmodSync(mirrorDest, 0o444)
    }
  }

  const kind = detectKind(buf, name)
  const sig = signatureOf(buf, kind)
  const record: Omit<ArchivedFile, 'id'> = {
    sha256: hash,
    originalName: name,
    kind,
    subjectId: null,
    downloadedAt,
    importedAt: new Date().toISOString(),
    sizeBytes: buf.length,
    vaultPath: destPath,
    signatureStatus: sig.status,
    signatureReport: sig.report
  }
  return { outcome: 'imported', file: insertFile(record) }
}

/** Verify what we can: driver-card files fully; VU files await the VU parser. */
export function signatureOf(buf: Buffer, kind: FileKind): { status: ArchivedFile['signatureStatus']; report: string } {
  if (kind === 'unknown') return { status: 'unverified', report: 'Unrecognised file format' }
  try {
    const r = kind === 'driver_card' ? verifyCardFile(buf) : verifyVuFile(buf)
    return { status: r.status, report: JSON.stringify(r) }
  } catch (err) {
    return { status: 'unverified', report: `Verification error: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/** Copy one file from disk into the vault. */
function archiveOne(srcPath: string): 'imported' | 'duplicate' {
  const buf = fs.readFileSync(srcPath)
  const stat = fs.statSync(srcPath)
  const name = path.basename(srcPath)
  return archiveBuffer(buf, name, inferDownloadDate(name, stat.mtime)).outcome
}

/** True when the file's bytes are already archived (by hash). */
export function isArchived(srcPath: string): boolean {
  try {
    return getFileBySha256(sha256Of(fs.readFileSync(srcPath))) !== null
  } catch {
    return false
  }
}

export function importFiles(paths: string[]): ImportResult {
  const result: ImportResult = { imported: 0, duplicates: 0, errors: [] }
  for (const p of paths) {
    try {
      const outcome = archiveOne(p)
      if (outcome === 'imported') result.imported++
      else result.duplicates++
    } catch (err) {
      result.errors.push(`${path.basename(p)}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return result
}
