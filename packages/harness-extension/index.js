import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { validateReview, validateAnswer, reviewToMarkdown } from './review.js'
import { pickAnswerColor } from './answer-colors.js'

export const name = 'singularity-research-tools'
export const inject = ['tools']
export const Config = z.object({ databasePath: z.string().required(), artifactsRoot: z.string().required() })
const output = { schema: { type: 'json' }, render(_args, value) { return [{ type: 'text', text: JSON.stringify(value, null, 2) }] } }

function rowPaper(row) {
  return {
    id: String(row.id), title: String(row.title), authors: JSON.parse(String(row.authors_json)),
    year: row.year === null ? null : Number(row.year), doi: row.doi === null ? null : String(row.doi),
    language: String(row.language), pageCount: Number(row.page_count), indexStatus: String(row.index_status),
    missing: Boolean(row.missing), sourcePath: String(row.source_path),
  }
}

function quotedFts(query) {
  return query.trim().split(/\s+/).filter(Boolean).slice(0, 12).map((term) => `"${term.replaceAll('"', '""')}"`).join(' OR ')
}

export function apply(ctx, config) {
  const open = () => {
    const db = new DatabaseSync(config.databasePath)
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;')
    return db
  }
  ctx.tools.register(defineTool({
    name: 'research_save_digest', description: 'Submit structured research digest content for host validation. Sources must match the provided issue.',
    parameters: { issueId: { type:'string', required:true }, resultJson: { type:'string', required:true } }, output,
    async execute(args) {
      if (args.resultJson.length > 100000) throw new Error('Result too large')
      const result=JSON.parse(args.resultJson)
      if (!Array.isArray(result.items) || !result.items.length || typeof result.overview !== 'string') throw new Error('Invalid digest')
      const db=open()
      try {
        const row=db.prepare('SELECT body FROM research_issues WHERE id=?').get(args.issueId)
        if(!row) throw new Error('Unknown digest')
        const issue=JSON.parse(row.body)
        if(!['collecting','generating'].includes(issue.status)) throw new Error('Digest is not accepting results')
        if(result.items.some((i)=>!issue.sources.some((s)=>s.id===i.sourceId))) throw new Error('Unknown source')
        db.prepare('UPDATE research_issues SET result_json=? WHERE id=?').run(JSON.stringify(result),args.issueId)
        return { accepted:true,issueId:args.issueId }
      } finally { db.close() }
    },
  }))
  function clip(value, budget) {
    const plain = String(value ?? '').replace(/\s+/g, ' ').trim()
    return plain.length <= budget ? plain : `${plain.slice(0, budget).trimEnd()}…`
  }
  ctx.tools.register(defineTool({
    name: 'field_read', description: 'Read one Singularity research field. Call this before answering whenever the user message contains @[title](singularity-field:FIELD_ID), and pass that FIELD_ID. Returns the surveyed summary and titles already collected in the field. Do not invent papers or findings beyond this result.',
    parameters: { fieldId: { type: 'string', required: true, description: 'Id inside singularity-field:FIELD_ID.' } }, output,
    async execute(args) {
      if (!/^[\da-f-]{36}$/i.test(args.fieldId)) throw new Error('Invalid field id')
      const db = open()
      try {
        const row = db.prepare('SELECT body FROM field_bases WHERE id=?').get(args.fieldId)
        if (!row) throw new Error('Field not found')
        const record = JSON.parse(String(row.body))
        const papers = db.prepare('SELECT body FROM field_papers WHERE field_id=?').all(args.fieldId).map((item) => JSON.parse(String(item.body)))
        const lines = [`领域：${clip(record.title, 120)}`, `综述 v${record.documentVersion ?? 0} · 收录 ${papers.length} 篇`]
        const report = Array.isArray(record.reports) ? record.reports.at(-1) : undefined
        if (report?.overview) lines.push(`最近一次梳理：${clip(report.overview, 240)}`)
        for (const section of (Array.isArray(record.sections) ? record.sections : []).slice(0, 8)) lines.push(`- ${clip(section.title, 40)}：${clip(section.body, 120)}`)
        const titles = papers.slice(0, 10).map((paper) => `- ${clip(paper?.source?.title, 90)}`)
        if (titles.length) lines.push('已收录论文：', ...titles)
        if (record.notes) lines.push(`用户笔记：${clip(record.notes, 200)}`)
        return { id: args.fieldId, title: String(record.title ?? ''), summary: lines.join('\n').slice(0, 2600) }
      } finally { db.close() }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'paper_context', description: 'Read one paper the user mentioned from the Singularity library. Call this once per paper before answering whenever the user message contains @[title](singularity-paper:PAPER_ID), and pass that PAPER_ID. Returns verified metadata and the opening indexed pages. Cite page evidence as [p.N]. Do not state details that are absent from the returned text; use paper_read_pages or paper_search for later pages.',
    parameters: { paperId: { type: 'string', required: true, description: 'Id inside singularity-paper:PAPER_ID.' } }, output,
    async execute(args) {
      if (!/^[\da-f-]{36}$/i.test(args.paperId)) throw new Error('Invalid paper id')
      const db = open()
      try {
        const row = db.prepare('SELECT * FROM papers WHERE id=? AND deleted_at IS NULL').get(args.paperId)
        if (!row) throw new Error('Paper not found')
        const pages = db.prepare('SELECT page_number, text FROM paper_pages WHERE paper_id=? AND page_number BETWEEN 1 AND 3 ORDER BY page_number').all(args.paperId).map((page) => ({ page: Number(page.page_number), anchor: `[p.${page.page_number}]`, text: clip(page.text, 1200) }))
        return { ...rowPaper(row), pages, indexed: pages.length > 0 }
      } finally { db.close() }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'paper_list', description: 'List papers explicitly imported into the local Singularity research library. Use returned ids with the other paper tools. A user mention @[title](singularity-paper:PAPER_ID) already names the id; call paper_context for that paper instead of guessing from this list.',
    parameters: {}, output,
    async execute() { const db = open(); try { return db.prepare('SELECT * FROM papers WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200').all().map(rowPaper) } finally { db.close() } },
  }))
  ctx.tools.register(defineTool({
    name: 'paper_metadata', description: 'Read the verified metadata and current source state for one imported paper.',
    parameters: { paperId: { type: 'string', required: true, description: 'Paper id from paper_list.' } }, output,
    async execute(args) { const db = open(); try { const row = db.prepare('SELECT * FROM papers WHERE id=?').get(args.paperId); if (!row) throw new Error('Paper not found'); return rowPaper(row) } finally { db.close() } },
  }))
  ctx.tools.register(defineTool({
    name: 'paper_search', description: 'Run local SQLite FTS5 full-text search over imported paper pages. Results contain exact page anchors.',
    parameters: {
      query: { type: 'string', required: true, description: 'Terms to search.' }, paperId: { type: 'string', description: 'Optional paper id restriction.' },
      limit: { type: 'integer', description: 'Maximum results, 1-50.' },
    }, output,
    async execute(args) {
      const query = quotedFts(args.query); if (!query) return []
      const limit = Math.max(1, Math.min(50, args.limit ?? 20)); const db = open()
      try {
        const sql = `SELECT f.paper_id, f.page_number, p.title, snippet(paper_fts, 2, '', '', ' … ', 28) excerpt FROM paper_fts f JOIN papers p ON p.id=f.paper_id WHERE paper_fts MATCH ? ${args.paperId ? 'AND f.paper_id=?' : ''} ORDER BY bm25(paper_fts) LIMIT ?`
        const rows = args.paperId ? db.prepare(sql).all(query, args.paperId, limit) : db.prepare(sql).all(query, limit)
        return rows.map((row) => ({ paperId: String(row.paper_id), page: Number(row.page_number), title: String(row.title), text: String(row.excerpt) }))
      } finally { db.close() }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'paper_read_pages', description: 'Read normalized text from an imported text PDF by inclusive page range. Cite evidence as [p.N]. At most 20 pages per call.',
    parameters: { paperId: { type: 'string', required: true }, fromPage: { type: 'integer', required: true }, toPage: { type: 'integer', required: true } }, output,
    async execute(args) {
      const from = Math.max(1, args.fromPage); const to = Math.min(args.toPage, from + 19); if (to < from) throw new Error('Invalid page range'); const db = open()
      try { return db.prepare('SELECT page_number, text FROM paper_pages WHERE paper_id=? AND page_number BETWEEN ? AND ? ORDER BY page_number').all(args.paperId, from, to).map((row) => ({ page: Number(row.page_number), anchor: `[p.${row.page_number}]`, text: String(row.text) })) } finally { db.close() }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'writing_save_revision', description: 'Submit structured manuscript feedback and a suggested revision. This never changes the author draft; the user must accept it explicitly.',
    parameters: { revisionId: { type:'string', required:true }, resultJson: { type:'string', required:true } }, output,
    async execute(args, exec) {
      if (!/^[\da-f-]{36}$/i.test(args.revisionId) || typeof args.resultJson !== 'string' || args.resultJson.length > 250_000) throw new Error('Invalid writing result')
      const value = JSON.parse(args.resultJson)
      if (typeof value.assessment !== 'string' || !value.assessment.trim() || value.assessment.length > 5000 ||
          typeof value.proposedText !== 'string' || value.proposedText.length > 150_000 ||
          !Array.isArray(value.issues) || value.issues.length > 30 ||
          !Array.isArray(value.claimEvidenceMap) || value.claimEvidenceMap.length > 30) throw new Error('Incomplete writing result')
      for (const issue of value.issues) if (!['high','medium','low'].includes(issue?.severity) ||
        typeof issue.problem !== 'string' || !issue.problem.trim() || issue.problem.length > 2000 ||
        typeof issue.suggestion !== 'string' || !issue.suggestion.trim() || issue.suggestion.length > 4000 ||
        typeof issue.evidenceNeeded !== 'string' || issue.evidenceNeeded.length > 2000) throw new Error('Invalid revision issue')
      for (const item of value.claimEvidenceMap) if (typeof item?.claim !== 'string' || !item.claim.trim() || item.claim.length > 2000 ||
        typeof item.evidence !== 'string' || item.evidence.length > 3000 || !['supported','needs-evidence'].includes(item.status)) throw new Error('Invalid claim-evidence map')
      const db = open()
      try {
        const target = db.prepare('SELECT mode,status FROM writing_revisions WHERE id=?').get(args.revisionId)
        if (!target || !['queued','running'].includes(target.status)) throw new Error('Writing revision is not accepting results')
        if (target.mode === 'polish' && !value.proposedText.trim()) throw new Error('Polishing requires a complete proposed text')
        const result = { assessment:value.assessment.trim(), issues:value.issues, proposedText:value.proposedText.trim(), claimEvidenceMap:value.claimEvidenceMap }
        const sessionId = exec.agent?.session?.header?.id ? String(exec.agent.session.header.id) : null
        db.prepare("UPDATE writing_revisions SET result_json=?,status='complete',error=NULL,session_id=?,updated_at=? WHERE id=?")
          .run(JSON.stringify(result),sessionId,new Date().toISOString(),args.revisionId)
        return { accepted:true,revisionId:args.revisionId,issues:result.issues.length }
      } finally { db.close() }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'writing_save_paragraph_version', description: 'Submit one source-grounded academic paragraph in Chinese and English. The author must explicitly accept this version.',
    parameters: { versionId: { type:'string', required:true }, resultJson: { type:'string', required:true } }, output,
    async execute(args, exec) {
      if (!/^[\da-f-]{36}$/i.test(args.versionId) || typeof args.resultJson !== 'string' || args.resultJson.length > 120_000) throw new Error('Invalid paragraph result')
      const value = JSON.parse(args.resultJson)
      if (typeof value.academicZh !== 'string' || !value.academicZh.trim() || value.academicZh.length > 30_000 ||
          typeof value.academicEn !== 'string' || !value.academicEn.trim() || value.academicEn.length > 30_000 ||
          typeof value.changeNote !== 'string' || value.changeNote.length > 1200) throw new Error('Incomplete bilingual paragraph')
      const db = open()
      try {
        const target = db.prepare('SELECT status FROM writing_paragraph_versions WHERE id=?').get(args.versionId)
        if (!target || !['queued','running'].includes(target.status)) throw new Error('Paragraph version is not accepting results')
        const sessionId = exec.agent?.session?.header?.id ? String(exec.agent.session.header.id) : null
        db.prepare("UPDATE writing_paragraph_versions SET academic_zh=?,academic_en=?,change_note=?,status='complete',error=NULL,session_id=?,updated_at=? WHERE id=?")
          .run(value.academicZh.trim(),value.academicEn.trim(),value.changeNote.trim(),sessionId,new Date().toISOString(),args.versionId)
        return { accepted:true,versionId:args.versionId }
      } finally { db.close() }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'paper_save_review', description: 'Save the 11-section, source-verified Singularity paper review. Quotes must occur verbatim on the specified indexed PDF page.',
    parameters: {
      paperId: { type: 'string', required: true }, artifactId: { type: 'string', required: true },
      reviewJson: { type: 'string', required: true, description: 'JSON with version:1 and exactly 11 ordered sections; each section has key, body and evidence [{page,quote}].' },
    }, output,
    async execute(args, exec) {
      if (!/^[\da-f-]{36}$/i.test(args.paperId) || !/^[\da-f-]{36}$/i.test(args.artifactId) || args.reviewJson.length > 200_000) throw new Error('Invalid review request')
      const db = open()
      try {
        const target = db.prepare('SELECT paper_id,kind FROM paper_artifacts WHERE id=?').get(args.artifactId)
        if (!target || target.paper_id !== args.paperId || target.kind !== 'summary') throw new Error('Review does not belong to this paper/task')
        const review = validateReview(JSON.parse(args.reviewJson), (page) => {
          const row = db.prepare('SELECT text FROM paper_pages WHERE paper_id=? AND page_number=?').get(args.paperId, page)
          return row ? String(row.text) : null
        })
        const directory = path.join(config.artifactsRoot, args.paperId); fs.mkdirSync(directory, { recursive: true })
        const artifactPath = path.join(directory, `summary-${args.artifactId}.md`)
        fs.writeFileSync(artifactPath, reviewToMarkdown(review), 'utf8')
        const now = new Date().toISOString()
        const sessionId = exec.agent?.session?.header?.id ? String(exec.agent.session.header.id) : null
        db.prepare("UPDATE paper_artifacts SET session_id=?,status='complete',progress=100,markdown_path=?,review_json=?,error=NULL,updated_at=? WHERE id=?")
          .run(sessionId, artifactPath, JSON.stringify(review), now, args.artifactId)
        return { id: args.artifactId, status: 'complete', sections: review.sections.length }
      } finally { db.close() }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'paper_save_answer', description: 'Save a paper Q&A reply with page-grounded verbatim quotes. Only verified quotes become PDF highlights.',
    parameters: {
      paperId: { type: 'string', required: true }, artifactId: { type: 'string', required: true },
      answerJson: { type: 'string', required: true, description: 'JSON {version:1,body:Markdown,evidence:[{page,quote}]} with exact quotes from indexed pages.' },
    }, output,
    async execute(args, exec) {
      if (!/^[\da-f-]{36}$/i.test(args.paperId) || !/^[\da-f-]{36}$/i.test(args.artifactId) || typeof args.answerJson !== 'string' || args.answerJson.length > 120_000) throw new Error('Invalid answer request')
      const db = open()
      let transactionOpen = false
      try {
        db.exec('BEGIN IMMEDIATE')
        transactionOpen = true
        const target = db.prepare('SELECT paper_id,kind,status FROM paper_artifacts WHERE id=?').get(args.artifactId)
        if (!target || target.paper_id !== args.paperId || target.kind !== 'question-answer' || !['queued','running'].includes(target.status)) throw new Error('Answer does not belong to this active paper task')
        const draft = validateAnswer(JSON.parse(args.answerJson), (page) => {
          const row = db.prepare('SELECT text FROM paper_pages WHERE paper_id=? AND page_number=?').get(args.paperId, page)
          return row ? String(row.text) : null
        })
        const used = new Set(db.prepare('SELECT note_color FROM paper_reader_cards WHERE paper_id=? AND note_color IS NOT NULL').all(args.paperId).map((row) => String(row.note_color)))
        for (const row of db.prepare('SELECT answer_json FROM paper_artifacts WHERE paper_id=? AND answer_json IS NOT NULL').all(args.paperId)) {
          try { used.add(String(JSON.parse(String(row.answer_json)).color)) } catch { /* Ignore unreadable legacy metadata. */ }
        }
        const answer = { ...draft, color: pickAnswerColor(used) }
        const directory = path.join(config.artifactsRoot, args.paperId); fs.mkdirSync(directory, { recursive: true })
        const artifactPath = path.join(directory, `question-answer-${args.artifactId}.md`)
        fs.writeFileSync(artifactPath, `${answer.body}\n`, 'utf8')
        const sessionId = exec.agent?.session?.header?.id ? String(exec.agent.session.header.id) : null
        db.prepare("UPDATE paper_artifacts SET session_id=?,status='complete',progress=100,markdown_path=?,answer_json=?,error=NULL,updated_at=? WHERE id=?")
          .run(sessionId, artifactPath, JSON.stringify(answer), new Date().toISOString(), args.artifactId)
        db.exec('COMMIT')
        transactionOpen = false
        return { id: args.artifactId, status: 'complete', evidence: answer.evidence.length, color: answer.color }
      } catch (error) { if (transactionOpen) db.exec('ROLLBACK'); throw error }
      finally { db.close() }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'paper_save_artifact', description: 'Save a completed paper translation to the Singularity library. Paper Q&A must use paper_save_answer.',
    parameters: {
      paperId: { type: 'string', required: true }, artifactId: { type: 'string' }, kind: { type: 'string', required: true, enum: ['summary', 'translation', 'selection-translation'] },
      markdown: { type: 'string', required: true, description: 'Complete UTF-8 Markdown with [p.N] evidence anchors.' },
    }, output,
    async execute(args, exec) {
      if (args.kind === 'summary' && args.artifactId) throw new Error('Structured summaries must use paper_save_review')
      if (args.kind === 'question-answer') throw new Error('Paper answers must use paper_save_answer with verified quotes')
      if (args.markdown.length > 4_000_000) throw new Error('Artifact exceeds 4 MB')
      const db = open()
      try {
        if (!db.prepare('SELECT id FROM papers WHERE id=?').get(args.paperId)) throw new Error('Paper not found')
        if (args.artifactId) {
          const target = db.prepare('SELECT paper_id,kind FROM paper_artifacts WHERE id=?').get(args.artifactId)
          if (!target || target.paper_id !== args.paperId || target.kind !== args.kind) throw new Error('Artifact does not belong to this paper/task')
        }
        if (!/^[\da-f-]{36}$/i.test(args.paperId) || args.artifactId && !/^[\da-f-]{36}$/i.test(args.artifactId)) throw new Error('Invalid artifact identifier')
        if (!args.markdown.trim()) throw new Error('Empty artifact')
        const id = args.artifactId || crypto.randomUUID(); const directory = path.join(config.artifactsRoot, args.paperId); fs.mkdirSync(directory, { recursive: true })
        const artifactPath = path.join(directory, `${args.kind}-${id}.md`); fs.writeFileSync(artifactPath, `${args.markdown.trim()}\n`, 'utf8'); const now = new Date().toISOString()
        const sessionId = exec.agent?.session?.header?.id ? String(exec.agent.session.header.id) : null
        db.prepare(`INSERT INTO paper_artifacts (id,paper_id,session_id,kind,status,progress,markdown_path,error,created_at,updated_at) VALUES (?,?,?,?,'complete',100,?,NULL,?,?) ON CONFLICT(id) DO UPDATE SET status='complete', progress=100, markdown_path=excluded.markdown_path, error=NULL, updated_at=excluded.updated_at`).run(id, args.paperId, sessionId, args.kind, artifactPath, now, now)
        return { id, paperId: args.paperId, kind: args.kind, status: 'complete', markdownPath: artifactPath }
      } finally { db.close() }
    },
  }))
}
