import fs from 'node:fs'
import {
  parseDriverCardFile,
  daysToSegments,
  segmentsToTachoEntries,
  findInfringements,
  availabilityState
} from '@mozomdev/tacho'
import { parseVuFile } from './vuParser'
import type { VehicleAnalysis, VehicleAnalyzeResult, VuAnalysis, VuDay, VuEvent } from '../shared/types'
import type { DddCardDay, DddCardHolder, DddPlaceRecord, DddSegment } from '@mozomdev/tacho'
import type { AnalyzeResult, ArchivedFile, DaySummary, PlaceStamp, WeekTotal } from '../shared/types'
import { listFiles, listSubjectRows } from './db'

const MINUTE_MS = 60_000
const DAY_MS = 1440 * MINUTE_MS

function placeStamp(p: DddPlaceRecord): PlaceStamp {
  return {
    label: p.regionName ? `${p.countryCode} · ${p.regionName}` : p.countryCode,
    time: p.time,
    odometerKm: p.odometerKm
  }
}

function daySummaries(segments: DddSegment[], days: DddCardDay[], places: DddPlaceRecord[]): DaySummary[] {
  const distByDate = new Map<string, number>()
  for (const d of days) distByDate.set(d.date.slice(0, 10), d.distanceKm)

  // First begin / last end declaration per calendar day (places arrive sorted).
  const startByDate = new Map<string, PlaceStamp>()
  const endByDate = new Map<string, PlaceStamp>()
  for (const p of places) {
    const date = p.time.slice(0, 10)
    if (p.type === 'begin') {
      if (!startByDate.has(date)) startByDate.set(date, placeStamp(p))
    } else {
      endByDate.set(date, placeStamp(p))
    }
  }

  const byDate = new Map<string, DaySummary>()
  for (const s of segments) {
    let start = Date.parse(s.startedAt)
    const end = Date.parse(s.endedAt)
    while (start < end) {
      const dayStart = Math.floor(start / DAY_MS) * DAY_MS
      const chunkEnd = Math.min(end, dayStart + DAY_MS)
      const date = new Date(dayStart).toISOString().slice(0, 10)
      const row = byDate.get(date) ?? {
        date,
        drivingMin: 0,
        workMin: 0,
        availabilityMin: 0,
        restMin: 0,
        distanceKm: distByDate.get(date) ?? 0,
        startPlace: startByDate.get(date) ?? null,
        endPlace: endByDate.get(date) ?? null
      }
      const mins = Math.round((chunkEnd - start) / MINUTE_MS)
      if (s.activity === 'driving') row.drivingMin += mins
      else if (s.activity === 'work') row.workMin += mins
      else if (s.activity === 'availability') row.availabilityMin += mins
      else row.restMin += mins
      byDate.set(date, row)
      start = chunkEnd
    }
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1))
}

function weekTotals(summaries: DaySummary[]): WeekTotal[] {
  const totals = new Map<string, number>()
  for (const d of summaries) {
    const ms = Date.parse(`${d.date}T00:00:00Z`)
    const day = (new Date(ms).getUTCDay() + 6) % 7
    const monday = new Date(ms - day * DAY_MS).toISOString().slice(0, 10)
    totals.set(monday, (totals.get(monday) ?? 0) + d.drivingMin)
  }
  return [...totals.entries()]
    .map(([weekStart, drivingMin]) => ({ weekStart, drivingMin }))
    .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))
}

/** Parse every card file assigned to the driver subject and analyze the merged timeline. */
export function analyzeDriver(subjectId: number): AnalyzeResult {
  const files = listFiles().filter((f) => f.subjectId === subjectId && f.kind === 'driver_card')
  if (files.length === 0) {
    return { ok: false, error: 'No driver card files assigned to this driver yet — import and assign one first.' }
  }

  let holder: DddCardHolder | null = null
  let generation: 1 | 2 = 1
  const allDays: DddCardDay[] = []
  const placeMap = new Map<string, DddPlaceRecord>()
  for (const f of files) {
    try {
      const card = parseDriverCardFile(new Uint8Array(fs.readFileSync(f.vaultPath)))
      holder = card.holder ?? holder
      if (card.generation === 2) generation = 2
      allDays.push(...card.days)
      for (const p of card.places) placeMap.set(`${p.time}|${p.type}`, p)
    } catch (err) {
      return { ok: false, error: `Failed to parse ${f.originalName}: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  const segments = daysToSegments(allDays)
  if (segments.length === 0) return { ok: false, error: 'Card files contain no activity data.' }

  // The card is authoritative up to its newest download: time after the last recorded
  // change with no record means the card was out of any tachograph, i.e. rest — the same
  // rule daysToSegments applies between recorded days. Beyond the download we know nothing,
  // so the analysis is evaluated "as of" that moment, not the wall clock.
  const asOf = files.map((f) => f.downloadedAt).sort().at(-1) as string
  const last = segments[segments.length - 1] as DddSegment
  if (Date.parse(last.endedAt) < Date.parse(asOf)) {
    segments.push({ activity: 'rest', startedAt: last.endedAt, endedAt: asOf, cardInserted: false })
  }
  const entries = segmentsToTachoEntries(segments, { companyId: 'local', driverUserId: String(subjectId) })
  const now = new Date(asOf)
  const places = [...placeMap.values()].sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
  const summaries = daySummaries(segments, allDays, places)

  const dates = [...new Set(allDays.map((d) => d.date.slice(0, 10)))].sort()
  return {
    ok: true,
    analysis: {
      holder,
      generation,
      filesUsed: files.length,
      daysRecorded: dates.length,
      firstDay: dates[0] ?? null,
      lastDay: dates[dates.length - 1] ?? null,
      asOf,
      availability: availabilityState(entries, now),
      infringements: findInfringements(entries, now),
      recentDays: summaries.slice(0, 28),
      weekTotals: weekTotals(summaries).slice(0, 6)
    }
  }
}


/** Card numbers + recorded dates per driver subject, from their newest card file. */
function knownDrivers(): { subjectId: number; label: string; cardNumber: string; dates: Set<string> }[] {
  const out: { subjectId: number; label: string; cardNumber: string; dates: Set<string> }[] = []
  const bySubject = new Map<number, ArchivedFile[]>()
  for (const f of listFiles()) {
    if (f.kind !== 'driver_card' || f.subjectId === null) continue
    bySubject.set(f.subjectId, [...(bySubject.get(f.subjectId) ?? []), f])
  }
  const labels = new Map(listSubjectRows().map((s) => [s.id, s.label]))
  for (const [subjectId, files] of bySubject) {
    const dates = new Set<string>()
    let cardNumber = ''
    for (const f of files) {
      try {
        const card = parseDriverCardFile(new Uint8Array(fs.readFileSync(f.vaultPath)))
        cardNumber = card.holder?.cardNumber ?? cardNumber
        for (const d of card.days) dates.add(d.date.slice(0, 10))
      } catch {
        // unreadable file: skip
      }
    }
    if (cardNumber) out.push({ subjectId, label: labels.get(subjectId) ?? String(subjectId), cardNumber, dates })
  }
  return out
}

/** Merge every VU file assigned to a vehicle (newest wins per day) and cross-check against driver cards. */
export function analyzeVehicle(subjectId: number): VehicleAnalyzeResult {
  const files = listFiles()
    .filter((f) => f.subjectId === subjectId && f.kind === 'vehicle_unit')
    .sort((a, b) => a.downloadedAt.localeCompare(b.downloadedAt))
  if (files.length === 0) return { ok: false, error: 'No vehicle-unit files assigned to this vehicle yet.' }

  let merged: VuAnalysis | null = null
  const days = new Map<string, VuDay>()
  const events = new Map<string, VuEvent>()
  for (const f of files) {
    try {
      const vu = parseVuFile(fs.readFileSync(f.vaultPath))
      for (const d of vu.days) days.set(d.date, d)
      for (const e of vu.events) events.set(`${e.kind}|${e.type}|${e.begin}`, e)
      merged = vu
    } catch (err) {
      return { ok: false, error: `Failed to parse ${f.originalName}: ${err instanceof Error ? err.message : String(err)}` }
    }
  }
  if (!merged) return { ok: false, error: 'No parsable vehicle-unit data.' }
  merged.days = [...days.values()].sort((a, b) => b.date.localeCompare(a.date))
  merged.events = [...events.values()].sort((a, b) => (b.begin ?? '').localeCompare(a.begin ?? ''))

  const drivers = knownDrivers()
  const cardGaps: VehicleAnalysis['cardGaps'] = []
  const unknownCards = new Map<string, { holder: string; cardNumber: string; days: number }>()
  for (const d of merged.days) {
    if (d.drivingMin === 0) continue
    for (const ins of d.insertions) {
      if (ins.slot !== 'driver' || !ins.cardNumber) continue
      const known = drivers.find((k) => k.cardNumber === ins.cardNumber)
      if (!known) {
        const u = unknownCards.get(ins.cardNumber) ?? { holder: ins.holder, cardNumber: ins.cardNumber, days: 0 }
        u.days++
        unknownCards.set(ins.cardNumber, u)
      } else if (!known.dates.has(d.date)) {
        cardGaps.push({ date: d.date, driver: known.label, drivingMin: d.drivingMin })
      }
    }
  }
  const noCardDays = merged.days.filter((d) => d.noCardDrivingMin > 0).map((d) => ({ date: d.date, minutes: d.noCardDrivingMin }))
  const analysis: VehicleAnalysis = {
    vu: merged,
    filesUsed: files.length,
    asOf: files[files.length - 1]?.downloadedAt ?? '',
    knownDrivers: drivers.map((k) => ({ label: k.label, cardNumber: k.cardNumber })),
    unknownCards: [...unknownCards.values()],
    cardGaps,
    noCardDays
  }
  return { ok: true, analysis }
}
