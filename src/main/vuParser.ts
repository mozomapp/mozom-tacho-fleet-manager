/**
 * Vehicle-unit download file parser — Reg (EU) 165/2014 Annex 1C, Appendix 7 §2
 * (Gen2 / Gen2 v2 record-array format: TREP 0x21–0x25 and 0x31–0x35).
 * Each TREP is `0x76 <trep>` followed by record arrays `type(1) size(2) count(2) records`,
 * closed by a Signature record array (type 8). Gen1 TREP 0x01–0x05 (fixed layouts,
 * no length fields) are recognised but not decoded.
 */
import type { VuAnalysis, VuDay, VuEvent, VuIwRecord, VuPlace } from '../shared/types'

export interface RecordArray {
  type: number
  size: number
  records: Buffer[]
  /** Offsets within the file. */
  start: number
  end: number
}
export interface Trep {
  id: number
  offset: number
  /** Offset of the first record array (after 0x76 <trep>). */
  dataStart: number
  arrays: RecordArray[]
  /** Offset where the signature record array starts. */
  sigStart: number
  end: number
}

export const RT = {
  ActivityChangeInfo: 1,
  CardSlotsStatus: 2,
  CurrentDateTime: 3,
  MemberStateCertificate: 4,
  OdometerValueMidnight: 5,
  DateOfDayDownloaded: 6,
  Signature: 8,
  SpecificConditionRecord: 9,
  VehicleIdentificationNumber: 10,
  VehicleRegistrationNumber: 11,
  VuCalibrationRecord: 12,
  VuCardIWRecord: 13,
  VuCertificate: 15,
  VuCompanyLocksRecord: 16,
  VuControlActivityRecord: 17,
  VuDownloadablePeriod: 19,
  VuDownloadActivityData: 20,
  VuEventRecord: 21,
  VuGNSSADRecord: 22,
  VuFaultRecord: 24,
  VuIdentification: 25,
  VuOverSpeedingControlData: 26,
  VuOverSpeedingEventRecord: 27,
  VuPlaceDailyWorkPeriodRecord: 28,
  VuTimeAdjustmentRecord: 30,
  VuPowerSupplyInterruptionRecord: 31,
  VehicleRegistrationIdentification: 36
} as const

export function readTreps(b: Buffer): Trep[] {
  const treps: Trep[] = []
  let pos = 0
  while (pos + 2 <= b.length) {
    if (b[pos] !== 0x76) throw new Error(`expected TREP marker 0x76 at ${pos}, found 0x${(b[pos] ?? 0).toString(16)}`)
    const id = b[pos + 1] ?? 0
    if (id < 0x20) throw new Error(`Gen1 vehicle-unit format (TREP 0x${id.toString(16)}) is not supported`)
    const trep: Trep = { id, offset: pos, dataStart: pos + 2, arrays: [], sigStart: -1, end: -1 }
    pos += 2
    while (pos + 5 <= b.length) {
      const type = b[pos] ?? 0
      const size = b.readUInt16BE(pos + 1)
      const count = b.readUInt16BE(pos + 3)
      const end = pos + 5 + size * count
      if (end > b.length) throw new Error(`record array overruns file at ${pos}`)
      const records: Buffer[] = []
      for (let i = 0; i < count; i++) records.push(b.subarray(pos + 5 + i * size, pos + 5 + (i + 1) * size))
      trep.arrays.push({ type, size, records, start: pos, end })
      if (type === RT.Signature) trep.sigStart = pos
      pos = end
      if (type === RT.Signature) break
    }
    trep.end = pos
    treps.push(trep)
  }
  return treps
}

// ─── Primitive decoders ─────────────────────────────────────────────────────

const timeReal = (b: Buffer, o: number): string | null => {
  const v = b.readUInt32BE(o)
  return v === 0 || v === 0xffffffff ? null : new Date(v * 1000).toISOString()
}
const u24 = (b: Buffer, o: number): number => ((b[o] ?? 0) << 16) | ((b[o + 1] ?? 0) << 8) | (b[o + 2] ?? 0)
const str = (b: Buffer, o: number, len: number): string => {
  let s = ''
  for (let i = o; i < o + len; i++) {
    const c = b[i] ?? 0
    if (c === 0 || c === 0xff) break
    s += String.fromCharCode(c)
  }
  return s.trim()
}
/** Annex 1C `Name`: codepage byte + chars. */
const name = (b: Buffer, o: number, len = 36): string => str(b, o + 1, len - 1)
/** FullCardNumberAndGeneration (19): type(1) nation(1) number(16) generation(1). */
const cardRef = (b: Buffer, o: number): { type: number; nation: number; number: string; generation: number } | null => {
  const type = b[o] ?? 0
  if (type === 0) return null
  return { type, nation: b[o + 1] ?? 0, number: str(b, o + 2, 16), generation: b[o + 18] ?? 0 }
}
const NATION: Record<number, string> = { 0x0d: 'D', 0x0f: 'E', 0x11: 'F', 0x1c: 'NL', 0x29: 'RO', 0x2f: 'UK', 0x1e: 'P', 0x18: 'I' }
const nationCode = (n: number): string => NATION[n] ?? `#${n}`

const EVENT_NAMES: Record<number, string> = {
  0x01: 'Insertion of a non-valid card',
  0x02: 'Card conflict',
  0x03: 'Time overlap',
  0x04: 'Driving without an appropriate card',
  0x05: 'Card insertion while driving',
  0x06: 'Last card session not correctly closed',
  0x07: 'Over speeding',
  0x08: 'Power supply interruption',
  0x09: 'Motion data error',
  0x0a: 'Vehicle motion conflict',
  0x0b: 'Time conflict (GNSS vs VU clock)',
  0x0c: 'Communication error with remote communication facility',
  0x0d: 'Absence of position information from GNSS receiver',
  0x0e: 'Communication error with external GNSS facility',
  0x0f: 'GNSS anomaly',
  0x10: 'Security breach attempt (VU)',
  0x11: 'Security breach: motion sensor authentication failure',
  0x12: 'Security breach: tachograph card authentication failure',
  0x13: 'Security breach: unauthorised change of motion sensor',
  0x14: 'Security breach: card data input integrity error',
  0x15: 'Security breach: stored user data integrity error',
  0x16: 'Security breach: internal data transfer error',
  0x17: 'Security breach: unauthorised case opening',
  0x18: 'Security breach: hardware sabotage',
  0x19: 'Security breach: tamper detection of GNSS',
  0x1a: 'Security breach: external GNSS facility authentication failure',
  0x1b: 'Security breach: external GNSS facility certificate expired',
  0x1c: 'Security breach: motion data vs stored driver activity inconsistency',
  0x20: 'Sensor security breach attempt',
  0x21: 'Sensor: authentication failure',
  0x22: 'Sensor: stored data integrity error',
  0x23: 'Sensor: internal data transfer error',
  0x24: 'Sensor: unauthorised case opening',
  0x25: 'Sensor: hardware sabotage',
  0x30: 'VU internal fault',
  0x31: 'Printer fault',
  0x32: 'Display fault',
  0x33: 'Downloading fault',
  0x34: 'Sensor fault',
  0x35: 'Internal GNSS receiver fault',
  0x36: 'External GNSS facility fault',
  0x37: 'Remote communication facility fault',
  0x38: 'ITS interface fault'
}
export const eventName = (t: number): string => EVENT_NAMES[t] ?? `Event 0x${t.toString(16)}`

// ─── Decoders per TREP ──────────────────────────────────────────────────────

const first = (t: Trep, type: number): Buffer | undefined => t.arrays.find((a) => a.type === type)?.records[0]
const all = (t: Trep, type: number): Buffer[] => t.arrays.find((a) => a.type === type)?.records ?? []

function decodeOverview(t: Trep, out: VuAnalysis): void {
  const vin = first(t, RT.VehicleIdentificationNumber)
  const vri = first(t, RT.VehicleRegistrationIdentification)
  const now = first(t, RT.CurrentDateTime)
  const period = first(t, RT.VuDownloadablePeriod)
  const dl = first(t, RT.VuDownloadActivityData)
  out.vin = vin ? str(vin, 0, 17) : out.vin
  if (vri) {
    out.registrationNation = nationCode(vri[0] ?? 0)
    out.registration = name(vri, 1, 14)
  }
  out.vuClockAtDownload = now ? timeReal(now, 0) : null
  if (period) out.downloadablePeriod = { from: timeReal(period, 0), to: timeReal(period, 4) }
  if (dl) {
    const card = cardRef(dl, 4)
    out.previousDownload = { at: timeReal(dl, 0), cardNumber: card?.number ?? null, company: name(dl, 23) }
  }
  out.companyLocks = all(t, RT.VuCompanyLocksRecord).map((r) => ({
    lockedIn: timeReal(r, 0),
    lockedOut: timeReal(r, 4),
    company: name(r, 8),
    cardNumber: cardRef(r, 80)?.number ?? null
  }))
  out.controls = all(t, RT.VuControlActivityRecord)
    .map((r) => ({ type: r[0] ?? 0, at: timeReal(r, 1), cardNumber: cardRef(r, 5)?.number ?? null }))
    .filter((c) => c.at)
}

const ACTIVITY = ['rest', 'availability', 'work', 'driving'] as const

function decodeDay(t: Trep): VuDay | null {
  const date = first(t, RT.DateOfDayDownloaded)
  if (!date) return null
  const odo = first(t, RT.OdometerValueMidnight)
  const day: VuDay = {
    date: (timeReal(date, 0) ?? '').slice(0, 10),
    odometerMidnightKm: odo ? u24(odo, 0) : null,
    distanceKm: null,
    drivingMin: 0,
    noCardDrivingMin: 0,
    crewMin: 0,
    insertions: [],
    places: [],
    gnssFixes: all(t, RT.VuGNSSADRecord).length
  }
  day.insertions = all(t, RT.VuCardIWRecord).map((r): VuIwRecord => {
    const card = cardRef(r, 72)
    return {
      holder: `${name(r, 36)} ${name(r, 0)}`.trim(),
      cardNumber: card?.number ?? '',
      cardNation: card ? nationCode(card.nation) : '',
      slot: (r[106] ?? 0) === 1 ? 'co_driver' : 'driver',
      insertedAt: timeReal(r, 99),
      withdrawnAt: timeReal(r, 107),
      odometerInKm: u24(r, 103),
      odometerOutKm: u24(r, 110),
      manualEntries: (r[130] ?? 0) === 1
    }
  })
  // ActivityChangeInfo (2 bytes): s(1) c(1) p(1) aa(2) ttttttttttt(11)
  const changes = all(t, RT.ActivityChangeInfo)
    .map((r) => {
      const v = r.readUInt16BE(0)
      return { slot: (v >> 15) & 1, crew: ((v >> 14) & 1) === 1, inserted: ((v >> 13) & 1) === 0, activity: ACTIVITY[(v >> 11) & 3] as (typeof ACTIVITY)[number], minute: v & 0x7ff }
    })
    .sort((a, b) => a.minute - b.minute)
  // Walk the driver slot's state machine to minute totals.
  let cur: { activity: string; inserted: boolean; crew: boolean; minute: number } | null = null
  const close = (until: number): void => {
    if (!cur) return
    const mins = Math.max(0, until - cur.minute)
    if (cur.activity === 'driving') {
      day.drivingMin += mins
      if (!cur.inserted) day.noCardDrivingMin += mins
      if (cur.crew) day.crewMin += mins
    }
  }
  for (const c of changes) {
    if (c.slot !== 0) continue
    close(c.minute)
    cur = c
  }
  close(1440)
  day.places = all(t, RT.VuPlaceDailyWorkPeriodRecord).map((r): VuPlace => ({
    cardNumber: cardRef(r, 0)?.number ?? '',
    at: timeReal(r, 19),
    type: (r[23] ?? 0) === 1 ? 'end' : 'begin',
    country: nationCode(r[24] ?? 0),
    odometerKm: u24(r, 26)
  }))
  return day
}

function decodeEvents(t: Trep, out: VuAnalysis): void {
  const ev = (r: Buffer, kind: VuEvent['kind']): VuEvent => ({
    kind,
    type: r[0] ?? 0,
    name: eventName(r[0] ?? 0),
    begin: timeReal(r, 2),
    end: timeReal(r, 6),
    driverCard: cardRef(r, 10)?.number ?? null,
    similar: kind === 'overspeed' ? r[31] ?? 0 : r[86] ?? 0
  })
  out.events.push(...all(t, RT.VuEventRecord).map((r) => ev(r, 'event')))
  out.events.push(...all(t, RT.VuFaultRecord).map((r) => ev(r, 'fault')))
  out.events.push(
    ...all(t, RT.VuOverSpeedingEventRecord).map((r): VuEvent => ({
      kind: 'overspeed',
      type: 0x07,
      name: `Over speeding (max ${r[10] ?? 0} km/h, avg ${r[11] ?? 0} km/h)`,
      begin: timeReal(r, 2),
      end: timeReal(r, 6),
      driverCard: cardRef(r, 12)?.number ?? null,
      similar: r[31] ?? 0
    }))
  )
  out.events.push(...all(t, RT.VuPowerSupplyInterruptionRecord).map((r) => ev(r, 'event')))
  out.events.push(...all(t, RT.VuTimeAdjustmentRecord).map((r): VuEvent => ({ kind: 'event', type: 0xf0, name: `Time adjusted ${timeReal(r, 0) ?? '?'} → ${timeReal(r, 4) ?? '?'} by ${name(r, 8)}`, begin: timeReal(r, 4), end: null, driverCard: null, similar: 0 })))
  out.events.sort((a, b) => (b.begin ?? '').localeCompare(a.begin ?? ''))
}

function decodeTechnical(t: Trep, out: VuAnalysis): void {
  const id = first(t, RT.VuIdentification)
  if (id) {
    out.vu = {
      manufacturer: name(id, 0),
      partNumber: str(id, 72, 16),
      serial: id.subarray(88, 96).toString('hex'),
      softwareVersion: str(id, 96, 4),
      approvalNumber: str(id, 108, 16),
      generation: id[124] ?? 0
    }
  }
  const cals = all(t, RT.VuCalibrationRecord)
    // purpose(1) wsName(36) wsAddress(36) wsCard(18) wsCardExpiry(4) VIN(17) VRI(15) w k l (6) tyre(15) speed(1) oldOdo newOdo (6) oldTime newTime nextCalibration
    .map((r) => ({ purpose: r[0] ?? 0, workshop: name(r, 1), at: timeReal(r, 159) ?? timeReal(r, 155), nextDue: timeReal(r, 163), vin: str(r, 95, 17) }))
    .filter((c) => c.at)
    .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
  out.calibrations = cals
}

export function parseVuFile(bytes: Buffer): VuAnalysis {
  const treps = readTreps(bytes)
  const out: VuAnalysis = {
    generation: treps.some((t) => t.id >= 0x31) ? '2v2' : '2',
    vin: '',
    registration: '',
    registrationNation: '',
    vuClockAtDownload: null,
    downloadablePeriod: null,
    previousDownload: null,
    companyLocks: [],
    controls: [],
    vu: null,
    calibrations: [],
    days: [],
    events: [],
    trepCounts: {}
  }
  for (const t of treps) {
    const k = `0x${t.id.toString(16)}`
    out.trepCounts[k] = (out.trepCounts[k] ?? 0) + 1
    const kind = t.id & 0x0f
    if (kind === 1) decodeOverview(t, out)
    else if (kind === 2) {
      const d = decodeDay(t)
      if (d) out.days.push(d)
    } else if (kind === 3) decodeEvents(t, out)
    else if (kind === 5) decodeTechnical(t, out)
  }
  // OdometerValueMidnight is the reading at the midnight that closes the day (matches
  // the card's per-day distances), so a day's distance is its value minus the previous day's.
  out.days.sort((a, b) => a.date.localeCompare(b.date))
  for (let i = 1; i < out.days.length; i++) {
    const prev = out.days[i - 1] as VuDay
    const day = out.days[i] as VuDay
    if (prev.odometerMidnightKm !== null && day.odometerMidnightKm !== null) day.distanceKm = day.odometerMidnightKm - prev.odometerMidnightKm
  }
  out.days.reverse()
  return out
}
