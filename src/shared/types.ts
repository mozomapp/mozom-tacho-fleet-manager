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
  availability: TachoAvailabilityState
  infringements: Infringement[]
  /** Most recent days first. */
  recentDays: DaySummary[]
  /** Most recent weeks first. */
  weekTotals: WeekTotal[]
}

export type AnalyzeResult = { ok: true; analysis: DriverAnalysis } | { ok: false; error: string }
