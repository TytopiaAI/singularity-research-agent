export type LatexEngine = 'tectonic' | 'pdflatex' | 'xelatex' | 'lualatex'
export interface LatexFile { path: string; size: number; editable: boolean }
export interface LatexProject { id: string; title: string; mainFile: string; engine: LatexEngine; updatedAt: string; files: LatexFile[]; pdfBuild?: string }
export interface LatexDocument { path: string; text: string; revision: string }
export interface LatexDiagnostic { file: string; line: number; message: string; severity: 'error' | 'warning' }
export interface LatexBuild { id: string; projectId: string; status: 'running' | 'success' | 'failed' | 'cancelled'; log: string; diagnostics: LatexDiagnostic[]; pdfUrl?: string; startedAt: string; duration?: number }
export interface LatexVersion { id: string; createdAt: string; size: number }
export interface LatexCompiler { engine: LatexEngine; available: boolean; path?: string }
export interface LatexSyncPoint { file: string; line: number; page: number; x: number; y: number }
export interface LatexApi {
  list(): Promise<LatexProject[]>
  project(id: string): Promise<LatexProject>
  create(title: string): Promise<LatexProject>
  importZip(): Promise<LatexProject | null>
  read(id: string, file: string): Promise<LatexDocument>
  save(id: string, file: string, text: string, revision: string): Promise<LatexDocument>
  configure(id: string, mainFile: string, engine: LatexEngine): Promise<LatexProject>
  createFile(id: string, file: string): Promise<LatexProject>
  renameFile(id: string, file: string, next: string): Promise<LatexProject>
  removeFile(id: string, file: string): Promise<LatexProject>
  uploadFiles(id: string): Promise<LatexProject>
  compile(id: string): Promise<LatexBuild>
  build(id: string): Promise<LatexBuild | null>
  cancel(id: string): Promise<void>
  versions(id: string, file: string): Promise<LatexVersion[]>
  restore(id: string, file: string, version: string, revision: string): Promise<LatexDocument>
  exportZip(id: string): Promise<boolean>
  exportPdf(id: string): Promise<boolean>
  compilers(): Promise<LatexCompiler[]>
  selectCompiler(engine: LatexEngine): Promise<LatexCompiler[]>
  installCompiler(): Promise<LatexCompiler[]>
  sync(id: string, buildId: string): Promise<LatexSyncPoint[]>
}
export const latexTextExtensions = /\.(tex|bib|sty|cls|bst|bbx|cbx|cfg|def|clo|tikz|pgf|txt|md|csv|tsv|json|xml|yaml|yml|toml|bbl|ltx|dtx|ins)$/i
export const latexEngines: LatexEngine[] = ['tectonic', 'pdflatex', 'xelatex', 'lualatex']
