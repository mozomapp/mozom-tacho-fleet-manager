/**
 * Driver-card download signature verification — Reg (EU) 165/2014 Annex 1C App 11.
 *
 * Gen1 (Part A): RSA-1024 certificates with message recovery (ISO 9796-2 style,
 * CSM_018/019) chained ERCA → MSCA → card; EF signatures RSASSA-PKCS1-v1_5/SHA-1.
 * Gen2 (Part B): ECC card-verifiable certificates ('7F 21' CVC, ECDSA over the
 * '7F 4E' body) chained ERCA(G2) → [link] → MSCA → CardSign; EF signatures ECDSA
 * over SHA-2 sized by the key. Brainpool curves are done in pure JS (@noble) as
 * Electron's BoringSSL lacks them.
 *
 * Root keys are the ERCA publications (dtc.jrc.ec.europa.eu, erca_of_doc/EC_PK.zip
 * and ERCA_Gen2_Root_Certificate.zip), embedded verbatim; copies in resources/erca.
 */
import crypto from 'node:crypto'
import { ecdsa, weierstrass } from '@noble/curves/abstract/weierstrass.js'
import { p256, p384, p521 } from '@noble/curves/nist.js'
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js'
import type { SignatureStatus } from '../shared/types'

// ─── Root keys (SHA-1 EC_PK.bin 7aa6118b…, root cert 27be282a…) ─────────────

const ERCA_GEN1_PK = Buffer.from(
  'fd45432000ffff01e980763a444a95250a958782d1d54acfc323d25f3946b816e92fcf9d32b42a2613d1a363b4e43532a026686329c89663ccc001f7278206b6ab65ad2871848a680f6a57d8fda1d782c9b5812903ea5b66e2a9be1d85bdd0fdae76a46088d71a6176b1f6a98419100424dc56d0846aa3c84390d3517a0f1192dedff740924cdba70000000000010001',
  'hex'
)
const ERCA_GEN2_ROOT_CERT = Buffer.from(
  '7f2181c97f4e81825f2901004208fd45432001ffff015f4c07ff534d5244540d7f494e06092b240303020801010786410408c04e3926c8de85544240cde40dab70d2b47e0f83762522d7b0b8543b9b29dc80e5c67b82a62d55e3483ab4b00a24c2a2566c3786797a1a052822ab4bf1f2925f2008fd45432001ffff015f25045b21b0005f24049b8fae805f374065c62ac13ded147fa8d1d11a8f5bf2cf9e95db1b43d253b48b615b2fe70b3fd82aa8d33d27f0f4d7367c04903bbbe6375b643a19c5b83d19fc7485db476c7067',
  'hex'
)

// ─── Report ─────────────────────────────────────────────────────────────────

export interface CheckLine {
  item: string
  ok: boolean
  note?: string
}
export interface SignatureReport {
  status: SignatureStatus
  summary: string
  checks: CheckLine[]
}

interface Block {
  fid: number
  appendix: number
  data: Buffer
}

function readBlocks(bytes: Buffer): Block[] {
  const out: Block[] = []
  let pos = 0
  while (pos + 5 <= bytes.length) {
    const fid = bytes.readUInt16BE(pos)
    const appendix = bytes[pos + 2] ?? 0
    const len = bytes.readUInt16BE(pos + 3)
    if (pos + 5 + len > bytes.length) break
    out.push({ fid, appendix, data: bytes.subarray(pos + 5, pos + 5 + len) })
    pos += 5 + len
  }
  return out
}

const EF_LABEL: Record<number, string> = {
  0x0501: 'Application_Identification',
  0x0520: 'Identification',
  0x050e: 'Card_Download',
  0x0521: 'Driving_Licence_Info',
  0x0502: 'Events_Data',
  0x0503: 'Faults_Data',
  0x0504: 'Driver_Activity_Data',
  0x0505: 'Vehicles_Used',
  0x0506: 'Places',
  0x0507: 'Current_Usage',
  0x0508: 'Control_Activity_Data',
  0x0522: 'Specific_Conditions',
  0x0523: 'VehicleUnits_Used',
  0x0524: 'GNSS_Places',
  0x0525: 'Application_Identification_V2',
  0x0526: 'Places_Authentication',
  0x0527: 'GNSS_Places_Authentication',
  0x0528: 'Border_Crossings',
  0x0529: 'Load_Unload_Operations',
  0x0530: 'Load_Type_Entries',
  0x0540: 'VU_Configuration'
}
const label = (fid: number): string => EF_LABEL[fid] ?? `EF_${fid.toString(16).padStart(4, '0')}`

// ─── Gen1: RSA with message recovery ────────────────────────────────────────

interface RsaKey {
  n: bigint
  e: bigint
}

function bufToBig(b: Uint8Array): bigint {
  return BigInt(`0x${Buffer.from(b).toString('hex') || '0'}`)
}
function bigToBuf(v: bigint, len: number): Buffer {
  return Buffer.from(v.toString(16).padStart(len * 2, '0'), 'hex')
}
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let r = 1n
  base %= mod
  while (exp > 0n) {
    if (exp & 1n) r = (r * base) % mod
    exp >>= 1n
    base = (base * base) % mod
  }
  return r
}

function gen1RootKey(): RsaKey & { kid: string } {
  return {
    kid: ERCA_GEN1_PK.subarray(0, 8).toString('hex'),
    n: bufToBig(ERCA_GEN1_PK.subarray(8, 136)),
    e: bufToBig(ERCA_GEN1_PK.subarray(136, 144))
  }
}

/** Open a 194-byte Gen1 certificate with the issuer's key; returns the holder's key. */
function openGen1Cert(cert: Buffer, issuer: RsaKey): RsaKey & { chr: string; car: string } {
  if (cert.length !== 194) throw new Error(`certificate is ${cert.length} bytes, expected 194`)
  const sr = bigToBuf(modPow(bufToBig(cert.subarray(0, 128)), issuer.e, issuer.n), 128)
  if (sr[0] !== 0x6a || sr[127] !== 0xbc) throw new Error('signature recovery failed (bad framing)')
  const cPrime = Buffer.concat([sr.subarray(1, 107), cert.subarray(128, 186)])
  const h = crypto.createHash('sha1').update(cPrime).digest()
  if (!h.equals(sr.subarray(107, 127))) throw new Error('certificate hash mismatch')
  return {
    car: cPrime.subarray(1, 9).toString('hex'),
    chr: cPrime.subarray(20, 28).toString('hex'),
    n: bufToBig(cPrime.subarray(28, 156)),
    e: bufToBig(cPrime.subarray(156, 164))
  }
}

function rsaVerifySha1(key: RsaKey, data: Buffer, sig: Buffer): boolean {
  const b64 = (v: bigint): string => {
    let hex = v.toString(16)
    if (hex.length % 2) hex = `0${hex}`
    return Buffer.from(hex, 'hex').toString('base64url')
  }
  const pub = crypto.createPublicKey({ key: { kty: 'RSA', n: b64(key.n), e: b64(key.e) }, format: 'jwk' })
  return crypto.verify('sha1', data, { key: pub, padding: crypto.constants.RSA_PKCS1_PADDING }, sig)
}

function verifyGen1(blocks: Block[], checks: CheckLine[]): void {
  const g1 = blocks.filter((b) => b.appendix <= 1)
  const find = (fid: number, ap: number): Buffer | undefined => g1.find((b) => b.fid === fid && b.appendix === ap)?.data
  const msca = find(0xc108, 0)
  const cardCert = find(0xc100, 0)
  if (!msca || !cardCert) {
    checks.push({ item: 'Gen1 certificates', ok: false, note: 'EF_CA_Certificate / EF_Card_Certificate missing' })
    return
  }
  let cardKey: RsaKey
  try {
    const root = gen1RootKey()
    const mscaKey = openGen1Cert(msca, root)
    checks.push({
      item: 'Gen1 MSCA certificate',
      ok: mscaKey.car === root.kid,
      note: `issuer ${mscaKey.car}, holder ${mscaKey.chr}${mscaKey.car === root.kid ? ' — signed by ERCA' : ' — issuer is not the ERCA root'}`
    })
    const ck = openGen1Cert(cardCert, mscaKey)
    checks.push({ item: 'Gen1 card certificate', ok: true, note: `holder ${ck.chr}, signed by MSCA ${ck.car}` })
    cardKey = ck
  } catch (err) {
    checks.push({ item: 'Gen1 certificate chain', ok: false, note: err instanceof Error ? err.message : String(err) })
    return
  }
  for (const b of g1) {
    if (b.appendix !== 1) continue
    const data = find(b.fid, 0)
    const ok = data !== undefined && rsaVerifySha1(cardKey, data, b.data)
    checks.push({ item: `Gen1 ${label(b.fid)}`, ok, note: ok ? undefined : 'signature does not match data' })
  }
}

// ─── Gen2: ECC card-verifiable certificates ─────────────────────────────────

interface Tlv {
  tag: number
  value: Buffer
  raw: Buffer
}

function tlvList(buf: Buffer): Tlv[] {
  const out: Tlv[] = []
  let pos = 0
  while (pos < buf.length) {
    const start = pos
    let tag = buf[pos++] ?? 0
    if ((tag & 0x1f) === 0x1f) tag = (tag << 8) | (buf[pos++] ?? 0)
    let len = buf[pos++] ?? 0
    if (len === 0x81) len = buf[pos++] ?? 0
    else if (len === 0x82) {
      len = ((buf[pos] ?? 0) << 8) | (buf[pos + 1] ?? 0)
      pos += 2
    } else if (len > 0x7f) break
    out.push({ tag, value: buf.subarray(pos, pos + len), raw: buf.subarray(start, pos + len) })
    pos += len
  }
  return out
}

interface EccKey {
  oid: string
  point: Uint8Array
}
interface Cvc {
  body: Buffer
  car: string
  chr: string
  key: EccKey
  sig: Buffer
}

function parseCvc(cert: Buffer): Cvc {
  const outer = tlvList(cert)[0]
  if (!outer || outer.tag !== 0x7f21) throw new Error('not a CVC (7F21)')
  const parts = tlvList(outer.value)
  const body = parts.find((p) => p.tag === 0x7f4e)
  const sig = parts.find((p) => p.tag === 0x5f37)
  if (!body || !sig) throw new Error('CVC body or signature missing')
  const fields = tlvList(body.value)
  const get = (tag: number): Buffer | undefined => fields.find((f) => f.tag === tag)?.value
  const pk = get(0x7f49)
  if (!pk) throw new Error('CVC public key missing')
  const pkParts = tlvList(pk)
  const oid = pkParts.find((p) => p.tag === 0x06)?.value
  const point = pkParts.find((p) => p.tag === 0x86)?.value
  if (!oid || !point) throw new Error('CVC public key incomplete')
  return {
    body: body.raw,
    car: (get(0x42) ?? Buffer.alloc(0)).toString('hex'),
    chr: (get(0x5f20) ?? Buffer.alloc(0)).toString('hex'),
    key: { oid: oid.toString('hex'), point },
    sig: sig.value
  }
}

const BP256 = weierstrass({
  p: 0xa9fb57dba1eea9bc3e660a909d838d726e3bf623d52620282013481d1f6e5377n,
  n: 0xa9fb57dba1eea9bc3e660a909d838d718c397aa3b561a6f7901e0e82974856a7n,
  h: 1n,
  a: 0x7d5a0975fc2c3057eef67530417affe7fb8055c126dc5c6ce94a4b44f330b5d9n,
  b: 0x26dc5c6ce94a4b44f330b5d9bbd77cbf958416295cf7e1ce6bccdc18ff8c07b6n,
  Gx: 0x8bd2aeb9cb7e57cb2c4b482ffc81b7afb9de27e1e3bd23c23a4453bd9ace3262n,
  Gy: 0x547ef835c3dac4fd97f8461a14611dc9c27745132ded8e545c1d54c72f046997n
})

interface Curve {
  name: string
  verify: (sig: Uint8Array, hash: Uint8Array, pub: Uint8Array) => boolean
  hash: (data: Uint8Array) => Uint8Array
}
const CURVES: Record<string, Curve> = {
  '2b2403030208010107': { name: 'brainpoolP256r1', hash: sha256, verify: (s, h, p) => ecdsa(BP256, sha256).verify(s, h, p, { prehash: false, lowS: false, format: 'compact' }) },
  '2a8648ce3d030107': { name: 'P-256', hash: sha256, verify: (s, h, p) => p256.verify(s, h, p, { prehash: false, lowS: false, format: 'compact' }) },
  '2b81040022': { name: 'P-384', hash: sha384, verify: (s, h, p) => p384.verify(s, h, p, { prehash: false, lowS: false, format: 'compact' }) },
  '2b81040023': { name: 'P-521', hash: sha512, verify: (s, h, p) => p521.verify(s, h, p, { prehash: false, lowS: false, format: 'compact' }) }
}

function eccVerify(signer: EccKey, data: Uint8Array, sig: Uint8Array): boolean {
  const curve = CURVES[signer.oid]
  if (!curve) throw new Error(`unsupported curve OID ${signer.oid}`)
  return curve.verify(sig, curve.hash(data), signer.point)
}

function verifyGen2(blocks: Block[], checks: CheckLine[]): void {
  const g2 = blocks.filter((b) => b.appendix >= 2)
  if (g2.length === 0) return
  const find = (fid: number, ap: number): Buffer | undefined => g2.find((b) => b.fid === fid && b.appendix === ap)?.data
  const isBlank = (b: Buffer | undefined): boolean => !b || b.every((x) => x === 0x00 || x === 0xff)
  try {
    const root = parseCvc(ERCA_GEN2_ROOT_CERT)
    if (!eccVerify(root.key, root.body, root.sig)) throw new Error('embedded ERCA root certificate failed self-check')
    let issuer = root
    const link = find(0xc109, 2)
    if (!isBlank(link)) {
      const l = parseCvc(link as Buffer)
      const ok = l.car === issuer.chr && eccVerify(issuer.key, l.body, l.sig)
      checks.push({ item: 'Gen2 link certificate', ok, note: `${l.chr} issued by ${l.car}` })
      if (!ok) throw new Error('link certificate invalid')
      issuer = l
    }
    const mscaRaw = find(0xc108, 2)
    if (!mscaRaw) throw new Error('EF_CA_Certificate missing')
    const msca = parseCvc(mscaRaw)
    const mscaOk = msca.car === issuer.chr && eccVerify(issuer.key, msca.body, msca.sig)
    checks.push({ item: 'Gen2 MSCA certificate', ok: mscaOk, note: `${msca.chr} issued by ${msca.car}${mscaOk ? ' — chain to ERCA(G2) verified' : ' — not signed by the trusted issuer'}` })
    if (!mscaOk) throw new Error('MSCA certificate invalid')
    for (const [fid, name] of [[0xc100, 'Gen2 card MA certificate'], [0xc101, 'Gen2 card sign certificate']] as const) {
      const raw = find(fid, 2)
      if (!raw) continue
      const c = parseCvc(raw)
      const ok = c.car === msca.chr && eccVerify(msca.key, c.body, c.sig)
      checks.push({ item: name, ok, note: `${c.chr} (${CURVES[c.key.oid]?.name ?? c.key.oid})` })
    }
    const signRaw = find(0xc101, 2)
    if (!signRaw) throw new Error('EF_CardSign_Certificate missing')
    const signKey = parseCvc(signRaw).key
    for (const b of g2) {
      if (b.appendix !== 3) continue
      const data = find(b.fid, 2)
      let ok = false
      let note: string | undefined
      try {
        ok = data !== undefined && eccVerify(signKey, data, b.data)
        if (!ok) note = 'signature does not match data'
      } catch (err) {
        note = err instanceof Error ? err.message : String(err)
      }
      checks.push({ item: `Gen2 ${label(b.fid)}`, ok, note })
    }
  } catch (err) {
    checks.push({ item: 'Gen2 certificate chain', ok: false, note: err instanceof Error ? err.message : String(err) })
  }
}

// ─── Entry point ────────────────────────────────────────────────────────────

export function verifyCardFile(bytes: Buffer): SignatureReport {
  const checks: CheckLine[] = []
  const blocks = readBlocks(bytes)
  if (blocks.length === 0) return { status: 'unverified', summary: 'No TLV blocks found', checks }
  verifyGen1(blocks, checks)
  verifyGen2(blocks, checks)
  const failed = checks.filter((c) => !c.ok)
  const efChecks = checks.filter((c) => !/certificate|chain/i.test(c.item)).length
  if (failed.length === 0) {
    return { status: 'valid', summary: `All ${efChecks} file signatures and certificate chains verified against ERCA root keys`, checks }
  }
  return { status: 'invalid', summary: `${failed.length} check(s) failed: ${failed.map((f) => f.item).join(', ')}`, checks }
}
