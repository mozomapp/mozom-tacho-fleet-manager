import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import {
  assignFileSubject,
  createSubject,
  getSettings,
  listFiles,
  setSetting
} from './db'
import { importFiles } from './vault'
import { findTachoFiles, scanForDownloadkey } from './importer'
import { listSubjects } from './schedule'
import { analyzeDriver } from './analysis'
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
}

/** Headless mode: `electron . --import <file...>` archives files and exits (for tests/automation). */
function runCliImport(paths: string[]): void {
  const result = importFiles(paths)
  process.stdout.write(`${JSON.stringify(result)}\n`)
  app.exit(result.errors.length > 0 ? 1 : 0)
}

app.whenReady().then(() => {
  const importIdx = process.argv.indexOf('--import')
  if (importIdx !== -1) {
    runCliImport(process.argv.slice(importIdx + 1))
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
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
