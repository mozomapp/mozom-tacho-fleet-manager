/**
 * Tachograph card download protocol — Reg (EU) 165/2014 Annex 1C, Appendix 7 §3
 * (card downloading) over the Appendix 2 card command set (ISO 7816-4 APDUs).
 *
 * Transport-agnostic: caller supplies a `Transmit` that sends one raw APDU and
 * returns the raw response (data + SW1 SW2). Output is the standard download
 * file layout — a sequence of TLV blocks `FID(2) appendix(1) length(2) value`,
 * appendix 0x00/0x01 = Gen1 data/signature, 0x02/0x03 = Gen2 data/signature —
 * byte-compatible with what GloboFleet / any DDE produces for the same card.
 */

export type Transmit = (apdu: Buffer) => Promise<Buffer>

export interface CardProgress {
  message: string
  fid?: number
  generation?: 1 | 2
  bytesSoFar: number
}
export type ProgressFn = (p: CardProgress) => void

export interface CardDownload {
  file: Buffer
  generation: 1 | 2
  /** typeOfTachographCardId from EF_Application_Identification: 1 driver, 2 workshop, 3 control, 4 company. */
  cardType: number
  warnings: string[]
}

export class CardError extends Error {
  readonly sw: number | undefined
  constructor(message: string, sw?: number) {
    super(sw === undefined ? message : `${message} (SW ${sw.toString(16).padStart(4, '0')})`)
    this.sw = sw
  }
}

// ─── Card file system (Appendix 2 §4) ───────────────────────────────────────

/** DF Tachograph AID = 'FF 54 41 43 48 4F' ("\xFFTACHO"). */
const AID_TACHO_G1 = Buffer.from([0xff, 0x54, 0x41, 0x43, 0x48, 0x4f])
/** DF Tachograph_G2 AID = 'FF 53 4D 52 44 54' ("\xFFSMRDT"). */
const AID_TACHO_G2 = Buffer.from([0xff, 0x53, 0x4d, 0x52, 0x44, 0x54])

export const EF_NAMES: Record<number, string> = {
  0x0002: 'EF_ICC',
  0x0005: 'EF_IC',
  0xc100: 'EF_Card_Certificate',
  0xc101: 'EF_CardSign_Certificate',
  0xc108: 'EF_CA_Certificate',
  0xc109: 'EF_Link_Certificate',
  0x0501: 'EF_Application_Identification',
  0x0520: 'EF_Identification',
  0x050e: 'EF_Card_Download',
  0x0521: 'EF_Driving_Licence_Info',
  0x0502: 'EF_Events_Data',
  0x0503: 'EF_Faults_Data',
  0x0504: 'EF_Driver_Activity_Data',
  0x0505: 'EF_Vehicles_Used',
  0x0506: 'EF_Places',
  0x0507: 'EF_Current_Usage',
  0x0508: 'EF_Control_Activity_Data',
  0x0522: 'EF_Specific_Conditions',
  0x0523: 'EF_VehicleUnits_Used',
  0x0524: 'EF_GNSS_Places',
  0x0525: 'EF_Application_Identification_V2',
  0x0526: 'EF_Places_Authentication',
  0x0527: 'EF_GNSS_Places_Authentication',
  0x0528: 'EF_Border_Crossings',
  0x0529: 'EF_Load_Unload_Operations',
  0x0530: 'EF_Load_Type_Entries',
  0x0540: 'EF_VU_Configuration'
}

/** Under the MF; not signed. */
const MF_EFS = [0x0002, 0x0005]
/** Certificates are not signed (they are the signature anchors). */
const G1_CERT_EFS = [0xc100, 0xc108]
const G1_SIGNED_EFS = [
  0x0501, 0x0520, 0x050e, 0x0521, 0x0502, 0x0503, 0x0504, 0x0505, 0x0506, 0x0507, 0x0508, 0x0522
]
const G2_CERT_EFS = [0xc100, 0xc101, 0xc108, 0xc109]
const G2_SIGNED_EFS = [...G1_SIGNED_EFS, 0x0523, 0x0524]
/** Present only on Gen2 v2 cards (2023+); a missing file is skipped, not an error. */
const G2V2_OPTIONAL_SIGNED_EFS = [0x0525, 0x0526, 0x0527, 0x0528, 0x0529, 0x0530, 0x0540]

const EF_APPLICATION_IDENTIFICATION = 0x0501
const EF_CARD_DOWNLOAD = 0x050e
const SW_OK = 0x9000
const SW_EOF_BEFORE_LE = 0x6282
const SW_FILE_NOT_FOUND = 0x6a82
const SW_OFFSET_OUT_OF_RANGE = 0x6b00
const SW_WRONG_LENGTH = 0x6700
const MAX_EF_BYTES = 0x8000

// ─── APDU layer ─────────────────────────────────────────────────────────────

interface Response {
  data: Buffer
  sw: number
}

/**
 * Send one APDU and normalise T=0 quirks: '61 xx' → GET RESPONSE chaining,
 * '6C xx' → re-issue with the Le the card asks for.
 */
async function apdu(
  tx: Transmit,
  cla: number,
  ins: number,
  p1: number,
  p2: number,
  data?: Buffer,
  le?: number
): Promise<Response> {
  const parts: Uint8Array[] = [Buffer.from([cla, ins, p1, p2])]
  if (data && data.length > 0) parts.push(Buffer.from([data.length]), data)
  if (le !== undefined) parts.push(Buffer.from([le]))
  const cmd = Buffer.concat(parts)
  let raw = await tx(cmd)
  if (process.env.TACHO_APDU_DEBUG) {
    process.stderr.write(`> ${cmd.toString('hex')}\n< ${raw.subarray(0, 24).toString('hex')}${raw.length > 24 ? '…' : ''} (${raw.length} B)\n`)
  }
  if (raw.length < 2) throw new CardError('Short APDU response from card')

  let sw = raw.readUInt16BE(raw.length - 2)
  if ((sw & 0xff00) === 0x6c00 && le !== undefined) {
    // Wrong Le: card tells us the exact length available.
    raw = await tx(Buffer.concat([Buffer.from([cla, ins, p1, p2]), Buffer.from([sw & 0xff])]))
    sw = raw.readUInt16BE(raw.length - 2)
  }
  const chunks: Uint8Array[] = [raw.subarray(0, raw.length - 2)]
  while ((sw & 0xff00) === 0x6100) {
    const next = await tx(Buffer.from([0x00, 0xc0, 0x00, 0x00, sw & 0xff]))
    if (next.length < 2) throw new CardError('Short GET RESPONSE from card')
    sw = next.readUInt16BE(next.length - 2)
    chunks.push(next.subarray(0, next.length - 2))
  }
  return { data: Buffer.concat(chunks), sw }
}

async function selectDf(tx: Transmit, aid: Buffer): Promise<boolean> {
  const r = await apdu(tx, 0x00, 0xa4, 0x04, 0x0c, aid)
  if (r.sw === SW_OK) return true
  if (r.sw === SW_FILE_NOT_FOUND) return false
  throw new CardError(`SELECT DF ${aid.toString('hex')} failed`, r.sw)
}

async function selectEf(tx: Transmit, fid: number): Promise<boolean> {
  const r = await apdu(tx, 0x00, 0xa4, 0x02, 0x0c, Buffer.from([fid >> 8, fid & 0xff]))
  if (r.sw === SW_OK) return true
  if (r.sw === SW_FILE_NOT_FOUND) return false
  throw new CardError(`SELECT ${efName(fid)} failed`, r.sw)
}

/**
 * READ BINARY the whole currently-selected EF. Cards signal the end either with
 * '62 82' + partial data, '6B 00' (offset out of range), or — Gen1 cards in the
 * field — '67 00' whenever Le exceeds the bytes remaining, without saying how many
 * remain. For the last case we binary-search the largest Le the card accepts.
 */
async function readEf(tx: Transmit, fid: number): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  let offset = 0
  const le = 0xff
  while (offset < MAX_EF_BYTES) {
    const r = await apdu(tx, 0x00, 0xb0, offset >> 8, offset & 0xff, undefined, le)
    if (r.sw === SW_OK || r.sw === SW_EOF_BEFORE_LE) {
      chunks.push(r.data)
      offset += r.data.length
      if (r.sw === SW_EOF_BEFORE_LE || r.data.length < le || r.data.length === 0) break
      continue
    }
    if (r.sw === SW_OFFSET_OUT_OF_RANGE) break
    if (r.sw === SW_WRONG_LENGTH) {
      const tail = await readRemaining(tx, fid, offset, le - 1)
      if (tail) chunks.push(tail)
      break
    }
    throw new CardError(`READ BINARY ${efName(fid)} @${offset} failed`, r.sw)
  }
  return Buffer.concat(chunks)
}

/** Largest Le in [1, hi] the card accepts at `offset`; returns that read, or null if nothing remains. */
async function readRemaining(
  tx: Transmit,
  fid: number,
  offset: number,
  hi: number
): Promise<Buffer | null> {
  let lo = 0
  let best: Buffer | null = null
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    const r = await apdu(tx, 0x00, 0xb0, offset >> 8, offset & 0xff, undefined, mid)
    if (r.sw === SW_OK || r.sw === SW_EOF_BEFORE_LE) {
      lo = r.data.length
      best = r.data
      if (r.sw === SW_EOF_BEFORE_LE || r.data.length < mid) break
    } else if (r.sw === SW_WRONG_LENGTH) {
      hi = mid - 1
    } else if (r.sw === SW_OFFSET_OUT_OF_RANGE) {
      return null
    } else {
      throw new CardError(`READ BINARY ${efName(fid)} @${offset} Le=${mid} failed`, r.sw)
    }
  }
  return best
}

/** PERFORM HASH OF FILE on the selected EF, then PSO: COMPUTE DIGITAL SIGNATURE. */
async function signEf(tx: Transmit, fid: number, generation: 1 | 2): Promise<Buffer> {
  const h = await apdu(tx, 0x80, 0x2a, 0x90, 0x00)
  if (h.sw !== SW_OK) throw new CardError(`PERFORM HASH OF FILE ${efName(fid)} failed`, h.sw)
  // Gen1: 128-byte RSA signature. Gen2: ECC signature whose length follows the card's
  // curve (P-256/BP-256 → 64, 384 → 96, 521 → 132); cards refuse a non-matching Le with 6700.
  const lengths = generation === 1 ? [0x80] : [0x40, 0x60, 0x84, 0x00]
  let last = SW_WRONG_LENGTH
  for (const le of lengths) {
    const s = await apdu(tx, 0x00, 0x2a, 0x9e, 0x9a, undefined, le)
    if (s.sw === SW_OK) return s.data
    last = s.sw
    if (s.sw !== SW_WRONG_LENGTH) break
  }
  throw new CardError(`COMPUTE DIGITAL SIGNATURE ${efName(fid)} failed`, last)
}

/**
 * Gen2 certificate EFs are fixed-size and padded; the download file carries only the
 * DER-encoded certificate ('7F 21' + length + body), as other DDEs write it.
 */
function trimCertificate(data: Buffer): Buffer {
  if (data.length < 4 || data[0] !== 0x7f || data[1] !== 0x21) return data
  let len = data[2] ?? 0
  let hdr = 3
  if (len === 0x81) {
    len = data[3] ?? 0
    hdr = 4
  } else if (len === 0x82) {
    len = ((data[3] ?? 0) << 8) | (data[4] ?? 0)
    hdr = 5
  } else if (len > 0x7f) {
    return data
  }
  const total = hdr + len
  return total <= data.length ? data.subarray(0, total) : data
}

// ─── Download file assembly ─────────────────────────────────────────────────

function tlv(fid: number, appendix: number, value: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([fid >> 8, fid & 0xff, appendix, value.length >> 8, value.length & 0xff]),
    value
  ])
}

export function efName(fid: number): string {
  return EF_NAMES[fid] ?? `EF_${fid.toString(16).padStart(4, '0')}`
}

/** TimeReal: seconds since epoch, 4 bytes big-endian. */
function timeReal(d: Date): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(Math.floor(d.getTime() / 1000))
  return b
}

export interface DownloadOptions {
  /** Write the download timestamp into EF_Card_Download afterwards (what compliant DDEs do). */
  updateCardDownloadDate: boolean
  onProgress?: ProgressFn
}

/**
 * Download a driver card. Order of blocks follows Appendix 7 (MF files, then
 * the Gen1 application, then — when present — the Gen2 application).
 */
export async function downloadDriverCard(
  tx: Transmit,
  opts: DownloadOptions
): Promise<CardDownload> {
  const blocks: Buffer[] = []
  const warnings: string[] = []
  let bytes = 0
  let cardType = -1
  const progress = (message: string, fid?: number, generation?: 1 | 2): void =>
    opts.onProgress?.({ message, fid, generation, bytesSoFar: bytes })

  const dump = async (
    fid: number,
    generation: 1 | 2 | null,
    signed: boolean,
    optional: boolean
  ): Promise<Buffer | null> => {
    if (!(await selectEf(tx, fid))) {
      if (optional) return null
      throw new CardError(`${efName(fid)} not found on card`)
    }
    let data = await readEf(tx, fid)
    if (generation === 2 && !signed) data = trimCertificate(data)
    const dataAppendix = generation === 2 ? 0x02 : 0x00
    blocks.push(tlv(fid, dataAppendix, data))
    bytes += data.length
    if (signed && generation) {
      const sig = await signEf(tx, fid, generation)
      blocks.push(tlv(fid, dataAppendix + 1, sig))
      bytes += sig.length
    }
    progress(`${efName(fid)}: ${data.length} bytes${signed ? ' + signature' : ''}`, fid, generation ?? undefined)
    return data
  }

  // 1. Master file: ICC + IC identification (unsigned).
  progress('Reading card identification')
  for (const fid of MF_EFS) await dump(fid, null, false, false)

  // 2. Gen1 tachograph application (present on every card, Gen2 included).
  if (!(await selectDf(tx, AID_TACHO_G1))) {
    throw new CardError('DF Tachograph not found — is this a tachograph card?')
  }
  progress('Gen1 application selected', undefined, 1)
  for (const fid of G1_CERT_EFS) await dump(fid, 1, false, false)
  for (const fid of G1_SIGNED_EFS) {
    const data = await dump(fid, 1, true, false)
    if (fid === EF_APPLICATION_IDENTIFICATION && data) {
      cardType = data[0] ?? -1
      if (cardType !== 1) {
        throw new CardError(
          `Not a driver card (typeOfTachographCardId=${cardType}); only driver cards are downloaded here`
        )
      }
    }
  }

  // 3. Gen2 application, when the card has one.
  let generation: 1 | 2 = 1
  if (await selectDf(tx, AID_TACHO_G2)) {
    generation = 2
    progress('Gen2 application selected', undefined, 2)
    for (const fid of G2_CERT_EFS) await dump(fid, 2, false, false)
    for (const fid of G2_SIGNED_EFS) await dump(fid, 2, true, false)
    for (const fid of G2V2_OPTIONAL_SIGNED_EFS) await dump(fid, 2, true, true)
  }

  // 4. Record this download on the card (EF_Card_Download, UPDATE BINARY, TimeReal).
  if (opts.updateCardDownloadDate) {
    const stamp = timeReal(new Date())
    const targets: [Buffer, 1 | 2][] = [[AID_TACHO_G1, 1]]
    if (generation === 2) targets.push([AID_TACHO_G2, 2])
    for (const [aid, gen] of targets) {
      try {
        await selectDf(tx, aid)
        await selectEf(tx, EF_CARD_DOWNLOAD)
        const r = await apdu(tx, 0x00, 0xd6, 0x00, 0x00, stamp)
        if (r.sw !== SW_OK) throw new CardError('UPDATE BINARY EF_Card_Download refused', r.sw)
        progress(`Download date written to card (Gen${gen})`, EF_CARD_DOWNLOAD, gen)
      } catch (err) {
        warnings.push(
          `Could not write download date (Gen${gen}): ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  }

  return { file: Buffer.concat(blocks), generation, cardType, warnings }
}
