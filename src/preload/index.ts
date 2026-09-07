import { contextBridge, ipcRenderer } from 'electron'
import type {
  AnalyzeResult,
  ArchivedFile,
  CardDownloadOptions,
  CardDownloadProgress,
  CardDownloadResult,
  ReaderStatus,
  ImportResult,
  MirrorSyncResult,
  ScanResult,
  Settings,
  Subject,
  SubjectKind
} from '../shared/types'

export interface Api {
  listFiles(): Promise<ArchivedFile[]>
  assignFile(fileId: number, subjectId: number | null): Promise<void>
  listSubjects(): Promise<Subject[]>
  createSubject(kind: SubjectKind, label: string): Promise<number>
  getSettings(): Promise<Settings>
  setSetting(key: 'vault_path' | 'mirror_path', value: string | null): Promise<void>
  scanKey(): Promise<ScanResult>
  importFromKey(): Promise<{ scan: ScanResult; result: ImportResult }>
  pickDir(): Promise<string | null>
  syncMirror(): Promise<MirrorSyncResult>
  importFiles(paths: string[]): Promise<ImportResult>
  pickAndImportFiles(): Promise<ImportResult>
  pickAndImportFolder(): Promise<ImportResult>
  revealInVault(filePath: string): Promise<void>
  analyzeDriver(subjectId: number): Promise<AnalyzeResult>
  getReaderStatus(): Promise<ReaderStatus>
  /** Subscribe to reader/card changes; returns an unsubscribe function. */
  onReaderStatus(cb: (s: ReaderStatus) => void): () => void
  downloadCard(opts: CardDownloadOptions): Promise<CardDownloadResult>
  onCardProgress(cb: (p: CardDownloadProgress) => void): () => void
}

const api: Api = {
  listFiles: () => ipcRenderer.invoke('files:list'),
  assignFile: (fileId, subjectId) => ipcRenderer.invoke('files:assign', fileId, subjectId),
  listSubjects: () => ipcRenderer.invoke('subjects:list'),
  createSubject: (kind, label) => ipcRenderer.invoke('subjects:create', kind, label),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  scanKey: () => ipcRenderer.invoke('import:scanKey'),
  importFromKey: () => ipcRenderer.invoke('import:fromKey'),
  pickDir: () => ipcRenderer.invoke('settings:pickDir'),
  syncMirror: () => ipcRenderer.invoke('mirror:sync'),
  importFiles: (paths) => ipcRenderer.invoke('import:files', paths),
  pickAndImportFiles: () => ipcRenderer.invoke('import:pickFiles'),
  pickAndImportFolder: () => ipcRenderer.invoke('import:pickFolder'),
  revealInVault: (filePath) => ipcRenderer.invoke('vault:reveal', filePath),
  analyzeDriver: (subjectId) => ipcRenderer.invoke('analyze:driver', subjectId),
  getReaderStatus: () => ipcRenderer.invoke('card:status'),
  onReaderStatus: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, s: ReaderStatus): void => cb(s)
    ipcRenderer.on('card:readers', listener)
    return () => ipcRenderer.off('card:readers', listener)
  },
  downloadCard: (opts) => ipcRenderer.invoke('card:download', opts),
  onCardProgress: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: CardDownloadProgress): void => cb(p)
    ipcRenderer.on('card:progress', listener)
    return () => ipcRenderer.off('card:progress', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
