import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {
  assignFileSubject,
  createSubject,
  getSettings,
  listFiles,
  setSetting,
  updateSignature
} from './db'
import { detectKind, importFiles, isArchived, signatureOf } from './vault'
import { findTachoFiles, scanForDownloadkey, tidyDownloadkey } from './importer'
import { syncMirror } from './mirror'
import { parseVuFile } from './vuParser'
import { listSubjects } from './schedule'
import { analyzeDriver, analyzeVehicle } from './analysis'
import { readerMonitor, waitForCard } from './pcsc'
import { downloadCardToVault } from './cardDownload'
import type { CardDownloadOptions } from '../shared/types'
import type { SubjectKind } from '../shared/types'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    title: 'Mozom Tacho Fleet Manager',
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // ESM preload (electron-vite emits .mjs) requires the renderer to be unsandboxed
      sandbox: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('files:list', () => listFiles())
  ipcMain.handle('files:assign', (_e, fileId: number, subjectId: number | null) =>
    assignFileSubject(fileId, subjectId)
  )
  ipcMain.handle('subjects:list', () => listSubjects())
  ipcMain.handle('subjects:create', (_e, kind: SubjectKind, label: string) =>
    createSubject(kind, label)
  )
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, key: 'vault_path' | 'mirror_path', value: string | null) =>
    setSetting(key, value)
  )
  ipcMain.handle('import:scanKey', () => scanForDownloadkey())
  ipcMain.handle('import:fromKey', () => {
    const scan = scanForDownloadkey()
    const result = importFiles(scan.candidateFiles)
    result.moved = tidyDownloadkey(scan.volumes, scan.candidateFiles, isArchived)
    syncMirror()
    return { scan, result }
  })
  ipcMain.handle('settings:pickDir', async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  ipcMain.handle('mirror:sync', () => syncMirror())
  ipcMain.handle('import:files', (_e, paths: string[]) => importFiles(paths))
  ipcMain.handle('import:pickFiles', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Tachograph files', extensions: ['ddd', 'tgd', 'c1b', 'v1b', 'v2b', 'esm'] }]
    })
    if (res.canceled) return { imported: 0, duplicates: 0, errors: [] }
    return importFiles(res.filePaths)
  })
  ipcMain.handle('import:pickFolder', async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (res.canceled) return { imported: 0, duplicates: 0, errors: [] }
    return importFiles(res.filePaths.flatMap((p) => findTachoFiles(p)))
  })
  ipcMain.handle('vault:reveal', (_e, filePath: string) => shell.showItemInFolder(filePath))
  ipcMain.handle('analyze:driver', (_e, subjectId: number) => analyzeDriver(subjectId))
  ipcMain.handle('analyze:vehicle', (_e, subjectId: number) => analyzeVehicle(subjectId))

  // Office card reader: live reader/card status pushed to every window.
  readerMonitor.start()
  readerMonitor.on('change', () => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('card:readers', readerMonitor.status())
  })
  ipcMain.handle('card:status', () => readerMonitor.status())
  ipcMain.handle('card:download', (e, opts: CardDownloadOptions) =>
    downloadCardToVault({
      ...opts,
      onProgress: (p) => e.sender.send('card:progress', { message: p.message, bytesSoFar: p.bytesSoFar })
    })
  )
}

/**
 * Headless mode: `electron . --card-download [--reader <name>] [--update-card] [--out <dir>]`
 * downloads the inserted driver card into the vault and exits (JSON on stdout, progress on stderr).
 */
async function runCliCardDownload(argv: string[]): Promise<void> {
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name)
    return i === -1 ? undefined : argv[i + 1]
  }
  await waitForCard(10000)
  process.stderr.write(`readers: ${JSON.stringify(readerMonitor.status())}\n`)
  const result = await downloadCardToVault({
    readerName: flag('--reader'),
    updateCardDownloadDate: argv.includes('--update-card'),
    outDir: flag('--out'),
    onProgress: (p) => process.stderr.write(`${p.message}\n`)
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
  readerMonitor.stop()
  app.exit(result.ok ? 0 : 1)
}

/** Headless mode: `electron . --import <file...>` archives files and exits (for tests/automation). */
function runCliImport(paths: string[]): void {
  const result = importFiles(paths)
  process.stdout.write(`${JSON.stringify(result)}\n`)
  app.exit(result.errors.length > 0 ? 1 : 0)
}

// Headless modes must never hang on a crash: report and exit non-zero.
process.on('uncaughtException', (err) => {
  process.stderr.write(`fatal: ${err.stack ?? err.message}\n`)
  app.exit(2)
})
process.on('unhandledRejection', (err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`)
  app.exit(2)
})

app.whenReady().then(() => {
  const importIdx = process.argv.indexOf('--import')
  if (importIdx !== -1) {
    runCliImport(process.argv.slice(importIdx + 1))
    return
  }
  if (process.argv.includes('--import-key')) {
    const scan = scanForDownloadkey()
    const result = importFiles(scan.candidateFiles)
    result.moved = tidyDownloadkey(scan.volumes, scan.candidateFiles, isArchived)
    process.stdout.write(`${JSON.stringify({ scan, result, mirror: syncMirror() })}\n`)
    app.exit(0)
    return
  }
  if (process.argv.includes('--verify-all')) {
    const out = listFiles().map((f) => {
      const r = signatureOf(fs.readFileSync(f.vaultPath), f.kind)
      updateSignature(f.id, r.status, r.report)
      return { id: f.id, name: f.originalName, status: r.status, report: r.report }
    })
    process.stdout.write(`${JSON.stringify(out)}\n`)
    app.exit(0)
    return
  }
  const vuIdx = process.argv.indexOf('--vu')
  if (vuIdx !== -1) {
    process.stdout.write(`${JSON.stringify(parseVuFile(fs.readFileSync(process.argv[vuIdx + 1] as string)))}\n`)
    app.exit(0)
    return
  }
  const verifyIdx = process.argv.indexOf('--verify-file')
  if (verifyIdx !== -1) {
    const file = process.argv[verifyIdx + 1] as string
    const buf = fs.readFileSync(file)
    process.stdout.write(`${JSON.stringify(signatureOf(buf, detectKind(buf, file)))}\n`)
    app.exit(0)
    return
  }
  if (process.argv.includes('--sync-mirror')) {
    process.stdout.write(`${JSON.stringify(syncMirror())}\n`)
    app.exit(0)
    return
  }
  if (process.argv.includes('--card-download')) {
    void runCliCardDownload(process.argv)
    return
  }
  const vehIdx = process.argv.indexOf('--analyze-vehicle')
  if (vehIdx !== -1) {
    const result = analyzeVehicle(Number(process.argv[vehIdx + 1]))
    process.stdout.write(`${JSON.stringify(result)}\n`)
    app.exit(result.ok ? 0 : 1)
    return
  }
  const analyzeIdx = process.argv.indexOf('--analyze')
  if (analyzeIdx !== -1) {
    const result = analyzeDriver(Number(process.argv[analyzeIdx + 1]))
    process.stdout.write(`${JSON.stringify(result)}\n`)
    app.exit(result.ok ? 0 : 1)
    return
  }
  registerIpc()
  createWindow()
  try {
    syncMirror()
  } catch {
    // Mirror unavailable (disk unplugged): the vault is still authoritative.
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
