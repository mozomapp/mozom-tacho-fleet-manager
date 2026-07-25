import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import type { ArchivedFile, Settings, SubjectKind } from '../shared/types'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db
  const dir = app.getPath('userData')
  fs.mkdirSync(dir, { recursive: true })
  db = new Database(path.join(dir, 'tacho-archive.db'))
  db.pragma('journal_mode = WAL')
  migrate(db)
  return db
}

function migrate(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN ('driver','vehicle')),
      label TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sha256 TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('driver_card','vehicle_unit','unknown')),
      subject_id INTEGER REFERENCES subjects(id),
      downloaded_at TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      vault_path TEXT NOT NULL,
      signature_status TEXT NOT NULL DEFAULT 'unverified'
        CHECK (signature_status IN ('unverified','valid','invalid'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `)
}

interface FileRow {
  id: number
  sha256: string
  original_name: string
  kind: ArchivedFile['kind']
  subject_id: number | null
  downloaded_at: string
  imported_at: string
  size_bytes: number
  vault_path: string
  signature_status: ArchivedFile['signatureStatus']
}

function toArchivedFile(r: FileRow): ArchivedFile {
  return {
    id: r.id,
    sha256: r.sha256,
    originalName: r.original_name,
    kind: r.kind,
    subjectId: r.subject_id,
    downloadedAt: r.downloaded_at,
    importedAt: r.imported_at,
    sizeBytes: r.size_bytes,
    vaultPath: r.vault_path,
    signatureStatus: r.signature_status
  }
}

export function listFiles(): ArchivedFile[] {
  const rows = getDb()
    .prepare('SELECT * FROM files ORDER BY downloaded_at DESC')
    .all() as FileRow[]
  return rows.map(toArchivedFile)
}

export function fileExists(sha256: string): boolean {
  return !!getDb().prepare('SELECT 1 FROM files WHERE sha256 = ?').get(sha256)
}

export function insertFile(f: Omit<ArchivedFile, 'id'>): ArchivedFile {
  const res = getDb()
    .prepare(
      `INSERT INTO files (sha256, original_name, kind, subject_id, downloaded_at,
         imported_at, size_bytes, vault_path, signature_status)
       VALUES (@sha256, @originalName, @kind, @subjectId, @downloadedAt,
         @importedAt, @sizeBytes, @vaultPath, @signatureStatus)`
    )
    .run(f as unknown as Record<string, unknown>)
  return { ...f, id: Number(res.lastInsertRowid) }
}

export function assignFileSubject(fileId: number, subjectId: number | null): void {
  getDb().prepare('UPDATE files SET subject_id = ? WHERE id = ?').run(subjectId, fileId)
}

export function listSubjectRows(): { id: number; kind: SubjectKind; label: string }[] {
  return getDb().prepare('SELECT * FROM subjects ORDER BY kind, label').all() as {
    id: number
    kind: SubjectKind
    label: string
  }[]
}

export function createSubject(kind: SubjectKind, label: string): number {
  const res = getDb()
    .prepare('INSERT INTO subjects (kind, label) VALUES (?, ?)')
    .run(kind, label.trim())
  return Number(res.lastInsertRowid)
}

export function lastDownloadFor(subjectId: number): string | null {
  const row = getDb()
    .prepare('SELECT MAX(downloaded_at) AS last FROM files WHERE subject_id = ?')
    .get(subjectId) as { last: string | null }
  return row.last
}

export function getSettings(): Settings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as {
    key: string
    value: string | null
  }[]
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return {
    vaultPath: map.vault_path ?? path.join(app.getPath('documents'), 'TachoVault'),
    mirrorPath: map.mirror_path ?? null
  }
}

export function setSetting(key: 'vault_path' | 'mirror_path', value: string | null): void {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value)
}
