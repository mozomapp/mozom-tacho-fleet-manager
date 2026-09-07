/**
 * PC/SC transport for the card reader (GloboFleet reader = standard CCID reader).
 * Keeps one long-lived pcsclite context so reader insert/remove and card
 * present/absent are pushed live to the UI. macOS: built-in PCSC.framework;
 * Windows: WinSCard (Smart Card service must be running).
 */
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import type { ReaderStatus } from '../shared/types'
import type { Transmit } from './tachoCard'

interface PcscReader extends EventEmitter {
  name: string
  state: number
  SCARD_STATE_PRESENT: number
  SCARD_SHARE_EXCLUSIVE: number
  SCARD_PROTOCOL_T0: number
  SCARD_PROTOCOL_T1: number
  SCARD_UNPOWER_CARD: number
  connect(
    options: { share_mode?: number; protocol?: number },
    cb: (err: Error | null, protocol: number) => void
  ): void
  disconnect(disposition: number, cb: (err: Error | null) => void): void
  transmit(
    data: Buffer,
    resLen: number,
    protocol: number,
    cb: (err: Error | null, out: Buffer) => void
  ): void
  close(): void
}
interface PcscContext extends EventEmitter {
  close(): void
}

// Native module (no bundled typings); CommonJS, so require() it from ESM.
const require = createRequire(import.meta.url)
const pcsclite = require('@pokusew/pcsclite') as () => PcscContext

interface Tracked {
  reader: PcscReader
  cardPresent: boolean
}

class ReaderMonitor extends EventEmitter {
  private ctx: PcscContext | null = null
  private readers = new Map<string, Tracked>()
  private error: string | null = null

  start(): void {
    if (this.ctx) return
    try {
      this.ctx = pcsclite()
    } catch (err) {
      this.error = `PC/SC unavailable: ${err instanceof Error ? err.message : String(err)}`
      return
    }
    this.ctx.on('error', (err: Error) => {
      this.error = `PC/SC error: ${err.message}`
      this.emit('change')
    })
    this.ctx.on('reader', (reader: PcscReader) => {
      const t: Tracked = { reader, cardPresent: !!(reader.state & reader.SCARD_STATE_PRESENT) }
      this.readers.set(reader.name, t)
      this.error = null
      reader.on('status', (s: { state: number }) => {
        t.cardPresent = !!(s.state & reader.SCARD_STATE_PRESENT)
        this.emit('change')
      })
      reader.on('end', () => {
        this.readers.delete(reader.name)
        this.emit('change')
      })
      reader.on('error', (err: Error) => {
        this.error = `${reader.name}: ${err.message}`
        this.emit('change')
      })
      this.emit('change')
    })
  }

  status(): ReaderStatus {
    return {
      available: this.ctx !== null,
      error: this.error,
      readers: [...this.readers.values()].map((t) => ({
        name: t.reader.name,
        cardPresent: t.cardPresent
      }))
    }
  }

  /** The named reader, else the first reader holding a card, else the first reader. */
  pick(name?: string): Tracked {
    if (name) {
      const t = this.readers.get(name)
      if (!t) throw new Error(`Reader not found: ${name}`)
      return t
    }
    const all = [...this.readers.values()]
    const withCard = all.find((t) => t.cardPresent) ?? all[0]
    if (!withCard) throw new Error('No smart card reader detected — plug in the card reader.')
    return withCard
  }

  stop(): void {
    this.ctx?.close()
    this.ctx = null
    this.readers.clear()
  }
}

export const readerMonitor = new ReaderMonitor()

/**
 * Wait (bounded) until a reader reports a card present — for headless runs, where
 * reader enumeration and the first card-status event arrive asynchronously after start.
 */
export function waitForCard(timeoutMs: number): Promise<boolean> {
  readerMonitor.start()
  const hasCard = (): boolean => readerMonitor.status().readers.some((r) => r.cardPresent)
  return new Promise((resolve) => {
    if (hasCard()) return resolve(true)
    const timer = setTimeout(() => finish(false), timeoutMs)
    const onChange = (): void => {
      if (hasCard()) finish(true)
    }
    function finish(found: boolean): void {
      clearTimeout(timer)
      readerMonitor.off('change', onChange)
      resolve(found)
    }
    readerMonitor.on('change', onChange)
  })
}

/**
 * Connect exclusively to the card, run `fn` with an APDU transmit function,
 * then disconnect with a power-down (so the next connect is a clean reset with
 * the MF selected — the protocol relies on that).
 */
export async function withCard<T>(
  readerName: string | undefined,
  fn: (tx: Transmit) => Promise<T>
): Promise<T> {
  readerMonitor.start()
  const { reader, cardPresent } = readerMonitor.pick(readerName)
  if (!cardPresent) throw new Error(`No card in reader "${reader.name}" — insert the driver card.`)

  const protocol = await new Promise<number>((resolve, reject) =>
    reader.connect(
      {
        share_mode: reader.SCARD_SHARE_EXCLUSIVE,
        protocol: reader.SCARD_PROTOCOL_T0 | reader.SCARD_PROTOCOL_T1
      },
      (err, p) => (err ? reject(err) : resolve(p))
    )
  )
  const tx: Transmit = (apdu) =>
    new Promise((resolve, reject) =>
      reader.transmit(apdu, 258, protocol, (err, out) => (err ? reject(err) : resolve(out)))
    )
  try {
    return await fn(tx)
  } finally {
    await new Promise<void>((resolve) =>
      reader.disconnect(reader.SCARD_UNPOWER_CARD, () => resolve())
    )
  }
}
