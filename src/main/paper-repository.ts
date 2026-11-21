import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { AppPaths } from './paths'
import { isPathInside } from './paths'
import { extractPdf } from './pdf-extractor'
import { isTranslatableParagraph } from '../shared/academic-text'
import { defaultNoteColor, isNoteColor } from '../shared/note-colors'
import { validateQuestionContexts } from '../shared/reader-question-context'
import { natureLabels, defaultNature, type CardAnnotation, type FigureInsight } from '../shared/knowledge'
import type {
  ArtifactKind,
  PaperArtifact,
  PaperPage,
  PaperRecord,
  PaperSearchHit,
  WorkspaceEntry,
  WorkspaceRoot,
  PaperPatch, PaperHighlight,
  PaperNote, PaperNoteVersion, ReviewSectionKey, ReaderCard, ReaderNoteInput, ReaderRect, ReaderSegment, ReaderQuestionContext,
  WritingProject, WritingDraft, WritingDraftVersion, WritingRevision, WritingParagraph, WritingParagraphVersion,
  WritingSectionKey, WritingReviewMode,
} from '../shared/types'

type Row = Record<string, string | number | null>
const reviewKeys: ReviewSectionKey[] = ['problem','innovation','method','dataset','setup','results','explanation','context','future','concepts','action']
const reviewTitles = ['核心问题','关键贡献','方法架构','数据集分析','实验设置','结果与消融','直观理解','学术脉络','未来想象力','关键概念','行动建议']
const writingSections: WritingSectionKey[] = ['title','abstract','introduction','related_work','methods','experiments','results','discussion','conclusion']

export class PaperRepository {
  private importQueue: Promise<unknown> = Promise.resolve()
  readonly databasePath: string
  private readonly db: DatabaseSync

  constructor(private readonly paths: AppPaths) {
    this.databasePath = path.join(paths.database, 'singularity.sqlite')
    this.db = new DatabaseSync(this.databasePath)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;')
    this.migrate()
    this.db.prepare("UPDATE paper_artifacts SET status='failed', error='上次生成已中断，已保留记录与已有文件，请重试。' WHERE status IN ('queued','running')").run()
    this.db.prepare("UPDATE writing_revisions SET status='failed', error='上次审阅已中断，请重新运行。' WHERE status IN ('queued','running')").run()
    this.db.prepare("UPDATE writing_paragraph_versions SET status='failed', error='上次改写已中断，请重新运行。', updated_at=? WHERE status IN ('queued','running')").run(new Date().toISOString())
  }

  close(): void {
    this.db.close()
  }

  import(filePath: string): Promise<PaperRecord> {
    const task = this.importQueue.then(() => this.importOne(filePath))
    this.importQueue = task.catch(() => undefined)
    return task
  }

  private async managedCopy(file: string, id: string, checksum: string): Promise<string> {
    const directory = path.join(this.paths.data, 'library', id)
    await fsp.mkdir(directory, { recursive: true })
    const target = path.join(directory, 'paper.pdf')
    if (path.resolve(file) === target) return target
    const temporary = path.join(directory, `${crypto.randomUUID()}.tmp`)
    try {
      await fsp.copyFile(file, temporary)
      const digest = createHash('sha256').update(await fsp.readFile(temporary)).digest('hex')
      if (digest !== checksum) throw new Error('PDF 在复制期间发生变化，请重试。')
      await fsp.rename(temporary, target)
      return target
    } finally { await fsp.rm(temporary, { force: true }) }
  }

  async migrateManagedFiles(): Promise<void> {
    const rows = this.db.prepare("SELECT * FROM papers WHERE original_path = ''").all() as Row[]
    for (const row of rows) {
      try {
        const target = await this.managedCopy(String(row.source_path), String(row.id), String(row.checksum))
        const stat = await fsp.stat(target)
        this.db.prepare('UPDATE papers SET original_path=source_path, source_path=?, modified_at=?, missing=0 WHERE id=?').run(target, stat.mtimeMs, row.id)
      } catch { this.db.prepare('UPDATE papers SET missing=1 WHERE id=?').run(row.id) }
    }
  }

  private async importOne(filePath: string): Promise<PaperRecord> {
    const absolute = path.resolve(filePath)
    const extracted = await extractPdf(absolute)
    const existing = this.db.prepare('SELECT id FROM papers WHERE checksum = ?').get(extracted.checksum) as Row | undefined
    const id = typeof existing?.id === 'string' ? existing.id : crypto.randomUUID()
    if (existing) { this.restore(id); return this.get(id)! }
    const managed = await this.managedCopy(absolute, id, extracted.checksum)
    const managedStat = await fsp.stat(managed)
    const now = new Date().toISOString()
    const record: PaperRecord = {
      id,
      sourcePath: managed,
      fileName: path.basename(absolute),
      checksum: extracted.checksum,
      size: extracted.size,
      modifiedAt: managedStat.mtimeMs,
      title: extracted.title,
      authors: extracted.authors,
      year: extracted.year,
      doi: extracted.doi,
      language: extracted.language,
      pageCount: extracted.pageCount,
      indexStatus: extracted.indexStatus,
      missing: false,
      createdAt: now,
      updatedAt: now,
    }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const old = this.db.prepare('SELECT created_at FROM papers WHERE id = ?').get(id) as Row | undefined
      record.createdAt = String(old?.created_at ?? now)
      this.db.prepare(`
        INSERT INTO papers (id, source_path, file_name, checksum, size, modified_at, title, authors_json, year, doi, language, page_count, index_status, missing, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        ON CONFLICT(id) DO UPDATE SET source_path=excluded.source_path, file_name=excluded.file_name,
          size=excluded.size, modified_at=excluded.modified_at, title=excluded.title, authors_json=excluded.authors_json,
          year=excluded.year, doi=excluded.doi, language=excluded.language, page_count=excluded.page_count,
          index_status=excluded.index_status, missing=0, updated_at=excluded.updated_at
      `).run(id, managed, record.fileName, record.checksum, record.size, record.modifiedAt, record.title,
        JSON.stringify(record.authors), record.year, record.doi, record.language, record.pageCount, record.indexStatus,
        record.createdAt, now)
      this.db.prepare('UPDATE papers SET original_path=? WHERE id=?').run(absolute, id)
      this.db.prepare('DELETE FROM paper_pages WHERE paper_id = ?').run(id)
      this.db.prepare('DELETE FROM paper_fts WHERE paper_id = ?').run(id)
      if (record.indexStatus === 'ready') {
        const insertPage = this.db.prepare('INSERT INTO paper_pages (paper_id, page_number, text) VALUES (?, ?, ?)')
        const insertFts = this.db.prepare('INSERT INTO paper_fts (paper_id, page_number, text) VALUES (?, ?, ?)')
        extracted.pages.forEach((text, index) => {
          insertPage.run(id, index + 1, text)
          insertFts.run(id, index + 1, text)
        })
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    await this.writeExtractedMarkdown(record, extracted.pages)
    return this.get(id)!
  }

  async list(): Promise<PaperRecord[]> {
    const rows = this.db.prepare('SELECT * FROM papers WHERE deleted_at IS NULL ORDER BY created_at DESC').all() as Row[]
    const records = await Promise.all(rows.map(async (row) => {
      const record = this.paperFromRow(row)
      let missing = false
      try {
        const stat = await fsp.stat(record.sourcePath)
        missing = stat.size !== record.size || Math.abs(stat.mtimeMs - record.modifiedAt) > 1
      } catch {
        missing = true
      }
      if (missing !== record.missing) {
        this.db.prepare('UPDATE papers SET missing = ? WHERE id = ?').run(missing ? 1 : 0, record.id)
        record.missing = missing
      }
      return record
    }))
    return records
  }

  get(id: string): PaperRecord | null {
    const row = this.db.prepare('SELECT * FROM papers WHERE id = ?').get(id) as Row | undefined
    return row ? this.paperFromRow(row) : null
  }

  pages(id: string, from: number, to: number): PaperPage[] {
    const rows = this.db.prepare(`
      SELECT paper_id, page_number, text FROM paper_pages
      WHERE paper_id = ? AND page_number BETWEEN ? AND ? ORDER BY page_number
    `).all(id, Math.max(1, from), Math.max(from, to)) as Row[]
    return rows.map((row) => ({ paperId: String(row.paper_id), pageNumber: Number(row.page_number), text: String(row.text) }))
  }

  search(query: string, paperId?: string): PaperSearchHit[] {
    const terms = query.trim().split(/\s+/).filter(Boolean).slice(0, 12)
    if (!terms.length) return []
    const ftsQuery = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' OR ')
    const sql = `
      SELECT f.paper_id, f.page_number, p.title,
        snippet(paper_fts, 2, '<mark>', '</mark>', ' … ', 22) AS excerpt
      FROM paper_fts f JOIN papers p ON p.id = f.paper_id
      WHERE paper_fts MATCH ? AND p.deleted_at IS NULL ${paperId ? 'AND f.paper_id = ?' : ''}
      ORDER BY bm25(paper_fts) LIMIT 50
    `
    const rows = (paperId
      ? this.db.prepare(sql).all(ftsQuery, paperId)
      : this.db.prepare(sql).all(ftsQuery)) as Row[]
    return rows.map((row) => ({
      paperId: String(row.paper_id),
      pageNumber: Number(row.page_number),
      title: String(row.title),
      snippet: String(row.excerpt),
    }))
  }

  async remove(id: string): Promise<void> {
    this.db.prepare('UPDATE papers SET deleted_at=? WHERE id=?').run(new Date().toISOString(), id)
  }

  trash(): PaperRecord[] { return (this.db.prepare('SELECT * FROM papers WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').all() as Row[]).map((r) => this.paperFromRow(r)) }
  restore(id: string): void { this.db.prepare('UPDATE papers SET deleted_at=NULL WHERE id=?').run(id) }

  update(id: string, patch: PaperPatch): PaperRecord {
    const current = this.get(id); if (!current) throw new Error('论文不存在')
    const next = { ...current, ...patch }
    if (!next.title?.trim() || next.title.length > 2000 || !Array.isArray(next.authors) || !Array.isArray(next.tags ?? []) || !Array.isArray(next.keywords ?? [])) throw new Error('元数据无效')
    if (next.year !== null && (!Number.isInteger(next.year) || next.year < 1000 || next.year > 9999)) throw new Error('年份无效')
    const rating = next.rating
    if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 0 || rating > 5) throw new Error('评分必须是 0 到 5 的整数')
    const codeUrl = String(next.codeUrl ?? '').trim()
    if (codeUrl) {
      let parsed: URL
      try { parsed = new URL(codeUrl) } catch { throw new Error('代码链接不是有效网址') }
      if (codeUrl.length > 2000 || !['http:', 'https:'].includes(parsed.protocol)) throw new Error('代码链接需要使用 http 或 https 地址')
    }
    if (String(next.affiliations ?? '').length > 1000 || (next.keywords ?? []).length > 30 || (next.keywords ?? []).some((word) => typeof word !== 'string' || word.length > 80)) throw new Error('发表单位或关键词过长')
    this.db.prepare('UPDATE papers SET title=?, authors_json=?, year=?, venue=?, code_url=?, affiliations=?, keywords_json=?, tags_json=?, collection_name=?, reading_page=?, rating=?, updated_at=? WHERE id=?').run(next.title.trim(), JSON.stringify(next.authors), next.year, String(next.venue ?? '').slice(0,500), codeUrl, String(next.affiliations ?? '').trim(), JSON.stringify(next.keywords ?? []), JSON.stringify(next.tags ?? []), String(next.collection ?? '').slice(0,200), Math.max(1, Math.min(current.pageCount, next.readingPage ?? 1)), rating, new Date().toISOString(), id)
    return this.get(id)!
  }

  highlights(paperId: string): PaperHighlight[] { return this.db.prepare('SELECT * FROM paper_highlights WHERE paper_id=?').all(paperId).map((r) => ({ id: String(r.id), paperId, pageNumber: Number(r.page_number), text: String(r.text), rects: JSON.parse(String(r.rects_json)) })) }
  highlight(input: Omit<PaperHighlight, 'id'>): PaperHighlight {
    const paper = this.get(input.paperId)
    if (!paper || !Number.isInteger(input.pageNumber) || input.pageNumber < 1 || input.pageNumber > paper.pageCount || !input.text.trim() || input.text.length > 20000 || !input.rects.length || input.rects.length > 1000 || input.rects.some((r) => Object.values(r).some((v) => !Number.isFinite(v) || v < 0 || v > 1))) throw new Error('高亮范围无效')
    const result = { ...input, id: crypto.randomUUID() }
    this.db.prepare('INSERT INTO paper_highlights VALUES (?,?,?,?,?)').run(result.id, input.paperId, input.pageNumber, input.text, JSON.stringify(input.rects))
    return result
  }
  removeHighlight(id: string): void { this.db.prepare('DELETE FROM paper_highlights WHERE id=?').run(id) }
  annotateArtifact(id: string, selection?: string, pageNumber?: number, questionContexts?: ReaderQuestionContext[]): void {
    const artifact = this.getArtifact(id)
    if (!artifact) throw new Error('论文任务不存在。')
    const contexts = validateQuestionContexts(questionContexts, this.get(artifact.paperId)!.pageCount)
    if (artifact.kind !== 'question-answer' && contexts.length) throw new Error('只有论文问答可以添加提问上下文。')
    this.db.prepare('UPDATE paper_artifacts SET selection=?, page_number=?, question_contexts_json=? WHERE id=?').run(selection ?? '', pageNumber ?? 1, JSON.stringify(contexts), id)
  }

  registerArtifactCard(artifact: PaperArtifact, sourceText: string, pageNumber: number, rects: ReaderRect[] = [], segments: ReaderSegment[] = []): void {
    if (!['selection-translation','question-answer'].includes(artifact.kind)) return
    this.validateReaderAnchor(artifact.paperId, pageNumber, rects)
    this.validateReaderSegments(artifact.paperId, segments)
    const now = new Date().toISOString()
    this.db.prepare(`INSERT OR IGNORE INTO paper_reader_cards
      (id,paper_id,kind,artifact_id,section_key,page_number,source_text,content,rects_json,hidden,included,created_at,updated_at)
      VALUES (?,?,?,?,NULL,?,?,'',?,0,?,?,?)`)
      .run(artifact.id, artifact.paperId, artifact.kind === 'question-answer' ? 'answer' : 'translation', artifact.id,
        pageNumber, sourceText.slice(0,20_000), JSON.stringify(rects), 0, now, now)
    if (segments.length) this.db.prepare('UPDATE paper_reader_cards SET segments_json=? WHERE id=?').run(JSON.stringify(segments), artifact.id)
  }

  readerCard(id: string): ReaderCard | null {
    const row = this.db.prepare('SELECT * FROM paper_reader_cards WHERE id=?').get(id) as Row | undefined
    return row ? this.readerCardFromRow(row) : null
  }

  readerCards(paperId: string): ReaderCard[] {
    if (!this.get(paperId)) throw new Error('论文不存在。')
    const now = new Date().toISOString()
    const artifacts = this.artifacts(paperId)
    const latestSummaryId = artifacts.find((item) => item.kind === 'summary' && item.status === 'complete' && item.review)?.id
    for (const artifact of artifacts) {
      if (artifact.kind === 'summary' && artifact.status === 'complete' && artifact.review) {
        for (const section of artifact.review.sections) {
          const evidence = section.evidence[0]
          this.db.prepare(`INSERT OR IGNORE INTO paper_reader_cards
            (id,paper_id,kind,artifact_id,section_key,page_number,source_text,content,rects_json,hidden,included,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,'[]',?,?,?,?)`)
            .run(`${artifact.id}:${section.key}`,paperId,'summary',artifact.id,section.key,evidence?.page ?? null,
              evidence?.quote ?? '',section.body,Number(artifact.id !== latestSummaryId),Number(artifact.id === latestSummaryId),now,now)
        }
      } else if (artifact.kind === 'question-answer' || artifact.kind === 'selection-translation' && isTranslatableParagraph(artifact.selection ?? '')) {
        this.registerArtifactCard(artifact, artifact.selection ?? '', artifact.pageNumber ?? 1)
        if (artifact.status === 'complete') {
          const content = fs.existsSync(artifact.markdownPath) ? fs.readFileSync(artifact.markdownPath,'utf8').trim() : ''
          if (content) this.db.prepare("UPDATE paper_reader_cards SET content=?,updated_at=? WHERE id=? AND content='' ").run(content,now,artifact.id)
        }
      }
    }
    return (this.db.prepare('SELECT * FROM paper_reader_cards WHERE paper_id=? ORDER BY created_at, rowid').all(paperId) as Row[]).map((row) => this.readerCardFromRow(row))
  }

  saveReaderNote(input: ReaderNoteInput): ReaderCard {
    if (!input || typeof input.content !== 'string' || input.content.length > 50_000 ||
      !input.content.trim() && !input.id && !(input.pageNumber && input.rects?.length) ||
      input.noteColor !== undefined && !isNoteColor(input.noteColor) ||
      typeof input.sourceText !== 'undefined' && (typeof input.sourceText !== 'string' || input.sourceText.length > 20_000)) throw new Error('笔记内容无效。')
    this.validateReaderAnchor(input.paperId,input.pageNumber ?? null,input.rects ?? [])
    this.validateReaderSegments(input.paperId, input.segments ?? [])
    const now = new Date().toISOString()
    if (input.id) {
      const prior = this.db.prepare("SELECT id FROM paper_reader_cards WHERE id=? AND paper_id=? AND kind='note'").get(input.id,input.paperId)
      if (!prior) throw new Error('笔记卡片不存在。')
      this.db.prepare('UPDATE paper_reader_cards SET content=?,page_number=?,source_text=?,rects_json=?,note_color=COALESCE(?,note_color),updated_at=? WHERE id=?')
        .run(input.content.trim(),input.pageNumber ?? null,input.sourceText ?? '',JSON.stringify(input.rects ?? []),input.noteColor ?? null,now,input.id)
      if (input.segments) this.db.prepare('UPDATE paper_reader_cards SET segments_json=? WHERE id=?').run(JSON.stringify(input.segments), input.id)
      return this.readerCardFromRow(this.db.prepare('SELECT * FROM paper_reader_cards WHERE id=?').get(input.id) as Row)
    }
    const id = crypto.randomUUID()
    this.db.prepare(`INSERT INTO paper_reader_cards
      (id,paper_id,kind,artifact_id,section_key,page_number,source_text,content,rects_json,note_color,hidden,included,created_at,updated_at)
      VALUES (?,?,'note',NULL,NULL,?,?,?,?,?,0,1,?,?)`)
      .run(id,input.paperId,input.pageNumber ?? null,input.sourceText ?? '',input.content.trim(),JSON.stringify(input.rects ?? []),input.noteColor ?? defaultNoteColor,now,now)
    if (input.segments) this.db.prepare('UPDATE paper_reader_cards SET segments_json=? WHERE id=?').run(JSON.stringify(input.segments), id)
    return this.readerCardFromRow(this.db.prepare('SELECT * FROM paper_reader_cards WHERE id=?').get(id) as Row)
  }

  setReaderCardState(id: string, hidden: boolean, included: boolean): ReaderCard {
    if (typeof hidden !== 'boolean' || typeof included !== 'boolean') throw new Error('卡片状态无效。')
    const result = this.db.prepare('UPDATE paper_reader_cards SET hidden=?,included=?,updated_at=? WHERE id=?')
      .run(Number(hidden),Number(included),new Date().toISOString(),id)
    if (!result.changes) throw new Error('卡片不存在。')
    return this.readerCardFromRow(this.db.prepare('SELECT * FROM paper_reader_cards WHERE id=?').get(id) as Row)
  }

  private validateReaderAnchor(paperId: string, pageNumber: number | null, rects: ReaderRect[]): void {
    const paper = this.get(paperId)
    if (!paper || paper.deletedAt || pageNumber !== null && (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > paper.pageCount) ||
      !Array.isArray(rects) || rects.length > 250 || rects.some((r) => !r || ['x','y','width','height'].some((key) => !Number.isFinite(r[key as keyof ReaderRect]) || r[key as keyof ReaderRect] < 0 || r[key as keyof ReaderRect] > 1))) throw new Error('卡片关联区域无效。')
  }

  private validateReaderSegments(paperId: string, segments: ReaderSegment[]): void {
    if (!Array.isArray(segments) || segments.length > 100 || segments.reduce((count, part) => count + (part?.rects?.length ?? 0), 0) > 1000) throw new Error('跨页选区无效。')
    for (const part of segments) {
      if (!part || !Number.isInteger(part.page)) throw new Error('跨页选区无效。')
      this.validateReaderAnchor(paperId, part.page, part.rects)
    }
  }

  private readerCardFromRow(row: Row): ReaderCard {
    return { id:String(row.id),paperId:String(row.paper_id),kind:String(row.kind) as ReaderCard['kind'],
      segments: JSON.parse(String(row.segments_json ?? '[]')) as ReaderSegment[],
      artifactId:row.artifact_id ? String(row.artifact_id) : null,sectionKey:row.section_key ? String(row.section_key) as ReaderCard['sectionKey'] : null,
      pageNumber:row.page_number === null ? null : Number(row.page_number),sourceText:String(row.source_text),
      content:String(row.content),rects:JSON.parse(String(row.rects_json)) as ReaderRect[],noteColor:row.kind === 'note' ? isNoteColor(row.note_color) ? row.note_color : defaultNoteColor : null,hidden:Boolean(row.hidden),included:Boolean(row.included),
      createdAt:String(row.created_at),updatedAt:String(row.updated_at) }
  }


  async relocate(id: string, nextPath: string): Promise<PaperRecord> {
    const current = this.get(id)
    if (!current) throw new Error('论文不存在。')
    const extracted = await extractPdf(path.resolve(nextPath))
    if (extracted.checksum !== current.checksum) throw new Error('所选文件与原论文校验值不一致。')
    const target = await this.managedCopy(path.resolve(nextPath), id, extracted.checksum)
    const stat = await fsp.stat(target)
    this.db.prepare('UPDATE papers SET source_path=?, original_path=?, file_name=?, size=?, modified_at=?, missing=0, updated_at=? WHERE id=?')
      .run(target, path.resolve(nextPath), path.basename(nextPath), extracted.size, stat.mtimeMs, new Date().toISOString(), id)
    return this.get(id)!
  }

  createArtifact(paperId: string, kind: ArtifactKind): PaperArtifact {
    const paper = this.get(paperId)
    if (!paper || paper.deletedAt) throw new Error('论文不存在或已移入回收站。')
    if (paper.indexStatus !== 'ready') throw new Error('扫描型 PDF 需要 OCR，首版不会生成不可靠结果。')
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const directory = path.join(this.paths.artifacts, paperId)
    fs.mkdirSync(directory, { recursive: true })
    const markdownPath = path.join(directory, `${kind}-${id}.md`)
    this.db.prepare(`
      INSERT INTO paper_artifacts (id, paper_id, session_id, kind, status, progress, markdown_path, error, created_at, updated_at)
      VALUES (?, ?, NULL, ?, 'queued', 0, ?, NULL, ?, ?)
    `).run(id, paperId, kind, markdownPath, now, now)
    return this.getArtifact(id)!
  }

  attachArtifactSession(id: string, sessionId: string): void {
    this.db.prepare("UPDATE paper_artifacts SET session_id=?, status=CASE WHEN status='queued' THEN 'running' ELSE status END, progress=CASE WHEN status='queued' THEN 5 ELSE progress END, updated_at=? WHERE id=?")
      .run(sessionId, new Date().toISOString(), id)
  }

  markSummaryContinuation(id: string): boolean {
    const result = this.db.prepare("UPDATE paper_artifacts SET progress=10, updated_at=? WHERE id=? AND kind='summary' AND status='running' AND progress<10")
      .run(new Date().toISOString(), id)
    return result.changes === 1
  }

  failArtifact(id: string, error: string): void {
    this.db.prepare("UPDATE paper_artifacts SET status='failed', error=?, updated_at=? WHERE id=? AND status!='complete'")
      .run(error.slice(0, 2_000), new Date().toISOString(), id)
  }

  artifacts(paperId: string): PaperArtifact[] {
    const rows = this.db.prepare('SELECT * FROM paper_artifacts WHERE paper_id=? ORDER BY created_at DESC').all(paperId) as Row[]
    return rows.map((row) => this.artifactFromRow(row, true))
  }

  getArtifact(id: string): PaperArtifact | null {
    const row = this.db.prepare('SELECT * FROM paper_artifacts WHERE id=?').get(id) as Row | undefined
    return row ? this.artifactFromRow(row, true) : null
  }

  pendingArtifacts(): PaperArtifact[] {
    return (this.db.prepare("SELECT * FROM paper_artifacts WHERE status='running' ORDER BY updated_at LIMIT 20").all() as Row[]).map((row)=>this.artifactFromRow(row,false))
  }

  async readArtifact(id: string): Promise<string> {
    const artifact = this.getArtifact(id)
    if (!artifact) throw new Error('产物不存在。')
    try {
      return await fsp.readFile(artifact.markdownPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
      throw error
    }
  }

  note(paperId: string): PaperNote {
    if (!this.get(paperId)) throw new Error('论文不存在。')
    const row = this.db.prepare('SELECT * FROM paper_notes WHERE paper_id=?').get(paperId) as Row | undefined
    return row ? { paperId, personalText: String(row.personal_text), summaryArtifactId: row.summary_artifact_id ? String(row.summary_artifact_id) : null, includedSections: JSON.parse(String(row.included_sections_json)) as ReviewSectionKey[], updatedAt: String(row.updated_at) }
      : { paperId, personalText: '', summaryArtifactId: null, includedSections: [], updatedAt: null }
  }

  saveNote(paperId: string, personalText: string, summaryArtifactId: string | null, includedSections: ReviewSectionKey[]): PaperNote {
    if (!this.get(paperId)) throw new Error('论文不存在。')
    if (typeof personalText !== 'string' || personalText.length > 100_000 || !Array.isArray(includedSections) || includedSections.length > reviewKeys.length || includedSections.some((key) => !reviewKeys.includes(key)) || new Set(includedSections).size !== includedSections.length) throw new Error('笔记内容无效。')
    if (summaryArtifactId) {
      const summary = this.getArtifact(summaryArtifactId)
      if (!summary || summary.paperId !== paperId || summary.kind !== 'summary' || summary.status !== 'complete' || !summary.review) throw new Error('所选总结不属于此论文。')
    } else if (includedSections.length) throw new Error('请先选择论文总结。')
    const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO paper_notes (paper_id,personal_text,summary_artifact_id,included_sections_json,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(paper_id) DO UPDATE SET personal_text=excluded.personal_text,summary_artifact_id=excluded.summary_artifact_id,included_sections_json=excluded.included_sections_json,updated_at=excluded.updated_at`)
      .run(paperId, personalText, summaryArtifactId, JSON.stringify(includedSections), now)
    return this.note(paperId)
  }

  noteVersions(paperId: string): PaperNoteVersion[] {
    if (!this.get(paperId)) throw new Error('论文不存在。')
    return (this.db.prepare('SELECT * FROM paper_note_versions WHERE paper_id=? ORDER BY version DESC').all(paperId) as Row[])
      .map((row) => {
        const filePath=path.join(this.paths.artifacts,paperId,`reading-note-v${Number(row.version)}.md`)
        return { id: String(row.id), paperId, version: Number(row.version), markdown: String(row.markdown), createdAt: String(row.created_at), filePath: fs.existsSync(filePath)?filePath:undefined }
      })
  }

  finalizeNote(paperId: string, annotations: CardAnnotation[] = [], figures: FigureInsight[] = []): PaperNoteVersion {
    const paper = this.get(paperId)
    if (!paper) throw new Error('论文不存在。')
    const note = this.note(paperId)
    const summary = note.summaryArtifactId ? this.getArtifact(note.summaryArtifactId) : null
    const cards = this.readerCards(paperId).filter((card) => !card.hidden && card.included && card.content.trim())
    const selectedFigures = figures.filter((item) => !item.hidden && item.included && item.status === 'complete')
    if (!note.personalText.trim() && !summary && !cards.length && !selectedFigures.length) throw new Error('请先保留至少一张笔记或总结卡片。')
    const lines = [`# ${paper.title}`, '', `作者：${paper.authors.join('、') || '待补充'}`, `来源：${paper.venue || '待补充'}${paper.year ? ` · ${paper.year}` : ''}`, '']
    if (summary?.review) {
      lines.push('## 论文总结', '')
      for (const section of summary.review.sections.filter((item) => note.includedSections.includes(item.key))) {
        const index=reviewKeys.indexOf(section.key)
        const annotation=annotations.find((item)=>item.cardId===`${summary.id}:${section.key}`)
        lines.push(`### ${index + 1}. ${reviewTitles[index]} · ${natureLabels[annotation?.nature ?? section.nature ?? defaultNature(section.key)]}`, '', section.body, '')
        if(annotation)lines.push(`原文编号：${annotation.sourceIds.join('、')||'未关联'}`,'')
        for (const evidence of section.evidence) lines.push(`> [p.${evidence.page}] ${evidence.quote}`, '')
      }
    }
    if (note.personalText.trim()) lines.push('## 我的笔记', '', note.personalText.trim(), '')
    const cardHeadings: Record<ReaderCard['kind'],string> = { summary:'论文总结',translation:'段落翻译',note:'阅读笔记',answer:'论文问答' }
    for (const card of cards) {
      if (note.updatedAt && card.kind === 'summary' && card.artifactId === note.summaryArtifactId) continue
      const label = card.kind === 'summary' && card.sectionKey ? reviewTitles[reviewKeys.indexOf(card.sectionKey)] : cardHeadings[card.kind]
      const answerEvidence = card.kind === 'answer' && card.artifactId ? this.getArtifact(card.artifactId)?.answer?.evidence ?? [] : []
      const cardPage = card.kind === 'answer' ? answerEvidence[0]?.page : card.pageNumber
      lines.push(`## ${label}${cardPage ? ` · p.${cardPage}` : ''}`, '')
      const annotation = annotations.find((item) => item.cardId === card.id)
      if (annotation) lines.push(`内容性质：${natureLabels[annotation.nature]}`, `原文编号：${annotation.sourceIds.join('、') || '未关联'}`, '')
      if (card.sourceText.trim()) lines.push(`> ${card.sourceText.trim()}`, '')
      lines.push(card.content.trim(), '')
      for (const evidence of answerEvidence) lines.push(`> [p.${evidence.page}] ${evidence.quote}`, '')
    }
    for (const figure of selectedFigures) lines.push(`## ${figure.title}`, '', `解读依据：${figure.scope === 'vision' ? '图像与文字' : '图注与上下文'} · 研究推演`, `原文编号：${[figure.sourceId, ...figure.evidenceIds].join('、')}`, '', figure.content, '')
    const markdown = lines.join('\n').trim() + '\n'
    const version = Number((this.db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM paper_note_versions WHERE paper_id=?').get(paperId) as Row).version) + 1
    const directory=path.join(this.paths.artifacts,paperId)
    fs.mkdirSync(directory,{recursive:true})
    const filePath=path.join(directory,`reading-note-v${version}.md`)
    const temporary=path.join(directory,`${crypto.randomUUID()}.tmp`)
    try { fs.writeFileSync(temporary,markdown,'utf8'); fs.renameSync(temporary,filePath) } finally { if(fs.existsSync(temporary))fs.unlinkSync(temporary) }
    const result: PaperNoteVersion = { id: crypto.randomUUID(), paperId, version, markdown, createdAt: new Date().toISOString(), filePath }
    this.db.prepare('INSERT INTO paper_note_versions VALUES (?,?,?,?,?)').run(result.id, paperId, version, markdown, result.createdAt)
    return result
  }

  writingProjects(): WritingProject[] {
    return (this.db.prepare('SELECT * FROM writing_projects ORDER BY updated_at DESC').all() as Row[]).map(this.writingProjectFromRow)
  }

  writingParagraphs(projectId: string, section: WritingSectionKey): WritingParagraph[] {
    this.validateWritingTarget(projectId, section)
    const cards=(this.db.prepare('SELECT * FROM writing_paragraphs WHERE project_id=? AND section_key=? ORDER BY position,created_at').all(projectId,section) as Row[])
      .map((row) => this.writingParagraphFromRow(row))
    const groups=this.writingGroups(projectId,section),visited=new Set<string>()
    const order=(parentId:string|null):WritingParagraph[]=>{
      const own=cards.filter(p=>(p.groupId??null)===parentId)
      for(const g of groups.filter(g=>g.parentId===parentId&&!visited.has(g.id))){visited.add(g.id);own.push(...order(g.id))}
      return own
    }
    const ordered=order(null),ids=new Set(ordered.map(p=>p.id))
    return [...ordered,...cards.filter(p=>!ids.has(p.id))]
  }

  writingParagraph(id: string): WritingParagraph | null {
    const row = this.db.prepare('SELECT * FROM writing_paragraphs WHERE id=?').get(id) as Row | undefined
    return row ? this.writingParagraphFromRow(row) : null
  }

  writingGroups(projectId:string,section:WritingSectionKey):import('../shared/writing').WritingGroup[] {
    this.validateWritingTarget(projectId,section)
    return (this.db.prepare('SELECT * FROM writing_groups WHERE project_id=? AND section_key=? ORDER BY position,created_at').all(projectId,section) as Row[]).map(r=>({id:String(r.id),projectId,section,parentId:r.parent_id?String(r.parent_id):null,title:String(r.title),position:Number(r.position),createdAt:String(r.created_at),updatedAt:String(r.updated_at)}))
  }
  private validateWritingGroup(projectId:string,section:WritingSectionKey,id:string|null){
    if(id!==null&&!this.writingGroups(projectId,section).some(g=>g.id===id))throw Error('分组不属于当前稿件或章节。')
  }
  createWritingGroup(projectId:string,section:WritingSectionKey,title:string,parentId:string|null=null){
    this.validateWritingTarget(projectId,section);this.validateWritingGroup(projectId,section,parentId)
    if(typeof title!=='string'||!title.trim()||title.length>120)throw Error('请输入分组标题（最多 120 字）。')
    const groups=this.writingGroups(projectId,section);let depth=1,parent=groups.find(g=>g.id===parentId)
    while(parent){depth++;parent=groups.find(g=>g.id===parent!.parentId)}
    if(depth>4)throw Error('最多支持四层分组，请将细节放入段落卡片。')
    const id=crypto.randomUUID(),now=new Date().toISOString(),position=Math.max(0,...groups.filter(g=>g.parentId===parentId).map(g=>g.position))+1
    this.db.prepare('INSERT INTO writing_groups VALUES (?,?,?,?,?,?,?,?)').run(id,projectId,section,parentId,position,title.trim(),now,now)
    return this.writingGroups(projectId,section).find(g=>g.id===id)!
  }
  updateWritingGroup(id:string,title:string){
    if(typeof title!=='string'||!title.trim()||title.length>120)throw Error('分组标题无效。')
    const row=this.db.prepare('SELECT * FROM writing_groups WHERE id=?').get(id) as Row|undefined
    if(!row)throw Error('分组不存在。')
    this.db.prepare('UPDATE writing_groups SET title=?,updated_at=? WHERE id=?').run(title.trim(),new Date().toISOString(),id)
    return this.writingGroups(String(row.project_id),String(row.section_key) as WritingSectionKey).find(g=>g.id===id)!
  }
  removeWritingGroup(id:string){
    if(this.db.prepare('SELECT id FROM writing_groups WHERE parent_id=?').get(id)||this.db.prepare('SELECT id FROM writing_paragraphs WHERE group_id=?').get(id))throw Error('请先移动分组中的段落或删除空的子分组。')
    this.db.prepare('DELETE FROM writing_groups WHERE id=?').run(id)
  }
  moveWritingParagraph(id:string,groupId:string|null,position?:number){
    const paragraph=this.writingParagraph(id);if(!paragraph)throw Error('段落不存在。')
    this.validateWritingGroup(paragraph.projectId,paragraph.section,groupId)
    const siblings=this.writingParagraphs(paragraph.projectId,paragraph.section).filter(p=>p.id!==id&&(p.groupId??null)===groupId)
    if(position!==undefined&&(!Number.isInteger(position)||position<1||position>siblings.length+1))throw Error('段落顺序无效。')
    siblings.splice(position===undefined?siblings.length:position-1,0,paragraph)
    this.db.exec('BEGIN IMMEDIATE')
    try{for(const [i,p] of siblings.entries())this.db.prepare('UPDATE writing_paragraphs SET group_id=?,position=?,updated_at=? WHERE id=?').run(groupId,i+1,new Date().toISOString(),p.id);this.db.exec('COMMIT')}catch(e){this.db.exec('ROLLBACK');throw e}
    return this.writingParagraph(id)!
  }
  finalizeWritingParagraph(id:string,finalized:boolean){
    const p=this.writingParagraph(id);if(!p)throw Error('段落不存在。')
    const v=p.versions.find(v=>v.id===p.currentVersionId)
    if(typeof finalized!=='boolean')throw Error('定稿状态无效。')
    if(finalized&&(!v||v.status!=='complete'||!v.academicEn.trim()||!v.academicZh.trim()||p.draftText.trim()!==v.academicZh.trim()))throw Error('请先采纳一个完整的中英版本，再标记定稿。')
    this.db.prepare('UPDATE writing_paragraphs SET finalized_version_id=?,updated_at=? WHERE id=?').run(finalized?p.currentVersionId:null,new Date().toISOString(),id)
    return this.writingParagraph(id)!
  }
  writingTemplateBinding(projectId:string):import('../shared/writing').WritingLatexBinding|null {
    this.validateWritingTarget(projectId,'abstract')
    const row=this.db.prepare('SELECT * FROM writing_latex_bindings WHERE project_id=?').get(projectId) as Row|undefined
    return row?{projectId,latexProjectId:String(row.latex_project_id),language:String(row.language) as 'en'|'zh',mappings:JSON.parse(String(row.mappings_json)),updatedAt:String(row.updated_at)}:null
  }
  saveWritingTemplateBinding(binding:Omit<import('../shared/writing').WritingLatexBinding,'updatedAt'>){
    this.validateWritingTarget(binding.projectId,'abstract')
    this.db.prepare('INSERT INTO writing_latex_bindings VALUES (?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET latex_project_id=excluded.latex_project_id,language=excluded.language,mappings_json=excluded.mappings_json,updated_at=excluded.updated_at').run(binding.projectId,binding.latexProjectId,binding.language,JSON.stringify(binding.mappings),new Date().toISOString())
    return this.writingTemplateBinding(binding.projectId)!
  }

  createWritingParagraph(projectId: string, section: WritingSectionKey, groupId:string|null=null): WritingParagraph {
    this.validateWritingTarget(projectId, section)
    this.validateWritingGroup(projectId,section,groupId)
    const position = Number((this.db.prepare('SELECT COALESCE(MAX(position),0)+1 AS next FROM writing_paragraphs WHERE project_id=? AND section_key=? AND group_id IS ?').get(projectId,section,groupId) as Row).next)
    const now = new Date().toISOString(), id = crypto.randomUUID()
    this.db.prepare('INSERT INTO writing_paragraphs (id,project_id,section_key,position,title,draft_text,current_version_id,created_at,updated_at,group_id) VALUES (?,?,?,?,?,?,NULL,?,?,?)').run(id,projectId,section,position,`段落 ${position}`,'',now,now,groupId)
    return this.writingParagraph(id)!
  }

  updateWritingParagraph(id: string, title: string, draftText: string): WritingParagraph {
    if (typeof title !== 'string' || !title.trim() || title.length > 120 || typeof draftText !== 'string' || draftText.length > 60_000) throw new Error('段落标题或正文无效。')
    const now = new Date().toISOString()
    const result = this.db.prepare('UPDATE writing_paragraphs SET title=?,finalized_version_id=CASE WHEN draft_text=? THEN finalized_version_id ELSE NULL END,draft_text=?,updated_at=? WHERE id=?').run(title.trim(),draftText,draftText,now,id)
    if (!result.changes) throw new Error('段落不存在。')
    const paragraph = this.writingParagraph(id)!
    this.db.prepare('UPDATE writing_projects SET updated_at=? WHERE id=?').run(now,paragraph.projectId)
    return paragraph
  }

  createWritingParagraphVersion(paragraphId: string, request:import('../shared/writing').ParagraphRequest={mode:'polish',feedback:''}): WritingParagraphVersion {
    const paragraph = this.writingParagraph(paragraphId)
    if (!paragraph) throw new Error('段落不存在。')
    const input = paragraph.draftText.trim()
    if(!request||!['draft','polish','revise'].includes(request.mode)||typeof request.feedback!=='string'||request.feedback.length>8000)throw new Error('段落任务或修改要求无效。')
    if (!input&&request.mode==='polish') throw new Error('请先输入这一段的想法或草稿。')
    if(request.mode==='draft'&&!input&&!request.feedback.trim())throw new Error('请提供本段的写作目标或要点，再让助手拟写。')
    if (input.length > 16_000) throw new Error('这一段超过单次改写上限，请拆成多个段落卡片。')
    if (paragraph.versions.some((version) => ['queued','running'].includes(version.status))) throw new Error('此段落已有正在生成的版本。')
    const number = (paragraph.versions.at(-1)?.number ?? 0) + 1
    const baseId=request.baseVersionId??paragraph.currentVersionId
    if(baseId&&!paragraph.versions.some(v=>v.id===baseId&&v.status==='complete'))throw new Error('修改基准版本不存在。')
    if(request.mode==='revise'&&(!baseId||!request.feedback.trim()))throw new Error('请选择一个已完成版本，并说明希望修改哪里。')
    const id = crypto.randomUUID(), now = new Date().toISOString()
    this.db.prepare("INSERT INTO writing_paragraph_versions (id,paragraph_id,version_number,parent_version_id,input_text,academic_zh,academic_en,change_note,status,error,session_id,created_at,updated_at,request_mode,feedback) VALUES (?,?,?,?,?,'','','','queued',NULL,NULL,?,?,?,?)")
      .run(id,paragraphId,number,baseId,input,now,now,request.mode,request.feedback.trim())
    return this.writingParagraphVersion(id)!
  }

  writingParagraphVersion(id: string): WritingParagraphVersion | null {
    const row = this.db.prepare('SELECT * FROM writing_paragraph_versions WHERE id=?').get(id) as Row | undefined
    return row ? this.writingParagraphVersionFromRow(row) : null
  }

  attachWritingParagraphSession(id: string, sessionId: string): void {
    this.db.prepare("UPDATE writing_paragraph_versions SET session_id=?,status='running',updated_at=? WHERE id=? AND status='queued'")
      .run(sessionId,new Date().toISOString(),id)
  }

  failWritingParagraphVersion(id: string, error: string): void {
    this.db.prepare("UPDATE writing_paragraph_versions SET status='failed',error=?,updated_at=? WHERE id=? AND status!='complete'")
      .run(error.slice(0,2000),new Date().toISOString(),id)
  }

  pendingWritingParagraphVersions(): WritingParagraphVersion[] {
    return (this.db.prepare("SELECT * FROM writing_paragraph_versions WHERE status='running' ORDER BY updated_at LIMIT 20").all() as Row[])
      .map((row) => this.writingParagraphVersionFromRow(row))
  }

  acceptWritingParagraphVersion(id: string): WritingParagraph {
    const version = this.writingParagraphVersion(id)
    if (!version || version.status !== 'complete' || !version.academicZh.trim() || !version.academicEn.trim()) throw new Error('没有可采纳的双语版本。')
    const paragraph = this.writingParagraph(version.paragraphId)!
    if (paragraph.draftText.trim() !== version.inputText.trim()) throw new Error('输入内容已修改；请先比较，再生成新版本以免覆盖。')
    const now = new Date().toISOString()
    this.db.prepare('UPDATE writing_paragraphs SET current_version_id=?,draft_text=?,updated_at=?,finalized_version_id=NULL WHERE id=?')
      .run(id,version.academicZh,now,paragraph.id)
    this.db.prepare('UPDATE writing_projects SET updated_at=? WHERE id=?').run(now,paragraph.projectId)
    return this.writingParagraph(paragraph.id)!
  }

  private writingParagraphFromRow(row: Row): WritingParagraph {
    const id = String(row.id)
    const versions = (this.db.prepare('SELECT * FROM writing_paragraph_versions WHERE paragraph_id=? ORDER BY version_number').all(id) as Row[])
      .map((item) => this.writingParagraphVersionFromRow(item))
    return { id, projectId:String(row.project_id), section:String(row.section_key) as WritingSectionKey,
      groupId:row.group_id?String(row.group_id):null,finalized:!!row.finalized_version_id,finalizedVersionId:row.finalized_version_id?String(row.finalized_version_id):null,
      position:Number(row.position), title:String(row.title), draftText:String(row.draft_text),
      currentVersionId:row.current_version_id ? String(row.current_version_id) : null,
      versions, createdAt:String(row.created_at), updatedAt:String(row.updated_at) }
  }

  private writingParagraphVersionFromRow(row: Row): WritingParagraphVersion {
    return { id:String(row.id), paragraphId:String(row.paragraph_id), number:Number(row.version_number),
      requestMode:String(row.request_mode??'polish') as 'draft'|'polish'|'revise',feedback:String(row.feedback??''),
      parentVersionId:row.parent_version_id ? String(row.parent_version_id) : null,
      inputText:String(row.input_text), academicZh:String(row.academic_zh), academicEn:String(row.academic_en),
      changeNote:String(row.change_note), status:String(row.status) as WritingParagraphVersion['status'],
      error:row.error ? String(row.error) : null, sessionId:row.session_id ? String(row.session_id) : null,
      createdAt:String(row.created_at), updatedAt:String(row.updated_at) }
  }

  createWritingProject(title: string, field: string, targetJournal: string): WritingProject {
    this.validateProjectFields(title, field, targetJournal)
    const now = new Date().toISOString()
    const project: WritingProject = { id: crypto.randomUUID(), title: title.trim(), field: field.trim(), targetJournal: targetJournal.trim(), createdAt: now, updatedAt: now }
    this.db.prepare('INSERT INTO writing_projects VALUES (?,?,?,?,?,?)').run(project.id, project.title, project.field, project.targetJournal, now, now)
    return project
  }

  updateWritingProject(id: string, title: string, field: string, targetJournal: string): WritingProject {
    this.validateProjectFields(title, field, targetJournal)
    const result = this.db.prepare('UPDATE writing_projects SET title=?,field=?,target_journal=?,updated_at=? WHERE id=?').run(title.trim(),field.trim(),targetJournal.trim(),new Date().toISOString(),id)
    if (!result.changes) throw new Error('写作项目不存在。')
    return this.writingProjects().find((item) => item.id === id)!
  }

  writingDraft(projectId: string, section: WritingSectionKey): WritingDraft {
    this.validateWritingTarget(projectId, section)
    const row = this.db.prepare('SELECT * FROM writing_drafts WHERE project_id=? AND section_key=?').get(projectId, section) as Row | undefined
    return { projectId, section, text: String(row?.text ?? ''), updatedAt: row ? String(row.updated_at) : null }
  }

  saveWritingDraft(projectId: string, section: WritingSectionKey, text: string, checkpoint = false): WritingDraft {
    this.validateWritingTarget(projectId, section)
    if (typeof text !== 'string' || text.length > 150_000) throw new Error('草稿过长。')
    const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO writing_drafts VALUES (?,?,?,?) ON CONFLICT(project_id,section_key) DO UPDATE SET text=excluded.text,updated_at=excluded.updated_at`).run(projectId,section,text,now)
    if (checkpoint) this.db.prepare('INSERT INTO writing_draft_versions VALUES (?,?,?,?,?,?)').run(crypto.randomUUID(),projectId,section,text,null,now)
    this.db.prepare('UPDATE writing_projects SET updated_at=? WHERE id=?').run(now,projectId)
    return this.writingDraft(projectId, section)
  }

  writingDraftHistory(projectId: string, section: WritingSectionKey): WritingDraftVersion[] {
    this.validateWritingTarget(projectId, section)
    return (this.db.prepare('SELECT * FROM writing_draft_versions WHERE project_id=? AND section_key=? ORDER BY created_at DESC').all(projectId,section) as Row[])
      .map((row) => ({ id: String(row.id), projectId, section, text: String(row.text), sourceRevisionId: row.source_revision_id ? String(row.source_revision_id) : null, createdAt: String(row.created_at) }))
  }

  createWritingRevision(projectId: string, section: WritingSectionKey, mode: WritingReviewMode): WritingRevision {
    this.validateWritingTarget(projectId, section)
    if (!['critique','polish'].includes(mode)) throw new Error('未知写作任务。')
    const sourceText = this.writingDraft(projectId, section).text.trim()
    if (!sourceText) throw new Error('请先写入并保存这一部分的草稿。')
    if (sourceText.length > 40_000) throw new Error('当前章节超过单次审阅上限，请分段处理。')
    if (this.db.prepare("SELECT id FROM writing_revisions WHERE project_id=? AND section_key=? AND status IN ('queued','running')").get(projectId,section)) throw new Error('当前章节已有正在运行的审阅。')
    const now = new Date().toISOString(), id = crypto.randomUUID()
    this.db.prepare("INSERT INTO writing_revisions VALUES (?,?,?,?,?,'queued',NULL,NULL,NULL,?,?)").run(id,projectId,section,mode,sourceText,now,now)
    return this.writingRevision(id)!
  }

  writingRevision(id: string): WritingRevision | null {
    const row = this.db.prepare('SELECT * FROM writing_revisions WHERE id=?').get(id) as Row | undefined
    return row ? this.writingRevisionFromRow(row) : null
  }

  writingRevisions(projectId: string, section: WritingSectionKey): WritingRevision[] {
    this.validateWritingTarget(projectId, section)
    return (this.db.prepare('SELECT * FROM writing_revisions WHERE project_id=? AND section_key=? ORDER BY created_at DESC').all(projectId,section) as Row[]).map((row) => this.writingRevisionFromRow(row))
  }

  pendingWritingRevisions(): WritingRevision[] {
    return (this.db.prepare("SELECT * FROM writing_revisions WHERE status='running' ORDER BY updated_at LIMIT 20").all() as Row[]).map((row) => this.writingRevisionFromRow(row))
  }

  attachWritingSession(id: string, sessionId: string): void {
    this.db.prepare("UPDATE writing_revisions SET session_id=?,status='running',updated_at=? WHERE id=?").run(sessionId,new Date().toISOString(),id)
  }

  failWritingRevision(id: string, error: string): void {
    this.db.prepare("UPDATE writing_revisions SET status='failed',error=?,updated_at=? WHERE id=? AND status!='complete'").run(error.slice(0,2000),new Date().toISOString(),id)
  }

  acceptWritingRevision(id: string): WritingDraft {
    const revision = this.writingRevision(id)
    if (!revision || revision.status !== 'complete' || !revision.result?.proposedText.trim()) throw new Error('没有可采纳的修改稿。')
    const current = this.writingDraft(revision.projectId, revision.section)
    if (current.text.trim() !== revision.sourceText) throw new Error('草稿已经修改。请先比较当前版本与建议，避免覆盖新内容。')
    const now = new Date().toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('INSERT INTO writing_draft_versions VALUES (?,?,?,?,?,?)').run(crypto.randomUUID(),revision.projectId,revision.section,current.text,null,now)
      this.db.prepare('INSERT INTO writing_draft_versions VALUES (?,?,?,?,?,?)').run(crypto.randomUUID(),revision.projectId,revision.section,revision.result.proposedText,id,now)
      this.db.prepare('UPDATE writing_drafts SET text=?,updated_at=? WHERE project_id=? AND section_key=?').run(revision.result.proposedText,now,revision.projectId,revision.section)
      this.db.prepare('UPDATE writing_projects SET updated_at=? WHERE id=?').run(now,revision.projectId)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
    return this.writingDraft(revision.projectId, revision.section)
  }

  private validateProjectFields(title: string, field: string, journal: string): void {
    if (typeof title !== 'string' || !title.trim() || title.length > 300 || typeof field !== 'string' || field.length > 120 || typeof journal !== 'string' || journal.length > 120) throw new Error('项目名称或领域无效。')
  }

  private validateWritingTarget(projectId: string, section: WritingSectionKey): void {
    if (!writingSections.includes(section) || !this.db.prepare('SELECT id FROM writing_projects WHERE id=?').get(projectId)) throw new Error('写作项目或章节不存在。')
  }

  private writingProjectFromRow(row: Row): WritingProject {
    return { id: String(row.id), title: String(row.title), field: String(row.field), targetJournal: String(row.target_journal), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }
  }

  private writingRevisionFromRow(row: Row): WritingRevision {
    return { id: String(row.id), projectId: String(row.project_id), section: String(row.section_key) as WritingSectionKey, mode: String(row.mode) as WritingReviewMode,
      sourceText: String(row.source_text), status: String(row.status) as WritingRevision['status'], result: row.result_json ? JSON.parse(String(row.result_json)) as WritingRevision['result'] : null,
      error: row.error ? String(row.error) : null, sessionId: row.session_id ? String(row.session_id) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }
  }

  listWorkspaces(): WorkspaceRoot[] {
    return (this.db.prepare('SELECT * FROM workspace_roots ORDER BY created_at').all() as Row[]).map(this.workspaceFromRow)
  }

  addWorkspace(folder: string): WorkspaceRoot {
    const absolute = path.resolve(folder)
    const stat = fs.statSync(absolute)
    if (!stat.isDirectory()) throw new Error('工作区必须是文件夹。')
    const existing = this.db.prepare('SELECT * FROM workspace_roots WHERE path=?').get(absolute) as Row | undefined
    if (existing) return this.workspaceFromRow(existing)
    const root: WorkspaceRoot = {
      id: crypto.randomUUID(), path: absolute, name: path.basename(absolute) || absolute,
      permission: 'read-write', createdAt: new Date().toISOString(),
    }
    this.db.prepare('INSERT INTO workspace_roots (id, path, name, permission, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(root.id, root.path, root.name, root.permission, root.createdAt)
    return root
  }

  removeWorkspace(id: string): void {
    this.db.prepare('DELETE FROM workspace_roots WHERE id=?').run(id)
  }

  async workspaceTree(id: string, relativePath = '', query = ''): Promise<WorkspaceEntry[]> {
    const root = this.db.prepare('SELECT * FROM workspace_roots WHERE id=?').get(id) as Row | undefined
    if (!root) throw new Error('工作区不存在。')
    const rootPath = String(root.path)
    const target = path.resolve(rootPath, relativePath)
    if (!isPathInside(target, rootPath)) throw new Error('路径越过了工作区边界。')
    if (!query.trim()) return this.readDirectory(target)
    const results: WorkspaceEntry[] = []
    const stack = [target]
    while (stack.length && results.length < 200) {
      const current = stack.pop()!
      for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue
        const fullPath = path.join(current, entry.name)
        if (entry.isDirectory()) stack.push(fullPath)
        if (entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) {
          results.push(await this.entryFromPath(fullPath, entry.isDirectory()))
        }
      }
    }
    return results.sort((a, b) => Number(a.type === 'file') - Number(b.type === 'file') || a.name.localeCompare(b.name))
  }

  isManagedPath(candidate: string): boolean {
    return this.listWorkspaces().some((workspace) => isPathInside(candidate, workspace.path))
  }

  private async readDirectory(directory: string): Promise<WorkspaceEntry[]> {
    const entries = await fsp.readdir(directory, { withFileTypes: true })
    const result = await Promise.all(entries.filter((entry) => !entry.isSymbolicLink()).map((entry) =>
      this.entryFromPath(path.join(directory, entry.name), entry.isDirectory())))
    return result.sort((a, b) => Number(a.type === 'file') - Number(b.type === 'file') || a.name.localeCompare(b.name))
  }

  private async entryFromPath(filePath: string, directory: boolean): Promise<WorkspaceEntry> {
    const stat = await fsp.stat(filePath)
    return { name: path.basename(filePath), path: filePath, type: directory ? 'directory' : 'file', size: directory ? null : stat.size, modifiedAt: stat.mtimeMs }
  }

  private async writeExtractedMarkdown(paper: PaperRecord, pages: string[]): Promise<void> {
    const header = [`# ${paper.title}`, '', `Source: ${paper.sourcePath}`, `SHA-256: ${paper.checksum}`, '']
    const body = pages.map((text, index) => `<!-- page:${index + 1} -->\n\n## Page ${index + 1}\n\n${text}`).join('\n\n')
    await fsp.writeFile(path.join(this.paths.extracted, `${paper.id}.md`), `${header.join('\n')}${body}\n`, 'utf8')
  }

  private paperFromRow(row: Row): PaperRecord {
    return {
      id: String(row.id), sourcePath: String(row.source_path), fileName: String(row.file_name), checksum: String(row.checksum),
      originalPath: String(row.original_path ?? ''), venue: String(row.venue ?? ''), codeUrl: String(row.code_url ?? ''), affiliations: String(row.affiliations ?? ''), keywords: JSON.parse(String(row.keywords_json ?? '[]')), tags: JSON.parse(String(row.tags_json ?? '[]')), collection: String(row.collection_name ?? ''), readingPage: Number(row.reading_page ?? 1), rating: Number(row.rating ?? 0), deletedAt: row.deleted_at ? String(row.deleted_at) : null,
      size: Number(row.size), modifiedAt: Number(row.modified_at), title: String(row.title),
      authors: JSON.parse(String(row.authors_json)) as string[], year: row.year === null ? null : Number(row.year),
      doi: row.doi === null ? null : String(row.doi), language: String(row.language), pageCount: Number(row.page_count),
      indexStatus: String(row.index_status) as PaperRecord['indexStatus'], missing: Boolean(row.missing),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }
  }

  private artifactFromRow(row: Row, refresh: boolean): PaperArtifact {
    void refresh
    return {
      id: String(row.id), paperId: String(row.paper_id), sessionId: row.session_id ? String(row.session_id) : null,
      kind: String(row.kind) as ArtifactKind, status: String(row.status) as PaperArtifact['status'],
      progress: Number(row.progress), markdownPath: String(row.markdown_path), error: row.error ? String(row.error) : null,
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      selection: String(row.selection ?? ''), pageNumber: Number(row.page_number ?? 1),
      questionContexts: row.question_contexts_json ? JSON.parse(String(row.question_contexts_json)) : [],
      review: row.review_json ? JSON.parse(String(row.review_json)) as PaperArtifact['review'] : null,
      answer: row.answer_json ? JSON.parse(String(row.answer_json)) as PaperArtifact['answer'] : null,
    }
  }

  private workspaceFromRow(row: Row): WorkspaceRoot {
    return { id: String(row.id), path: String(row.path), name: String(row.name), permission: 'read-write', createdAt: String(row.created_at) }
  }

  private migrate(): void {
    const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version ?? 0)
    const hasPapers = this.db.prepare("SELECT name FROM sqlite_master WHERE name='papers'").get()
    if (hasPapers && version < 13) this.db.exec(`VACUUM INTO '${path.join(this.paths.database, `backup-${Date.now()}.sqlite`).replaceAll("'", "''")}'`)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS papers (
        id TEXT PRIMARY KEY, source_path TEXT NOT NULL, file_name TEXT NOT NULL, checksum TEXT NOT NULL UNIQUE,
        size INTEGER NOT NULL, modified_at REAL NOT NULL, title TEXT NOT NULL, authors_json TEXT NOT NULL,
        year INTEGER, doi TEXT, language TEXT NOT NULL, page_count INTEGER NOT NULL, index_status TEXT NOT NULL,
        missing INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS paper_pages (
        paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE, page_number INTEGER NOT NULL, text TEXT NOT NULL,
        PRIMARY KEY (paper_id, page_number)
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS paper_fts USING fts5(paper_id UNINDEXED, page_number UNINDEXED, text, tokenize='unicode61');
      CREATE TABLE IF NOT EXISTS paper_artifacts (
        id TEXT PRIMARY KEY, paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE, session_id TEXT,
        kind TEXT NOT NULL, status TEXT NOT NULL, progress INTEGER NOT NULL, markdown_path TEXT NOT NULL,
        error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspace_roots (
        id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, name TEXT NOT NULL, permission TEXT NOT NULL, created_at TEXT NOT NULL
      );
    `)
    if (version < 2) {
      this.db.exec(`BEGIN IMMEDIATE;
        ALTER TABLE papers ADD COLUMN original_path TEXT NOT NULL DEFAULT '';
        ALTER TABLE papers ADD COLUMN venue TEXT NOT NULL DEFAULT '';
        ALTER TABLE papers ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE papers ADD COLUMN collection_name TEXT NOT NULL DEFAULT '';
        ALTER TABLE papers ADD COLUMN reading_page INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE papers ADD COLUMN deleted_at TEXT;
        ALTER TABLE paper_artifacts ADD COLUMN selection TEXT NOT NULL DEFAULT '';
        ALTER TABLE paper_artifacts ADD COLUMN page_number INTEGER NOT NULL DEFAULT 1;
        CREATE TABLE paper_highlights (id TEXT PRIMARY KEY, paper_id TEXT NOT NULL REFERENCES papers(id), page_number INTEGER NOT NULL, text TEXT NOT NULL, rects_json TEXT NOT NULL);
        PRAGMA user_version=2; COMMIT;`)
    }
    if (version < 3) this.db.exec(`BEGIN IMMEDIATE; ALTER TABLE paper_artifacts ADD COLUMN review_json TEXT; PRAGMA user_version=3; COMMIT;`)
    if (version < 4) this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE paper_notes (paper_id TEXT PRIMARY KEY REFERENCES papers(id), personal_text TEXT NOT NULL DEFAULT '', summary_artifact_id TEXT, included_sections_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL);
      CREATE TABLE paper_note_versions (id TEXT PRIMARY KEY, paper_id TEXT NOT NULL REFERENCES papers(id), version INTEGER NOT NULL, markdown TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(paper_id,version));
      CREATE TABLE writing_projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, field TEXT NOT NULL, target_journal TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE writing_drafts (project_id TEXT NOT NULL REFERENCES writing_projects(id), section_key TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, PRIMARY KEY(project_id,section_key));
      CREATE TABLE writing_draft_versions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES writing_projects(id), section_key TEXT NOT NULL, text TEXT NOT NULL, source_revision_id TEXT, created_at TEXT NOT NULL);
      CREATE TABLE writing_revisions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES writing_projects(id), section_key TEXT NOT NULL, mode TEXT NOT NULL, source_text TEXT NOT NULL, status TEXT NOT NULL, result_json TEXT, error TEXT, session_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX writing_revisions_project_section ON writing_revisions(project_id,section_key,created_at DESC);
      PRAGMA user_version=4; COMMIT;`)
    if (version < 5) this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE paper_reader_cards (
        id TEXT PRIMARY KEY, paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
        kind TEXT NOT NULL, artifact_id TEXT, section_key TEXT, page_number INTEGER,
        source_text TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', rects_json TEXT NOT NULL DEFAULT '[]',
        hidden INTEGER NOT NULL DEFAULT 0, included INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX paper_reader_cards_paper ON paper_reader_cards(paper_id,created_at);
      PRAGMA user_version=5; COMMIT;`)
    if (version < 6) {
      this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE writing_paragraphs (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES writing_projects(id), section_key TEXT NOT NULL,
          position INTEGER NOT NULL, title TEXT NOT NULL, draft_text TEXT NOT NULL DEFAULT '', current_version_id TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE INDEX writing_paragraphs_section ON writing_paragraphs(project_id,section_key,position);
        CREATE TABLE writing_paragraph_versions (
          id TEXT PRIMARY KEY, paragraph_id TEXT NOT NULL REFERENCES writing_paragraphs(id), version_number INTEGER NOT NULL,
          parent_version_id TEXT, input_text TEXT NOT NULL, academic_zh TEXT NOT NULL DEFAULT '',
          academic_en TEXT NOT NULL DEFAULT '', change_note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
          error TEXT, session_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          UNIQUE(paragraph_id,version_number)
        );
        CREATE INDEX writing_paragraph_versions_paragraph ON writing_paragraph_versions(paragraph_id,version_number);
      `)
      try {
        const oldDrafts = this.db.prepare("SELECT * FROM writing_drafts WHERE TRIM(text) <> ''").all() as Row[]
        for (const draft of oldDrafts) {
          const id = crypto.randomUUID(), versionId = crypto.randomUUID(), now = String(draft.updated_at)
          this.db.prepare('INSERT INTO writing_paragraphs VALUES (?,?,?,?,?,?,?,?,?)')
            .run(id,draft.project_id,draft.section_key,1,'原章节草稿',draft.text,versionId,now,now)
          this.db.prepare("INSERT INTO writing_paragraph_versions VALUES (?,?,1,NULL,? ,?,'','从旧版整章草稿迁入','complete',NULL,NULL,?,?)")
            .run(versionId,id,draft.text,draft.text,now,now)
        }
        this.db.exec('PRAGMA user_version=6; COMMIT;')
      } catch (error) { this.db.exec('ROLLBACK'); throw error }
    }
    if (version < 7) {
      const hasNoteColor = (this.db.prepare('PRAGMA table_info(paper_reader_cards)').all() as Row[]).some((row) => row.name === 'note_color')
      this.db.exec(`BEGIN IMMEDIATE;
        ${hasNoteColor ? '' : 'ALTER TABLE paper_reader_cards ADD COLUMN note_color TEXT;'}
        PRAGMA user_version=7; COMMIT;`)
    }
    if (version < 8) {
      const hasAnswerJson = (this.db.prepare('PRAGMA table_info(paper_artifacts)').all() as Row[]).some((row) => row.name === 'answer_json')
      this.db.exec(`BEGIN IMMEDIATE; ${hasAnswerJson ? '' : 'ALTER TABLE paper_artifacts ADD COLUMN answer_json TEXT;'} PRAGMA user_version=8; COMMIT;`)
    }
    if (version < 9) {
      const columns = new Set((this.db.prepare('PRAGMA table_info(papers)').all() as Row[]).map((row) => String(row.name)))
      this.db.exec(`BEGIN IMMEDIATE;
        ${columns.has('code_url') ? '' : "ALTER TABLE papers ADD COLUMN code_url TEXT NOT NULL DEFAULT '';"}
        ${columns.has('affiliations') ? '' : "ALTER TABLE papers ADD COLUMN affiliations TEXT NOT NULL DEFAULT '';"}
        ${columns.has('keywords_json') ? '' : "ALTER TABLE papers ADD COLUMN keywords_json TEXT NOT NULL DEFAULT '[]';"}
        PRAGMA user_version=9; COMMIT;`)
    }
    if (version < 10) {
      const columns = new Set((this.db.prepare('PRAGMA table_info(papers)').all() as Row[]).map((row) => String(row.name)))
      this.db.exec(`BEGIN IMMEDIATE;
        ${columns.has('rating') ? '' : 'ALTER TABLE papers ADD COLUMN rating INTEGER NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5);'}
        PRAGMA user_version=10; COMMIT;`)
    }
    if (version < 11) {
      const exists = (this.db.prepare('PRAGMA table_info(paper_reader_cards)').all() as Row[]).some((row) => row.name === 'segments_json')
      this.db.exec(`BEGIN IMMEDIATE; ${exists ? '' : "ALTER TABLE paper_reader_cards ADD COLUMN segments_json TEXT NOT NULL DEFAULT '[]';"} PRAGMA user_version=11; COMMIT;`)
    }
    if (version < 12) {
      const exists = (this.db.prepare('PRAGMA table_info(paper_artifacts)').all() as Row[]).some(row => row.name === 'question_contexts_json')
      this.db.exec(`BEGIN IMMEDIATE; ${exists ? '' : "ALTER TABLE paper_artifacts ADD COLUMN question_contexts_json TEXT NOT NULL DEFAULT '[]';"} PRAGMA user_version=12; COMMIT;`)
    }
    if(version<13){
      const add=(table:string,column:string,definition:string)=>(this.db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).some(r=>r.name===column)?'':`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`
      this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS writing_groups (id TEXT PRIMARY KEY,project_id TEXT NOT NULL,section_key TEXT NOT NULL,parent_id TEXT,position INTEGER NOT NULL,title TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS writing_latex_bindings (project_id TEXT PRIMARY KEY,latex_project_id TEXT NOT NULL,language TEXT NOT NULL,mappings_json TEXT NOT NULL,updated_at TEXT NOT NULL);
        ${add('writing_paragraphs','group_id','TEXT')}
        ${add('writing_paragraphs','finalized_version_id','TEXT')}
        ${add('writing_paragraph_versions','request_mode',"TEXT NOT NULL DEFAULT 'polish'")}
        ${add('writing_paragraph_versions','feedback',"TEXT NOT NULL DEFAULT ''")}
        PRAGMA user_version=13; COMMIT;`)
    }
  }
}
