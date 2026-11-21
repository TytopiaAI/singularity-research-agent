import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createAppPaths } from '../src/main/paths'
import { ResearchExplorer, selectResearchSources, validateRecommendation } from '../src/main/research-explorer'
import { dateSlices, mergeCandidates, monthsAgo, parseArxivSearch, parsePublishedWorks, parseCrossrefWorks, preprintBuckets, withinRange, withinWindow } from '../src/main/research-candidates'
import { validateResearchRequest, type ResearchCandidate, type ResearchRequest } from '../src/shared/research-explorer'
import type { PaperRepository } from '../src/main/paper-repository'

const request: ResearchRequest = { mode: 'survey', topics: ['异常检测'], inspirations: ['LLM-based 异常检测'], count: 5, publicationYears: 2, preprintMonths: 6 }
const sentence = 'Our model evaluates held-out anomalies against independent baselines.'
const candidate = (n = 0): ResearchCandidate => ({ id: `arxiv:2609.1234${n}`, arxivId: `2609.1234${n}`, title: `Method ${n} for grounded anomalies`, authors: 'Researcher', abstract: sentence, evidence: sentence, evidenceKind: 'full-text', url: `https://arxiv.org/abs/2609.1234${n}`, venue: n < 2 ? 'CVPR' : 'arXiv 预印本', date: '2026-09-01', group: n < 2 ? 'published' : 'preprint', roles: n === 4 ? ['inspiration'] : ['core'], topics: ['异常检测'] })
const analysis = (s: ResearchCandidate) => ({ sourceId: s.id, summary: '通过独立基线评估异常检测模型。', method: '用模型评估留出的异常。', datasets: '摘要未提供数据集名称。', evaluation: '与独立基线比较，具体指标待核查。', contribution: 'substantive', contributionReason: '独立基线支持有界的贡献判断。', risks: '原文未明确报告泄漏排查，需核验划分。', transfer: '可测试对跨领域异常的迁移，属于推演。', evidence: [{ claim: '模型与独立基线比较。', quote: sentence }] })
const roots: string[] = [], services: ResearchExplorer[] = []
afterEach(async () => { await Promise.all(services.splice(0).map(s => s.close())); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
describe('source-grounded research exploration', () => {
  it('validates topic bounds and uses real rolling month windows', () => {
    expect(validateResearchRequest({ ...request, mode: 'recommend', count: 20 }).count).toBe(5)
    expect(() => validateResearchRequest({ ...request, topics: [] })).toThrow()
    expect(() => validateResearchRequest({ ...request, inspirations: Array(4).fill('topic') })).toThrow()
    expect(monthsAgo(1, new Date('2026-03-31T12:00:00Z'))).toBe('2026-02-28')
    expect(withinWindow('2026-10-10', 6, new Date('2026-10-09'))).toBe(false)
    expect(withinWindow('2026-04-08', 6, new Date('2026-10-09'))).toBe(false)
    expect(withinWindow('2026-10', 6, new Date('2026-10-09'))).toBe(false)
    expect(withinWindow('2026-06', 6, new Date('2026-10-09'))).toBe(true)
  })
  it('accepts wider presets and an explicit custom window', () => {
    expect(validateResearchRequest({ ...request, publicationYears: 10, preprintMonths: 60 }).publicationYears).toBe(10)
    expect(() => validateResearchRequest({ ...request, publicationYears: 4 })).toThrow()
    expect(() => validateResearchRequest({ ...request, preprintMonths: 30 })).toThrow()
    expect(validateResearchRequest({ ...request, dateFrom: '2026-10-01', dateTo: '2026-10-31' })).toMatchObject({ dateFrom: '2026-10-01', dateTo: '2026-10-31' })
    expect(() => validateResearchRequest({ ...request, dateFrom: '2026-10-31', dateTo: '2026-10-01' })).toThrow(/开始日期/)
    expect(() => validateResearchRequest({ ...request, dateFrom: '2026-10-01' })).toThrow(/完整的开始与结束日期/)
    expect(withinRange('2026-10-01', '2026-10-01', '2026-10-31')).toBe(true)
    expect(withinRange('2026-10-31', '2026-10-01', '2026-10-31')).toBe(true)
    expect(withinRange('2026-11-01', '2026-10-01', '2026-10-31')).toBe(false)
    expect(withinRange('2026-09-30', '2026-10-01', '2026-10-31')).toBe(false)
    expect(preprintBuckets(1)).toEqual([[1, 0]])
    expect(preprintBuckets(6)).toEqual([[6, 5], [5, 4], [4, 3], [3, 2], [2, 1], [1, 0]])
    expect(dateSlices('2026-10-01', '2026-10-31')).toEqual([['2026-10-01', '2026-10-31']])
    expect(dateSlices('2026-05-15', '2026-11-15').length).toBeGreaterThan(5)
    expect(preprintBuckets(24)).toEqual([[24, 18], [18, 12], [12, 6], [6, 0]])
    expect(preprintBuckets(60)).toHaveLength(10)
    expect(preprintBuckets(60)[0]).toEqual([60, 54])
  })
  it('starts a follow-up survey at the last completion and skips analysed papers', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'research-followup-')); roots.push(root)
    const paths = createAppPaths({ resourceRoot: root, dataRoot: path.join(root, 'data') })
    const papers = { databasePath: path.join(paths.database, 'test.sqlite'), list: async () => [] } as unknown as PaperRepository
    const sources = Array.from({ length: 5 }, (_, n) => candidate(n))
    const collect = vi.fn(async () => ({ sources, warnings: [] }))
    const reply = vi.fn(async (_system: string, prompt: string) => {
      if (prompt.startsWith('为用户筛选')) return JSON.stringify({ ids: sources.map(s => s.id) })
      if (prompt.includes('以简体中文分析')) return JSON.stringify(analysis(sources.find(s => prompt.includes(`"sourceId":"${s.id}"`))!))
      return JSON.stringify({ overview: '通过方法谱系比较评估边界。', bottlenecks: '评估划分和跨数据集比较仍是主要局限，泄漏排查多未报告。', insights: ['推演：比较跨领域异常的迁移。', '推演：验证独立划分的评估变化。'] })
    })
    const service = new ResearchExplorer(paths, papers, reply, collect, async () => {}); services.push(service)
    const field = service.fields.create('异常检测')
    service.start({ ...request, fieldId: field.id })
    await vi.waitFor(() => expect(service.list()[0].status).toBe('complete'))
    const saved = service.fields.get(field.id)
    expect(saved.papers).toHaveLength(5)
    expect(saved.lastSurveyAt).toBeTruthy()
    const from = saved.lastSurveyAt!.slice(0, 10)
    service.start({ ...request, fieldId: field.id, dateFrom: from, dateTo: new Date().toISOString().slice(0, 10) })
    await vi.waitFor(() => expect(service.list()[0].status).toBe('failed'))
    expect(service.list()[0].error).toMatch(/没有找到/)
    expect(collect).toHaveBeenCalledTimes(2)
  })
  it('does not promote title mentions, unverified venues or unofficial landing pages', () => {
    const record = { id: 'W1', title: 'A CVPR-style method', publication_date: '2026-06-01', primary_location: { is_published: true, source: { display_name: 'arXiv' }, landing_page_url: 'https://openaccess.thecvf.com/real.html' } }
    expect(parsePublishedWorks({ results: [record] })).toEqual([])
    expect(parsePublishedWorks({ results: [{ ...record, primary_location: { ...record.primary_location, source: { display_name: 'CVPR' } } }] })).toHaveLength(1)
    expect(parsePublishedWorks({ results: [{ ...record, primary_location: { ...record.primary_location, source: { display_name: 'CVPR' }, landing_page_url: 'https://unverified.example/paper' } }] })).toEqual([])
    expect(parseCrossrefWorks({ message: { items: [{ DOI: '10.1000/paper', title: ['Study'], type: 'journal-article', 'container-title': ['IEEE Transactions on Medical Imaging'], published: { 'date-parts': [[2026, 5, 1]] } }] } })).toHaveLength(1)
  })
  it('merges publication and preprint copies without losing topic or inspiration roles', () => {
    const first = candidate(), second = { ...first, id: 'doi:10.1000/test', arxivId: undefined, group: 'published' as const, roles: ['inspiration' as const], topics: ['其他领域'] }
    const merged = mergeCandidates([{ ...first, group: 'preprint' }, second])
    expect(merged).toHaveLength(1); expect(merged[0]).toMatchObject({ group: 'published', arxivId: first.arxivId })
    expect(merged[0].roles).toEqual(['core', 'inspiration'])
    expect(mergeCandidates([{ ...first, title: 'A'.repeat(80) + ' one' }, { ...second, title: 'A'.repeat(80) + ' two' }])).toHaveLength(2)
    expect(mergeCandidates([{ ...first, arxivId: '2609.12340v1' }, { ...first, id: 'arxiv:2609.12340v2', arxivId: '2609.12340v2', title: 'Revised title for the same work' }])).toHaveLength(1)
  })
  it('parses the arXiv fallback and rejects withdrawn papers', () => {
    const html = '<li class="arxiv-result"><a href="https://arxiv.org/abs/2609.12345">paper</a><p class="title is-5 mathjax">A &amp; B</p><span class="abstract-full has-text-grey-dark">Real abstract</span><span>Submitted</span> 1 September, 2026;</li>'
    expect(parseArxivSearch(html)[0]).toMatchObject({ title: 'A & B', group: 'preprint' })
    expect(parseArxivSearch(html.replace('Real abstract', 'withdrawn due to fundamental errors'))).toEqual([])
  })
  it('rejects invented papers and ungrounded quotes, and repairs a lopsided shortlist', () => {
    const sources = Array.from({ length: 6 }, (_, n) => candidate(n))
    expect(() => selectResearchSources(['invented'], sources, request)).toThrow()
    expect(selectResearchSources(sources.slice(1).map(s => s.id), sources, { ...request, inspirations: [] })).toHaveLength(5)
    // Model ranking only preprints used to abort the run; the shortlist is repaired instead.
    const repaired = selectResearchSources(sources.filter(s => s.group === 'preprint').map(s => s.id), sources, request)
    expect(repaired).toHaveLength(5)
    expect(repaired.some(s => s.group === 'published')).toBe(true)
    expect(validateRecommendation(analysis(sources[0]), sources[0]).contribution).toBe('substantive')
    expect(validateRecommendation(analysis(sources[0]), { ...sources[0], evidenceKind: 'abstract' }).contribution).toBe('uncertain')
    expect(() => validateRecommendation({ ...analysis(sources[0]), evidence: [{ claim: 'False', quote: 'This quote is fabricated and absent.' }] }, sources[0])).toThrow(/引句/)
    expect(validateRecommendation({ ...analysis(sources[0]), evidence: [{ claim: '模型与独立基线比较。', quote: 'Our model evaluates held-out anomalies, against independent baselines.' }] }, { ...sources[0], evidence: '', evidenceKind: 'abstract' }).evidence).toHaveLength(1)
  })
  it('accepts a quote that crosses one of our page markers', () => {
    const source = { ...candidate(0), evidence: '[p.4] Our model evaluates held-out anomalies [p.5] against independent baselines.' }
    expect(validateRecommendation(analysis(source), source).evidence).toHaveLength(1)
  })
  it('skips one unverifiable paper and still writes the survey from the rest', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'research-quote-')); roots.push(root)
    const paths = createAppPaths({ resourceRoot: root, dataRoot: path.join(root, 'data') })
    const papers = { databasePath: path.join(paths.database, 'test.sqlite'), list: async () => [] } as unknown as PaperRepository
    const sources = Array.from({ length: 5 }, (_, n) => candidate(n))
    const reply = vi.fn(async (_system: string, prompt: string) => {
      if (prompt.startsWith('为用户筛选')) return JSON.stringify({ ids: sources.map(s => s.id) })
      if (prompt.includes('以简体中文分析')) {
        const source = sources.find(s => prompt.includes(`"sourceId":"${s.id}"`))!
        if (source.id === sources[0].id) return JSON.stringify({ ...analysis(source), evidence: [{ claim: '不存在的论断内容。', quote: 'This quote is fabricated and absent.' }] })
        return JSON.stringify(analysis(source))
      }
      return JSON.stringify({ overview: '通过方法谱系比较评估边界。', bottlenecks: '评估划分和跨数据集比较仍是主要局限，泄漏排查多未报告。', insights: ['推演：比较跨领域异常的迁移。', '推演：验证独立划分的评估变化。'] })
    })
    const service = new ResearchExplorer(paths, papers, reply, async () => ({ sources, warnings: [] }), async () => {}); services.push(service)
    service.start(request)
    await vi.waitFor(() => expect(service.list()[0].status).toBe('complete'))
    const result = service.list()[0]
    expect(result.items).toHaveLength(4)
    expect(result.warnings.some(warning => warning.includes('已跳过'))).toBe(true)
    expect(result.overview).toMatch(/方法谱系/)
  })
  it('replaces unverifiable papers until the requested survey count is reached', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'research-backfill-')); roots.push(root)
    const paths = createAppPaths({ resourceRoot: root, dataRoot: path.join(root, 'data') })
    const papers = { databasePath: path.join(paths.database, 'test.sqlite'), list: async () => [] } as unknown as PaperRepository
    const sources = Array.from({ length: 8 }, (_, n) => candidate(n))
    const reply = vi.fn(async (_system: string, prompt: string) => {
      if (prompt.startsWith('为用户筛选')) return JSON.stringify({ ids: sources.slice(0, 5).map(s => s.id) })
      if (prompt.includes('以简体中文分析')) {
        const source = sources.find(s => prompt.includes(`"sourceId":"${s.id}"`))!
        if (source.id === sources[0].id || source.id === sources[1].id) return JSON.stringify({ ...analysis(source), evidence: [{ claim: '不存在的论断内容。', quote: 'This quote is fabricated and absent.' }] })
        return JSON.stringify(analysis(source))
      }
      return JSON.stringify({ overview: '通过方法谱系比较评估边界。', bottlenecks: '评估划分和跨数据集比较仍是主要局限，泄漏排查多未报告。', insights: ['推演：比较跨领域异常的迁移。', '推演：验证独立划分的评估变化。'] })
    })
    const service = new ResearchExplorer(paths, papers, reply, async () => ({ sources, warnings: [] }), async () => {}); services.push(service)
    service.start(request)
    await vi.waitFor(() => expect(service.list()[0].status).toBe('complete'))
    expect(service.list()[0].items).toHaveLength(5)
    expect(service.list()[0].warnings.filter(warning => warning.includes('已跳过'))).toHaveLength(2)
  })
  it('fills the requested count when the model ranks fewer papers than asked', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'research-shortlist-')); roots.push(root)
    const paths = createAppPaths({ resourceRoot: root, dataRoot: path.join(root, 'data') })
    const papers = { databasePath: path.join(paths.database, 'test.sqlite'), list: async () => [] } as unknown as PaperRepository
    const sources = Array.from({ length: 9 }, (_, n) => candidate(n))
    const reply = vi.fn(async (_system: string, prompt: string) => {
      // Two ids for a five-paper request used to invalidate the whole collection.
      if (prompt.startsWith('为用户筛选')) return JSON.stringify({ ids: sources.slice(0, 2).map(s => s.id) })
      if (prompt.includes('以简体中文分析')) return JSON.stringify(analysis(sources.find(s => prompt.includes(`"sourceId":"${s.id}"`))!))
      return JSON.stringify({ overview: '通过方法谱系比较评估边界。', bottlenecks: '评估划分和跨数据集比较仍是主要局限，泄漏排查多未报告。', insights: ['推演：比较跨领域异常的迁移。', '推演：验证独立划分的评估变化。'] })
    })
    const service = new ResearchExplorer(paths, papers, reply, async () => ({ sources, warnings: [] }), async () => {}); services.push(service)
    service.start(request)
    await vi.waitFor(() => expect(service.list()[0].status).toBe('complete'))
    const result = service.list()[0]
    expect(result.items).toHaveLength(5)
    expect(result.items.slice(0, 2).map(item => item.sourceId)).toEqual(sources.slice(0, 2).map(source => source.id))
    expect(result.warnings.some(warning => warning.includes('已跳过'))).toBe(false)
  })
  it('persists phased results and recovers completed research on reopening', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'research-explorer-')); roots.push(root)
    const paths = createAppPaths({ resourceRoot: root, dataRoot: path.join(root, 'data') })
    const papers = { databasePath: path.join(paths.database, 'test.sqlite'), list: async () => [] } as unknown as PaperRepository
    const sources = Array.from({ length: 5 }, (_, n) => candidate(n))
    const reply = vi.fn(async (_system: string, prompt: string) => {
      if (prompt.startsWith('为用户筛选')) return JSON.stringify({ ids: sources.map(s => s.id) })
      if (prompt.includes('以简体中文分析')) return JSON.stringify(analysis(sources.find(s => prompt.includes(`"sourceId":"${s.id}"`))!))
      return JSON.stringify({ overview: '通过方法谱系比较评估边界。', bottlenecks: '评估划分和跨数据集比较仍是主要局限，泄漏排查多未报告。', insights: ['推演：比较跨领域异常的迁移。', '推演：验证独立划分的评估变化。'] })
    })
    const service = new ResearchExplorer(paths, papers, reply, async () => ({ sources, warnings: [] }), async () => {}); services.push(service)
    const started = service.start(request)
    await vi.waitFor(() => expect(service.list()[0].status).toBe('complete'))
    const result = service.list()[0]; expect(result.items).toHaveLength(5); expect(result.insights).toHaveLength(2); expect(result.mentions?.length).toBeGreaterThan(0); expect(result.bottlenecks).toMatch(/局限/); expect(result.id).toBe(started.id); expect(service.fields.list()).toHaveLength(0)
    await service.close(); services.splice(services.indexOf(service), 1)
    const reopened = new ResearchExplorer(paths, papers, reply); services.push(reopened)
    expect(reopened.list()[0].items).toEqual(result.items)
  })
  it('cancels in-flight collection and allows another run after cleanup', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'research-cancel-')); roots.push(root)
    const paths = createAppPaths({ resourceRoot: root, dataRoot: path.join(root, 'data') })
    const papers = { databasePath: path.join(paths.database, 'test.sqlite'), list: async () => [] } as unknown as PaperRepository
    const collect = vi.fn((_r, _q, signal: AbortSignal) => new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })))
    const service = new ResearchExplorer(paths, papers, async () => '', collect); services.push(service)
    const run = service.start(request); expect(() => service.start(request)).toThrow(/已有/)
    service.cancel(run.id); await vi.waitFor(() => expect(service.list()[0].status).toBe('cancelled'))
    await new Promise(resolve => setTimeout(resolve, 0)); expect(() => service.start(request)).not.toThrow()
  })
  it('downloads only a source-bound arXiv PDF and persists import state', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'research-import-')); roots.push(root)
    const paths = createAppPaths({ resourceRoot: root, dataRoot: path.join(root, 'data') })
    const importer = vi.fn(async (file: string) => { expect(fs.readFileSync(file, 'utf8')).toContain('%PDF-'); return { id: 'local-paper' } })
    const papers = { databasePath: path.join(paths.database, 'test.sqlite'), list: async () => [], import: importer } as unknown as PaperRepository
    const source = candidate()
    const service = new ResearchExplorer(paths, papers, async (_s, prompt) => JSON.stringify(prompt.startsWith('为用户筛选') ? { ids: [source.id] } : prompt.startsWith('以简体') ? analysis(source) : { overview: '独立基线支持有界研究。', bottlenecks: '目前的局限是评估划分仍待独立核验。', insights: ['推演一。', '推演二。'] }), async () => ({ sources: [source], warnings: [] }), async () => {}); services.push(service)
    const run = service.start({ ...request, mode: 'recommend' }); await vi.waitFor(() => expect(service.list()[0].status).toBe('complete'))
    const network = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('%PDF-1.7\nTest fixture'))
    try {
      await expect(service.import(run.id, 'not-a-source')).rejects.toThrow('不存在')
      const [first, second] = await Promise.all([service.import(run.id, source.id), service.import(run.id, source.id)])
      expect(first.id).toBe(second.id); expect(importer).toHaveBeenCalledTimes(1)
      expect(network.mock.calls[0][0]).toBe('https://arxiv.org/pdf/2609.12340')
      expect(service.list()[0].items[0].libraryId).toBe('local-paper')
    } finally { network.mockRestore() }
  })
  it('removes a finished history entry but refuses a running one', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'research-remove-')); roots.push(root)
    const paths = createAppPaths({ resourceRoot: root, dataRoot: path.join(root, 'data') })
    const papers = { databasePath: path.join(paths.database, 'test.sqlite'), list: async () => [] } as unknown as PaperRepository
    const service = new ResearchExplorer(paths, papers, async () => '', async () => ({ sources: [], warnings: [] }), async () => {}); services.push(service)
    expect(() => service.remove('')).toThrow(/编号无效/)
    expect(() => service.remove('missing')).toThrow(/研究任务不存在/)
    const started = service.start({ ...request, topics: ['无匹配主题'] })
    expect(() => service.remove(started.id)).toThrow(/任务进行中/)
    await vi.waitFor(() => expect(service.list()[0]?.status).toBe('failed'))
    service.remove(started.id)
    expect(service.list().some(item => item.id === started.id)).toBe(false)
  })
  it('appends the new window to a finished survey without rewriting the old papers or conclusion', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'research-update-')); roots.push(root)
    const paths = createAppPaths({ resourceRoot: root, dataRoot: path.join(root, 'data') })
    const papers = { databasePath: path.join(paths.database, 'test.sqlite'), list: async () => [] } as unknown as PaperRepository
    const first = Array.from({ length: 5 }, (_, n) => candidate(n))
    const added = Array.from({ length: 5 }, (_, n) => ({ ...candidate(n), id: `arxiv:2610.5000${n}`, arxivId: `2610.5000${n}`, title: `Follow-up method ${n} for grounded anomalies`, date: '2026-10-05' }))
    const batches = [first, added]
    const collect = vi.fn(async () => ({ sources: batches.shift() ?? [], warnings: [] }))
    const all = [...first, ...added]
    const reply = vi.fn(async (_system: string, prompt: string) => {
      if (prompt.startsWith('为用户筛选')) return JSON.stringify({ ids: prompt.includes('追加新论文') ? added.map(s => s.id) : first.map(s => s.id) })
      if (prompt.includes('以简体中文分析')) return JSON.stringify(analysis(all.find(s => prompt.includes(`"sourceId":"${s.id}"`))!))
      return JSON.stringify({ overview: '通过方法谱系比较评估边界。', bottlenecks: '评估划分和跨数据集比较仍是主要局限，泄漏排查多未报告。', insights: ['推演：比较跨领域异常的迁移。', '推演：验证独立划分的评估变化。'] })
    })
    const service = new ResearchExplorer(paths, papers, reply, collect, async () => {}); services.push(service)
    const started = service.start(request)
    await vi.waitFor(() => expect(service.list()[0].status).toBe('complete'))
    const before = service.list()[0]
    expect(before.items).toHaveLength(5)
    expect(() => service.update(started.id, { dateTo: '2026-10-31', count: 5 })).toThrow(/完整的开始与结束日期/)
    expect(() => service.update(started.id, { dateFrom: '2026-10-31', dateTo: '2026-10-01', count: 5 })).toThrow(/开始日期/)
    expect(service.update(started.id, { dateFrom: '2026-10-01', dateTo: '2026-10-31', count: 5 }).status).toBe('collecting')
    await vi.waitFor(() => expect(service.list()[0].status).toBe('complete'))
    const after = service.list()[0]
    expect(after.items).toHaveLength(10)
    expect(after.items.slice(0, 5)).toEqual(before.items)
    expect(after.overview).toBe(before.overview)
    expect(after.progress).toContain('新增 5 篇')
    expect(after.warnings.some(warning => warning.includes('本次更新追加'))).toBe(true)
    expect(collect).toHaveBeenCalledTimes(2)
  })
})
