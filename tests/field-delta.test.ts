import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createAppPaths } from '../src/main/paths'
import { ResearchExplorer } from '../src/main/research-explorer'
import { buildDeltaMaterial, deltaPrompt, hasDeltaBaseline, validateDelta } from '../src/main/field-delta'
import { validateResearchRequest, type ResearchCandidate, type ResearchRequest, type ResearchRun } from '../src/shared/research-explorer'
import type { FieldDeltaBaseline } from '../src/shared/field-knowledge'
import type { PaperRepository } from '../src/main/paper-repository'

const sentence = 'Our model evaluates held-out anomalies against independent baselines.'
const request: ResearchRequest = { mode: 'survey', topics: ['anomaly detection'], inspirations: [], count: 5, publicationYears: 2, preprintMonths: 6 }
const candidate = (n: number, evidenceKind: 'full-text' | 'abstract' = 'full-text'): ResearchCandidate => ({
  id: `arxiv:2609.1234${n}`, arxivId: `2609.1234${n}`, title: `Method ${n} for grounded anomalies`, authors: 'Researcher',
  abstract: sentence, evidence: sentence, evidenceKind, url: `https://arxiv.org/abs/2609.1234${n}`,
  venue: n < 2 ? 'CVPR' : 'arXiv 预印本', date: '2026-09-01', group: n < 2 ? 'published' : 'preprint',
  roles: ['core'], topics: ['anomaly detection'],
})
const analysis = (source: ResearchCandidate) => ({
  sourceId: source.id, summary: '通过独立基线评估异常检测模型。', method: '用模型评估留出的异常。',
  datasets: '摘要未提供数据集名称。', evaluation: '与独立基线比较，具体指标待核查。',
  contribution: 'substantive', contributionReason: '独立基线支持有界的贡献判断。',
  risks: '原文未明确报告泄漏排查，需核验划分。', transfer: '可测试对跨领域异常的迁移，属于推演。',
  evidence: [{ claim: '模型与独立基线比较。', quote: sentence }],
})
const sources = [candidate(2), candidate(3)]
const run: ResearchRun = {
  id: 'run-delta-1', createdAt: '2026-11-14T10:00:00.000Z', request: { ...request, dateFrom: '2026-11-01', dateTo: '2026-11-14' },
  status: 'complete', progress: '已完成', sources, items: sources.map(analysis),
  overview: '上次结论：独立基线是评估边界的关键。', insights: [], warnings: [],
}
const baseline: FieldDeltaBaseline = {
  capturedAt: '2026-11-01T10:00:00.000Z', documentVersion: 3,
  sections: [{ title: '评估比较', kind: 'evaluation', body: '独立基线仍是评估异常检测边界的关键。' }],
  survey: { createdAt: '2026-11-01T09:00:00.000Z', overview: '独立基线是主要结论。', insights: ['建议补跨数据集验证。'], bottlenecks: '泄漏排查多未报告。' },
}
const deltaResponse = (items: unknown[]) => ({
  summary: '新论文整体支持上次关于独立基线的结论，同时补上了跨数据集的适用条件。',
  shifts: ['原来只考虑独立基线，现在有跨数据集验证的线索。'],
  action: '建议更新综述的评估一节，并补一组跨数据集对照实验。',
  items,
})
const item = (sourceId: string, verdict: string, quote = sentence) => ({
  sourceId, verdict, claim: '独立基线仍是评估边界的关键', section: '评估比较',
  reason: '新论文使用独立基线报告了结果。', quote,
})

describe('delta follow-up judgement', () => {
  it('requires a field before delta can be requested', () => {
    expect(validateResearchRequest({ ...request, delta: true }).delta).toBeUndefined()
    expect(validateResearchRequest({ ...request, delta: true, fieldId: 'field-1' }).delta).toBe(true)
  })
  it('recognises a usable conclusion snapshot', () => {
    expect(hasDeltaBaseline(undefined)).toBe(false)
    expect(hasDeltaBaseline({ capturedAt: 'x', documentVersion: 0, sections: [] })).toBe(false)
    expect(hasDeltaBaseline(baseline)).toBe(true)
  })
  it('validates a grounded verdict for every new paper', () => {
    const report = validateDelta(deltaResponse([item(sources[0].id, 'supports'), item(sources[1].id, 'refutes')]), run, baseline)
    expect(report.items.map(i => i.verdict)).toEqual(['supports', 'refutes'])
    expect(report.items[1].quote).toBe(sentence)
    expect(report.summary).toContain('独立基线')
    expect(report.baselineVersion).toBe(3)
    expect(report.dateFrom).toBe('2026-11-01')
    expect(report.warnings).toEqual([])
  })
  it('downgrades a refutation when the paper only has an abstract', () => {
    const abstractOnly: ResearchRun = { ...run, sources: [candidate(2, 'abstract'), sources[1]] }
    const report = validateDelta(deltaResponse([item(sources[0].id, 'refutes'), item(sources[1].id, 'supports')]), abstractOnly, baseline)
    expect(report.items[0].verdict).toBe('unverified')
    expect(report.warnings.join(' ')).toMatch(/仅有摘要|不能判定为「推翻」/)
  })
  it('drops an invented quote and refuses an unsupported refutation', () => {
    const report = validateDelta(deltaResponse([item(sources[0].id, 'supports', 'This sentence was never collected.'), item(sources[1].id, 'refutes', 'Also invented.')]), run, baseline)
    expect(report.items.every(i => i.quote === '')).toBe(true)
    expect(report.items.map(i => i.verdict)).toEqual(['supports', 'unverified'])
    expect(report.warnings).toHaveLength(3)
  })
  it('rejects missing, duplicate or extra papers', () => {
    expect(() => validateDelta(deltaResponse([item(sources[0].id, 'supports')]), run, baseline)).toThrow(/逐篇覆盖/)
    expect(() => validateDelta(deltaResponse([item(sources[0].id, 'supports'), item(sources[0].id, 'extends')]), run, baseline)).toThrow(/重复或遗漏/)
    expect(() => validateDelta({ ...deltaResponse([]), summary: '' }, run, baseline)).toThrow(/无效文本/)
  })
  it('bounds the evidence sent to the model and names the previous conclusion', () => {
    const long = { ...sources[0], evidence: 'x'.repeat(9000) }
    const material = buildDeltaMaterial({ ...run, sources: [long, sources[1]] })
    expect(material).toHaveLength(2)
    expect(material[0].excerpt).toHaveLength(2400)
    expect(material[0].evidence[0].quote).toBe(sentence)
    const prompt = deltaPrompt(baseline, material, run.request)
    expect(prompt).toContain('独立基线仍是评估异常检测边界的关键。')
    expect(prompt).toContain(sources[0].id)
    expect(prompt).toContain(sources[1].id)
    expect(prompt).toContain('refutes 必须有原文明确结果支持')
  })
})

const roots: string[] = [], services: ResearchExplorer[] = []
afterEach(async () => { await Promise.all(services.splice(0).map(s => s.close())); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

describe('delta follow-up run', () => {
  it('snapshots the prior conclusion, judges new papers and stores a report without failing the run', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'field-delta-')); roots.push(root)
    const paths = createAppPaths({ resourceRoot: root, dataRoot: path.join(root, 'data') })
    const papers = { databasePath: path.join(paths.database, 'test.sqlite'), list: async () => [] } as unknown as PaperRepository
    const first = [candidate(0), candidate(4)], second = sources
    const collect = vi.fn()
      .mockResolvedValueOnce({ sources: first, warnings: [] })
      .mockResolvedValueOnce({ sources: second, warnings: [] })
    const reply = vi.fn(async (_system: string, prompt: string) => {
      if (prompt.startsWith('将下列每个研究主题')) return JSON.stringify({ queries: ['anomaly detection'] })
      if (prompt.startsWith('为用户筛选')) return JSON.stringify({ ids: (prompt.includes('Method 0') ? first : second).map(s => s.id) })
      if (prompt.includes('以简体中文')) {
        const source = [...first, ...second].find(s => prompt.includes(`"sourceId":"${s.id}"`))!
        return JSON.stringify(analysis(source))
      }
      if (prompt.startsWith('对比「上次领域结论」')) return JSON.stringify(deltaResponse([
        item(second[0].id, 'supports'), item(second[1].id, 'refutes', 'This quote never appeared.'),
      ]))
      if (prompt.startsWith('为领域知识库生成综合综述')) {
        const ids = [...prompt.matchAll(/"id":"([^"]+)"/g)].map(m => m[1]).slice(0, 8)
        const kinds = ['development', 'development', 'development', 'development', 'evaluation', 'insight', 'insight', 'insight']
        return JSON.stringify({ sections: kinds.map((kind, i) => ({ title: `第 ${i + 1} 节`, kind, body: '基于已收录论文的综合结论。', sourceIds: [ids[i % Math.max(ids.length, 1)]].filter(Boolean) })) })
      }
      return JSON.stringify({ overview: '独立基线仍是评估边界的关键。', bottlenecks: '跨数据集比较与泄漏排查仍是主要局限，部分细节待核验。', insights: ['推演：验证跨数据集迁移。', '推演：补独立划分的评估变化。'] })
    })
    const service = new ResearchExplorer(paths, papers, reply, collect, async () => {}); services.push(service)
    const field = service.fields.create('异常检测')
    service.start({ ...request, fieldId: field.id })
    await vi.waitFor(() => expect(service.list()[0].status).toBe('complete'))
    await vi.waitFor(() => expect(service.fields.get(field.id).sections.length).toBe(8))
    const conclusionBefore = service.fields.get(field.id).sections.map(s => s.body).join('')
    service.start({ ...request, fieldId: field.id, delta: true, dateFrom: '2026-11-01', dateTo: '2026-11-14' })
    await vi.waitFor(() => expect(service.fields.get(field.id).deltas?.length).toBe(1))
    const saved = service.fields.get(field.id), delta = saved.deltas![0]
    expect(delta.items.map(i => i.verdict)).toEqual(['supports', 'unverified'])
    expect(delta.items.map(i => i.title)).toEqual(second.map(s => s.title))
    expect(delta.warnings.join(' ')).toContain('引句无法在采集的原文中核验')
    expect(delta.baselineVersion).toBeGreaterThan(0)
    expect(delta.baselineAt).toBeTruthy()
    expect(saved.documentMarkdown).toContain('Delta 跟进（新论文与上次结论的对比）')
    expect(saved.documentMarkdown).toContain('影响的结论：独立基线仍是评估边界的关键（评估比较）')
    expect(conclusionBefore.length).toBeGreaterThan(0)
    await vi.waitFor(() => expect(service.list()[0].progress).toContain('Delta 对比已生成'))
    expect(service.list()[0].status).toBe('complete')
    expect(service.list()[0].warnings.join(' ')).not.toContain('Delta 对比未完成')
  })
  it('keeps a successful follow-up even when the delta model call fails', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'field-delta-fail-')); roots.push(root)
    const paths = createAppPaths({ resourceRoot: root, dataRoot: path.join(root, 'data') })
    const papers = { databasePath: path.join(paths.database, 'test.sqlite'), list: async () => [] } as unknown as PaperRepository
    const first = [candidate(0), candidate(4)], second = sources
    const collect = vi.fn()
      .mockResolvedValueOnce({ sources: first, warnings: [] })
      .mockResolvedValueOnce({ sources: second, warnings: [] })
    const reply = vi.fn(async (_system: string, prompt: string) => {
      if (prompt.startsWith('将下列每个研究主题')) return JSON.stringify({ queries: ['anomaly detection'] })
      if (prompt.startsWith('为用户筛选')) return JSON.stringify({ ids: (prompt.includes('Method 0') ? first : second).map(s => s.id) })
      if (prompt.includes('以简体中文')) {
        const source = [...first, ...second].find(s => prompt.includes(`"sourceId":"${s.id}"`))!
        return JSON.stringify(analysis(source))
      }
      if (prompt.startsWith('对比「上次领域结论」')) return 'not json'
      if (prompt.startsWith('为领域知识库生成综合综述')) {
        const ids = [...prompt.matchAll(/"id":"([^"]+)"/g)].map(m => m[1]).slice(0, 8)
        const kinds = ['development', 'development', 'development', 'development', 'evaluation', 'insight', 'insight', 'insight']
        return JSON.stringify({ sections: kinds.map((kind, i) => ({ title: `第 ${i + 1} 节`, kind, body: '基于已收录论文的综合结论。', sourceIds: [ids[i % Math.max(ids.length, 1)]].filter(Boolean) })) })
      }
      return JSON.stringify({ overview: '独立基线仍是评估边界的关键。', bottlenecks: '跨数据集比较与泄漏排查仍是主要局限，细节待核验。', insights: ['推演：验证迁移。', '推演：补评估变化。'] })
    })
    const service = new ResearchExplorer(paths, papers, reply, collect, async () => {}); services.push(service)
    const field = service.fields.create('异常检测')
    service.start({ ...request, fieldId: field.id })
    await vi.waitFor(() => expect(service.list()[0].status).toBe('complete'))
    service.start({ ...request, fieldId: field.id, delta: true, dateFrom: '2026-11-01', dateTo: '2026-11-14' })
    await vi.waitFor(() => expect(service.list()[0].status).toBe('complete'))
    await vi.waitFor(() => expect(service.list()[0].warnings.some(w => w.includes('Delta 对比未完成'))).toBe(true))
    expect(service.fields.get(field.id).papers).toHaveLength(4)
    expect(service.fields.get(field.id).deltas).toEqual([])
  })
})
