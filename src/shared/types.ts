import type { NoteColor } from './note-colors'

export type RuntimePhase = 'starting' | 'ready' | 'stopping' | 'stopped' | 'error'

export interface RuntimeStatus {
  phase: RuntimePhase
  harnessVersion: string
  electronVersion: string
  port: number | null
  url: string | null
  runningTasks: number
  pendingRestart: boolean
  /** The native assistant page has finished loading and branding. */
  viewReady?: boolean
  error?: string
}

export type ProviderKind = 'deepseek' | 'openai-compatible'

export interface ProviderConfigInput {
  id?: string
  kind: ProviderKind
  displayName: string
  baseUrl: string
  modelId: string
  apiKey?: string
  maxOutputTokens: number
}

export interface ProviderConfig extends Omit<ProviderConfigInput, 'apiKey'> {
  id: string
  hasCredential: boolean
  active: boolean
  updatedAt: string
}

export interface ProviderTestResult {
  ok: boolean
  latencyMs: number
  status: number | null
  message: string
}

export type PaperIndexStatus = 'ready' | 'needs-ocr' | 'error'

export interface PaperRecord {
  originalPath?: string
  venue?: string
  codeUrl?: string
  affiliations?: string
  keywords?: string[]
  tags?: string[]
  collection?: string
  readingPage?: number
  rating?: number
  deletedAt?: string | null
  id: string
  sourcePath: string
  fileName: string
  checksum: string
  size: number
  modifiedAt: number
  title: string
  authors: string[]
  year: number | null
  doi: string | null
  language: string
  pageCount: number
  indexStatus: PaperIndexStatus
  missing: boolean
  createdAt: string
  updatedAt: string
}

export interface PaperPage {
  paperId: string
  pageNumber: number
  text: string
}

export interface PaperSearchHit {
  paperId: string
  pageNumber: number
  title: string
  snippet: string
}

export type ArtifactKind = 'summary' | 'translation' | 'selection-translation' | 'question-answer'
export type ArtifactStatus = 'queued' | 'running' | 'complete' | 'failed'

export type ReviewSectionKey = 'problem' | 'innovation' | 'method' | 'dataset' | 'setup' | 'results' | 'explanation' | 'context' | 'future' | 'concepts' | 'action'
export interface PaperReviewEvidence { page: number; quote: string }
export interface PaperReviewSection { key: ReviewSectionKey; body: string; evidence: PaperReviewEvidence[]; nature?: 'fact' | 'inference' }
export interface PaperReview { version: 1; sections: PaperReviewSection[] }
export interface PaperAnswer { version: 1; body: string; evidence: PaperReviewEvidence[]; color: string }

export interface PaperNote {
  paperId: string
  personalText: string
  summaryArtifactId: string | null
  includedSections: ReviewSectionKey[]
  updatedAt: string | null
}

export interface PaperNoteVersion {
  id: string
  paperId: string
  version: number
  markdown: string
  filePath?: string
  createdAt: string
}

export interface ReaderRect { x: number; y: number; width: number; height: number }
export interface ReaderSegment { page: number; rects: ReaderRect[] }
export interface ReaderQuestionContext { id: string; text: string; page: number; segments: ReaderSegment[] }
export type ReaderCardKind = 'translation' | 'summary' | 'note' | 'answer'
export interface ReaderCard {
  segments?: ReaderSegment[]
  id: string
  paperId: string
  kind: ReaderCardKind
  artifactId: string | null
  sectionKey: ReviewSectionKey | null
  pageNumber: number | null
  sourceText: string
  content: string
  rects: ReaderRect[]
  noteColor: NoteColor | null
  hidden: boolean
  included: boolean
  createdAt: string
  updatedAt: string
}
export interface ReaderNoteInput {
  segments?: ReaderSegment[]
  id?: string
  paperId: string
  content: string
  pageNumber?: number | null
  sourceText?: string
  rects?: ReaderRect[]
  noteColor?: NoteColor
}

export type WritingSectionKey = 'title' | 'abstract' | 'introduction' | 'related_work' | 'methods' | 'experiments' | 'results' | 'discussion' | 'conclusion'
export type WritingReviewMode = 'critique' | 'polish'
export interface WritingProject { id: string; title: string; field: string; targetJournal: string; createdAt: string; updatedAt: string }
export interface WritingDraft { projectId: string; section: WritingSectionKey; text: string; updatedAt: string | null }
export interface WritingIssue { severity: 'high' | 'medium' | 'low'; problem: string; suggestion: string; evidenceNeeded: string }
export interface WritingReviewResult { assessment: string; issues: WritingIssue[]; proposedText: string; claimEvidenceMap: Array<{ claim: string; evidence: string; status: 'supported' | 'needs-evidence' }> }
export interface WritingRevision { id: string; projectId: string; section: WritingSectionKey; mode: WritingReviewMode; sourceText: string; status: 'queued' | 'running' | 'complete' | 'failed'; result: WritingReviewResult | null; error: string | null; sessionId: string | null; createdAt: string; updatedAt: string }
export interface WritingDraftVersion { id: string; projectId: string; section: WritingSectionKey; text: string; sourceRevisionId: string | null; createdAt: string }
export interface WritingParagraphVersion {
  requestMode?: 'draft' | 'polish' | 'revise'
  feedback?: string
  id: string
  paragraphId: string
  number: number
  parentVersionId: string | null
  inputText: string
  academicZh: string
  academicEn: string
  changeNote: string
  status: 'queued' | 'running' | 'complete' | 'failed'
  error: string | null
  sessionId: string | null
  createdAt: string
  updatedAt: string
}
export interface WritingParagraph {
  groupId?: string | null
  finalized?: boolean
  finalizedVersionId?: string | null
  id: string
  projectId: string
  section: WritingSectionKey
  position: number
  title: string
  draftText: string
  currentVersionId: string | null
  versions: WritingParagraphVersion[]
  createdAt: string
  updatedAt: string
}

export interface PaperArtifact {
  questionContexts?: ReaderQuestionContext[]
  review?: PaperReview | null
  answer?: PaperAnswer | null
  selection?: string
  pageNumber?: number
  id: string
  paperId: string
  sessionId: string | null
  kind: ArtifactKind
  status: ArtifactStatus
  progress: number
  markdownPath: string
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface WorkspaceRoot {
  id: string
  path: string
  name: string
  permission: 'read-write'
  createdAt: string
}

export interface WorkspaceEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size: number | null
  modifiedAt: number
}

export interface HarnessSessionSummary {
  id: string
  title: string
  status: 'running' | 'waiting' | 'idle' | 'failed'
  updatedAt: string
}

export interface DiagnosticInfo {
  runtime: RuntimeStatus
  dataRoot: string
  databasePath: string
  logs: string[]
}

export interface HarnessViewBounds {
  x: number
  y: number
  width: number
  height: number
  visible: boolean
}

export interface SingularityApi {
  latex: import('./latex').LatexApi
  planning: import('./planning').PlanningApi
  knowledge: import('./knowledge').KnowledgeApi
  voice: {
    settings(): Promise<import('./voice').VoiceSettings>
    saveSettings(input: import('./voice').VoiceSettingsInput): Promise<import('./voice').VoiceSettings>
    verifySettings(): Promise<{ ok: boolean; message: string }>
    capabilities(): Promise<import('./voice').VoiceCapabilities>
    start(): Promise<string>
    stop(id: string): Promise<void>
    listen(id: string, audio?: string): Promise<import('./voice').VoiceRecognition>
    reply(id: string, messages: import('./voice').VoiceMessage[]): Promise<string>
    speak(id: string, text: string): Promise<import('./voice').VoiceAudio>
    play(id: string, audio: string): Promise<{ played: boolean }>
  }
  images: {
    settings(): Promise<import('./image').ImageSettings>
    saveSettings(input: import('./image').ImageSettingsInput): Promise<import('./image').ImageSettings>
    list(): Promise<import('./image').ImageAsset[]>
    generate(taskId: string, input: import('./image').ImageGenerateInput): Promise<import('./image').ImageGenerateResult>
    cancel(taskId: string): Promise<void>
    read(id: string): Promise<string>
    remove(id: string): Promise<void>
    reveal(id: string): Promise<void>
  }
  research: import('./field-knowledge').FieldApi & {
    explorations(): Promise<import('./research-explorer').ResearchRun[]>
    deleteExploration(id: string): Promise<void>
    updateExploration(id: string, options: import('./research-explorer').ResearchUpdateOptions): Promise<import('./research-explorer').ResearchRun>
    explore(request: import('./research-explorer').ResearchRequest): Promise<import('./research-explorer').ResearchRun>
    cancelExploration(id: string): Promise<void>
    importExploration(id: string, sourceId: string): Promise<PaperRecord>
    discovery(refresh?: boolean): Promise<DiscoveryFeed>
    list(kind: DigestKind): Promise<DigestIssue[]>
    generate(kind: DigestKind, subscriptionId?: string): Promise<DigestIssue>
    subscriptions(): Promise<DigestSubscription[]>
    subscribe(input: DigestSubscription): Promise<void>
    removeSubscription(id: string): Promise<void>
    read(issueId: string, itemId: string): Promise<void>
    star(issueId: string, itemId: string, starred: boolean): Promise<void>
    importPaper(issueId: string, itemId: string): Promise<PaperRecord>
    openSource(url: string): Promise<void>
  }
  windowControls: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<boolean>
    close(): Promise<void>
    /** Fires when the window is minimized or hidden to the tray (not when merely covered by another window). */
    onConcealed(listener: () => void): () => void
    backdrop(): Promise<DesktopBackdrop>
    onBackdrop(listener: (backdrop: DesktopBackdrop) => void): () => void
    onBackdropGeometry(listener: (geometry: DesktopBackdropGeometry) => void): () => void
  }
  dialogs: {
    selectPdfs(): Promise<string[]>
    selectWorkspace(): Promise<string | null>
  }
  runtime: {
    assistantAction(action: 'new' | 'history' | 'plugins' | 'assistant'): Promise<void>
    get(): Promise<RuntimeStatus>
    diagnostics(): Promise<DiagnosticInfo>
    restart(): Promise<void>
    onStatus(listener: (status: RuntimeStatus) => void): () => void
    setHarnessView(bounds: HarnessViewBounds): Promise<void>
    setTheme(theme: 'light' | 'dark'): Promise<void>
    getChatTheme(): Promise<import('./chat-theme').ChatTheme>
    onChatTheme(listener: (theme: import('./chat-theme').ChatTheme) => void): () => void
  }
  providers: {
    list(): Promise<ProviderConfig[]>
    save(input: ProviderConfigInput): Promise<ProviderConfig>
    remove(id: string): Promise<void>
    activate(id: string): Promise<void>
    test(input: ProviderConfigInput): Promise<ProviderTestResult>
  }
  papers: {
    cacheThumbnail(id: string, png: string): Promise<void>
    importBatch(paths: string[]): Promise<{ papers: PaperRecord[]; errors: string[] }>
    droppedPaths(files: File[]): string[]
    update(id: string, patch: PaperPatch): Promise<PaperRecord>
    trash(): Promise<PaperRecord[]>
    restore(id: string): Promise<void>
    highlights(id: string): Promise<PaperHighlight[]>
    highlight(input: Omit<PaperHighlight, 'id'>): Promise<PaperHighlight>
    removeHighlight(id: string): Promise<void>
    import(paths: string[]): Promise<PaperRecord[]>
    list(): Promise<PaperRecord[]>
    get(id: string): Promise<PaperRecord | null>
    pages(id: string, from: number, to: number): Promise<PaperPage[]>
    search(query: string, paperId?: string): Promise<PaperSearchHit[]>
    remove(id: string): Promise<void>
    relocate(id: string, path: string): Promise<PaperRecord>
    artifacts(id: string): Promise<PaperArtifact[]>
    startArtifact(id: string, kind: ArtifactKind, selection?: string, pageNumber?: number, rects?: ReaderRect[], segments?: ReaderSegment[], questionContexts?: ReaderQuestionContext[]): Promise<PaperArtifact>
    documentTranslation(id: string): Promise<import('./document-translation').DocumentTranslation>
    translateDocument(id: string, scope: import('./document-translation').TranslationScope): Promise<import('./document-translation').DocumentTranslation>
    readArtifact(id: string): Promise<string>
    readerCards(id: string): Promise<ReaderCard[]>
    saveReaderNote(input: ReaderNoteInput): Promise<ReaderCard>
    setReaderCardState(id: string, hidden: boolean, included: boolean): Promise<ReaderCard>
    note(id: string): Promise<PaperNote>
    saveNote(id: string, personalText: string, summaryArtifactId: string | null, includedSections: ReviewSectionKey[]): Promise<PaperNote>
    noteVersions(id: string): Promise<PaperNoteVersion[]>
    finalizeNote(id: string): Promise<PaperNoteVersion>
  }
  writing: import('./writing').WritingWorkflowApi & {
    paragraphs(projectId: string, section: WritingSectionKey): Promise<WritingParagraph[]>
    addParagraph(projectId: string, section: WritingSectionKey, groupId?:string|null): Promise<WritingParagraph>
    updateParagraph(id: string, title: string, draftText: string): Promise<WritingParagraph>
    generateParagraph(id: string,request?:import('./writing').ParagraphRequest): Promise<WritingParagraphVersion>
    acceptParagraphVersion(id: string): Promise<WritingParagraph>
    projects(): Promise<WritingProject[]>
    create(title: string, field: string, targetJournal: string): Promise<WritingProject>
    update(id: string, title: string, field: string, targetJournal: string): Promise<WritingProject>
    draft(projectId: string, section: WritingSectionKey): Promise<WritingDraft>
    saveDraft(projectId: string, section: WritingSectionKey, text: string, checkpoint?: boolean): Promise<WritingDraft>
    history(projectId: string, section: WritingSectionKey): Promise<WritingDraftVersion[]>
    revisions(projectId: string, section: WritingSectionKey): Promise<WritingRevision[]>
    review(projectId: string, section: WritingSectionKey, mode: WritingReviewMode): Promise<WritingRevision>
    accept(revisionId: string): Promise<WritingDraft>
  }
  workspaces: {
    list(): Promise<WorkspaceRoot[]>
    add(path: string): Promise<WorkspaceRoot>
    remove(id: string): Promise<void>
    tree(id: string, relativePath?: string, query?: string): Promise<WorkspaceEntry[]>
  }
  nativeFiles: {
    show(path: string): Promise<void>
  }
}

export type PaperPatch = Partial<Pick<PaperRecord, 'title' | 'authors' | 'year' | 'venue' | 'codeUrl' | 'affiliations' | 'keywords' | 'tags' | 'collection' | 'readingPage' | 'rating'>>
export interface PaperHighlight { id: string; paperId: string; pageNumber: number; text: string; rects: Array<{ x: number; y: number; width: number; height: number }> }
export type DigestKind = 'papers' | 'news'
export interface DiscoveryItem { id: string; title: string; summary: string; url: string; author: string; publishedAt: string; metric?: string; pdfUrl?: string }
export interface DiscoveryFeed { fetchedAt: string; week: string; papers: DiscoveryItem[]; repositories: DiscoveryItem[]; conferences: DiscoveryItem[]; warnings: string[] }
export type DigestRepeat = 'once' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly' | 'interval'
export interface DigestSubscription { kind: DigestKind; id?: string; enabled: boolean; time: string; topics: string[]; description?: string; rangeDays?: number; count?: number; repeat?: DigestRepeat; weekdays?: number[]; startDate?: string; intervalDays?: number; newsType?: 'all' | 'research' | 'industry' | 'product' | 'policy' | 'culture'; presentation?: 'mixed' | 'text' | 'image'; imageCardStyle?: 'auto' | 'cover' | 'immersive'; includeOverview?: boolean }
export interface DigestSource { id: string; title: string; url: string; publishedAt: string; text: string; official: boolean; pdfUrl?: string; authors?: string; venue?: string; imageUrl?: string; imageData?: string }
export interface DigestItem { id: string; sourceId: string; title: string; summary: string; why: string; method?: string; brief?: boolean; read?: boolean; starred?: boolean; category?: string; bookmarkId?: string }
export interface DigestIssue { id: string; kind: DigestKind; createdAt: string; status: 'collecting' | 'generating' | 'complete' | 'failed'; error?: string; sessionId?: string; sources: DigestSource[]; items: DigestItem[]; overview?: string; warnings: string[]; archived?: boolean; seenKeys?: string[]; subscriptionId?: string; subscription?: DigestSubscription }

/** The display the window sits on, relative to the window's top-left corner. */
export interface DesktopBackdropGeometry { x: number; y: number; width: number; height: number }
export interface DesktopBackdrop extends DesktopBackdropGeometry { image: string | null; fit: 'cover' | 'contain' | 'stretch' }
