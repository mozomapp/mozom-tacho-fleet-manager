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

// ─── Vehicle unit (VU) download analysis ────────────────────────────────────

export interface VuIwRecord {
  holder: string
  cardNumber: string
  cardNation: string
  slot: 'driver' | 'co_driver'
  insertedAt: string | null
  withdrawnAt: string | null
  odometerInKm: number
  odometerOutKm: number
  manualEntries: boolean
}
export interface VuPlace {
  cardNumber: string
  at: string | null
  type: 'begin' | 'end'
  country: string
  odometerKm: number
}
export interface VuDay {
  date: string
  odometerMidnightKm: number | null
  distanceKm: number | null
  /** Driver-slot driving minutes recorded by the VU. */
  drivingMin: number
  /** Driving minutes with no card in the driver slot. */
  noCardDrivingMin: number
  /** Driving minutes flagged as crew (double-manned). */
  crewMin: number
  insertions: VuIwRecord[]
  places: VuPlace[]
  gnssFixes: number
}
export interface VuEvent {
  kind: 'event' | 'fault' | 'overspeed'
  type: number
  name: string
  begin: string | null
  end: string | null
  driverCard: string | null
  similar: number
}
export interface VuAnalysis {
  generation: '2' | '2v2'
  vin: string
  registration: string
  registrationNation: string
  vuClockAtDownload: string | null
  downloadablePeriod: { from: string | null; to: string | null } | null
  previousDownload: { at: string | null; cardNumber: string | null; company: string } | null
  companyLocks: { lockedIn: string | null; lockedOut: string | null; company: string; cardNumber: string | null }[]
  controls: { type: number; at: string | null; cardNumber: string | null }[]
  vu: { manufacturer: string; partNumber: string; serial: string; softwareVersion: string; approvalNumber: string; generation: number } | null
  calibrations: { purpose: number; workshop: string; at: string | null; nextDue: string | null; vin: string }[]
  /** Most recent first. */
  days: VuDay[]
  /** Most recent first. */
  events: VuEvent[]
  trepCounts: Record<string, number>
}

export interface VehicleAnalysis {
  vu: VuAnalysis
  filesUsed: number
  asOf: string
  knownDrivers: { label: string; cardNumber: string }[]
  /** Driver cards seen in the VU with no matching driver in this archive. */
  unknownCards: { holder: string; cardNumber: string; days: number }[]
  /** Days the VU recorded driving for a known driver whose card files have no record that day. */
  cardGaps: { date: string; driver: string; drivingMin: number }[]
  noCardDays: { date: string; minutes: number }[]
}
export type VehicleAnalyzeResult = { ok: true; analysis: VehicleAnalysis } | { ok: false; error: string }
