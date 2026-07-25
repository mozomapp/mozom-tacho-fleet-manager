import fs from 'node:fs'
import path from 'node:path'
import type { ScanResult } from '../shared/types'

const TACHO_EXTENSIONS = new Set(['.ddd', '.tgd', '.c1b', '.v1b', '.v2b', '.esm'])
const MAX_SCAN_DEPTH = 3

/** Recursively find tachograph download files under a directory (bounded depth). */
export function findTachoFiles(dir: string, depth = 0): string[] {
  if (depth > MAX_SCAN_DEPTH) return []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const found: string[] = []
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      found.push(...findTachoFiles(full, depth + 1))
    } else if (TACHO_EXTENSIONS.has(path.extname(e.name).toLowerCase())) {
      found.push(full)
    }
  }
  return found
}

/** List mounted removable/external volume roots for the current platform. */
export function listVolumeRoots(): string[] {
  if (process.platform === 'darwin') {
    try {
      return fs
        .readdirSync('/Volumes')
        .filter((v) => v !== 'Macintosh HD')
        .map((v) => path.join('/Volumes', v))
    } catch {
      return []
    }
  }
  if (process.platform === 'win32') {
    const roots: string[] = []
    for (let c = 68; c <= 90; c++) {
      // D: through Z: — skip A/B (floppy) and C (system)
      const root = `${String.fromCharCode(c)}:\\`
      if (fs.existsSync(root)) roots.push(root)
    }
    return roots
  }
  return []
}

/**
 * Scan attached volumes for tacho download files (the Downloadkey presents as
 * plain USB mass storage). Returns both the volumes seen and candidate files.
 */
export function scanForDownloadkey(): ScanResult {
  const volumes = listVolumeRoots()
  const candidateFiles = volumes.flatMap((v) => findTachoFiles(v))
  return { volumes, candidateFiles }
}
