import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { ArchivedFile, FileKind, ImportResult } from '../shared/types'
import { fileExists, getSettings, insertFile } from './db'

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
 * Copy one file into the vault (and mirror, if configured), read-only, dedup by hash.
 * Originals are never modified or deleted — the archive is append-only.
 */
function archiveOne(srcPath: string): 'imported' | 'duplicate' {
  const buf = fs.readFileSync(srcPath)
  const hash = sha256Of(buf)
  if (fileExists(hash)) return 'duplicate'

  const { vaultPath, mirrorPath } = getSettings()
  const stat = fs.statSync(srcPath)
  const name = path.basename(srcPath)
  const downloadedAt = inferDownloadDate(name, stat.mtime)
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

  const record: Omit<ArchivedFile, 'id'> = {
    sha256: hash,
    originalName: name,
    kind: detectKind(buf, name),
    subjectId: null,
    downloadedAt,
    importedAt: new Date().toISOString(),
    sizeBytes: stat.size,
    vaultPath: destPath,
    // TODO(phase 1b): verify Gen1 RSA / Gen2 ECC signatures against ERCA public keys.
    signatureStatus: 'unverified'
  }
  insertFile(record)
  return 'imported'
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
