import type { DueStatus, Subject } from '../shared/types'
import { DOWNLOAD_INTERVAL_DAYS, DUE_SOON_DAYS } from '../shared/types'
import { lastDownloadFor, listSubjectRows } from './db'

const DAY_MS = 24 * 60 * 60 * 1000

export function dueStatusFor(dueAt: Date, now: Date): DueStatus {
  const daysLeft = (dueAt.getTime() - now.getTime()) / DAY_MS
  if (daysLeft < 0) return 'overdue'
  if (daysLeft <= DUE_SOON_DAYS) return 'due_soon'
  return 'ok'
}

/**
 * Compute the download deadline per subject:
 * last download + 28 days (driver card) / 90 days (vehicle unit), per Reg (EU) 581/2010.
 */
export function listSubjects(now = new Date()): Subject[] {
  return listSubjectRows().map((row) => {
    const last = lastDownloadFor(row.id)
    if (!last) {
      return { ...row, lastDownloadAt: null, dueAt: null, dueStatus: 'never' }
    }
    const dueAt = new Date(new Date(last).getTime() + DOWNLOAD_INTERVAL_DAYS[row.kind] * DAY_MS)
    return {
      ...row,
      lastDownloadAt: last,
      dueAt: dueAt.toISOString(),
      dueStatus: dueStatusFor(dueAt, now)
    }
  })
}
