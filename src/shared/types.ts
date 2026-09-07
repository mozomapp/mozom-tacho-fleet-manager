// Shared types between main, preload and renderer.

/** Kind of tachograph download file, detected from content/extension. */
export type FileKind = 'driver_card' | 'vehicle_unit' | 'unknown'

/**
 * Signature verification state of an archived file.
 * 'unverified' = archived bit-exact but cryptographic check not yet implemented/run.
 */
export type SignatureStatus = 'unverified' | 'valid' | 'invalid'

export type SubjectKind = 'driver' | 'vehicle'

/** Regulation (EU) 581/2010 maximum download intervals, in days. */
export const DOWNLOAD_INTERVAL_DAYS: Record<SubjectKind, number> = {
  driver: 28,
  vehicle: 90
}

/** Days before the deadline at which we start warning. */
export const DUE_SOON_DAYS = 5

export type DueStatus = 'ok' | 'due_soon' | 'overdue' | 'never'

export interface ArchivedFile {
  id: number
  sha256: string
  originalName: string
  kind: FileKind
  subjectId: number | null
  /** Best-effort download timestamp (filename date, else file mtime). ISO string. */
  downloadedAt: string
  importedAt: string
  sizeBytes: number
  vaultPath: string
  signatureStatus: SignatureStatus
  /** JSON SignatureReport (see main/signatures.ts) or a plain note. */
  signatureReport: string | null
}

export interface Subject {
  id: number
  kind: SubjectKind
  label: string
  lastDownloadAt: string | null
  dueAt: string | null
  dueStatus: DueStatus
}

export interface ImportResult {
  imported: number
  duplicates: number
  errors: string[]
  /** Files moved into the Downloadkey's `downloaded/` folder after archiving (key scans only). */
  moved?: number
}

export interface Settings {
  vaultPath: string
  mirrorPath: string | null
}

export interface ScanResult {
  volumes: string[]
  candidateFiles: string[]
}

// ─── Driver activity analysis (parsed from card .ddd files) ─────────────────

import type { DddCardHolder, Infringement, TachoAvailabilityState } from '@mozomdev/tacho'

export interface PlaceStamp {
  /** e.g. "E · Comunidad Valenciana" or "UK". */
  label: string
  time: string
  odometerKm: number
}

export interface DaySummary {
  /** YYYY-MM-DD (UTC). */
  date: string
  drivingMin: number
  workMin: number
  availabilityMin: number
  restMin: number
  distanceKm: number
  /** First daily-work-period begin declaration of the day. */
  startPlace: PlaceStamp | null
  /** Last daily-work-period end declaration of the day. */
  endPlace: PlaceStamp | null
}

export interface WeekTotal {
  /** Monday of the fixed week, YYYY-MM-DD. */
  weekStart: string
  drivingMin: number
}

export interface DriverAnalysis {
  holder: DddCardHolder | null
  generation: 1 | 2
  filesUsed: number
  daysRecorded: number
  firstDay: string | null
  lastDay: string | null
  /** Newest card download among the files used; the timeline is trusted (and evaluated) up to here. */
  asOf: string
  availability: TachoAvailabilityState
  infringements: Infringement[]
  /** Most recent days first. */
  recentDays: DaySummary[]
  /** Most recent weeks first. */
  weekTotals: WeekTotal[]
}

export type AnalyzeResult = { ok: true; analysis: DriverAnalysis } | { ok: false; error: string }

// ─── Office card reader (PC/SC) ─────────────────────────────────────────────

export interface ReaderState {
  name: string
  cardPresent: boolean
}

export interface ReaderStatus {
  /** false when the PC/SC service itself is unavailable. */
  available: boolean
  error: string | null
  readers: ReaderState[]
}

export interface CardDownloadProgress {
  message: string
  bytesSoFar: number
}

export interface CardDownloadOptions {
  readerName?: string
  /** Write this download's timestamp to EF_Card_Download (what GloboFleet does). */
  updateCardDownloadDate: boolean
}

export interface CardHolderSummary {
  cardNumber: string
  surname: string
  firstNames: string
}

export type CardDownloadResult =
  | {
      ok: true
      fileName: string
      sizeBytes: number
      generation: 1 | 2
      holder: CardHolderSummary
      archive: 'imported' | 'duplicate'
      vaultPath: string
      subjectId: number
      durationMs: number
      warnings: string[]
    }
  | { ok: false; error: string; warnings: string[] }

// ─── Mirror (backup copy) ───────────────────────────────────────────────────

export interface MirrorSyncResult {
  mirrorPath: string | null
  copied: number
  present: number
  errors: string[]
}
