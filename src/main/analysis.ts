import fs from 'node:fs'
import {
  parseDriverCardFile,
  daysToSegments,
  segmentsToTachoEntries,
  findInfringements,
  availabilityState
} from '@mozomdev/tacho'
import type { DddCardDay, DddCardHolder, DddPlaceRecord, DddSegment } from '@mozomdev/tacho'
import type { AnalyzeResult, DaySummary, PlaceStamp, WeekTotal } from '../shared/types'
import { listFiles } from './db'

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
  const entries = segmentsToTachoEntries(segments, { companyId: 'local', driverUserId: String(subjectId) })
  const now = new Date()
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
      availability: availabilityState(entries, now),
      infringements: findInfringements(entries, now),
      recentDays: summaries.slice(0, 28),
      weekTotals: weekTotals(summaries).slice(0, 6)
    }
  }
}
