import { contextBridge, ipcRenderer } from 'electron'
import type {
  AnalyzeResult,
  ArchivedFile,
  ImportResult,
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
  importFiles(paths: string[]): Promise<ImportResult>
  pickAndImportFiles(): Promise<ImportResult>
  pickAndImportFolder(): Promise<ImportResult>
  revealInVault(filePath: string): Promise<void>
  analyzeDriver(subjectId: number): Promise<AnalyzeResult>
}

const api: Api = {
  listFiles: () => ipcRenderer.invoke('files:list'),
  assignFile: (fileId, subjectId) => ipcRenderer.invoke('files:assign', fileId, subjectId),
  listSubjects: () => ipcRenderer.invoke('subjects:list'),
  createSubject: (kind, label) => ipcRenderer.invoke('subjects:create', kind, label),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  scanKey: () => ipcRenderer.invoke('import:scanKey'),
  importFiles: (paths) => ipcRenderer.invoke('import:files', paths),
  pickAndImportFiles: () => ipcRenderer.invoke('import:pickFiles'),
  pickAndImportFolder: () => ipcRenderer.invoke('import:pickFolder'),
  revealInVault: (filePath) => ipcRenderer.invoke('vault:reveal', filePath),
  analyzeDriver: (subjectId) => ipcRenderer.invoke('analyze:driver', subjectId)
}

contextBridge.exposeInMainWorld('api', api)
