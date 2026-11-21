// Optional live public-source integration check. No credentials or model requests.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createAppPaths } from '../src/main/paths'
import { PaperRepository } from '../src/main/paper-repository'
import { ResearchExplorer } from '../src/main/research-explorer'
import { searchArxiv } from '../src/main/research-candidates'
const output = path.resolve('.local-data', 'research-import-verification', String(Date.now()))
const paths = createAppPaths({ resourceRoot: process.cwd(), dataRoot: path.join(output, 'data') })
const papers = new PaperRepository(paths)
const report: { output: string; checks: string[]; errors: string[] } = { output, checks: [], errors: [] }
let service: ResearchExplorer | undefined
try {
  const candidates = await searchArxiv('anomaly detection', AbortSignal.timeout(60000))
  let source = candidates.find(s => s.arxivId && s.abstract.length > 100)!
  for (const candidate of candidates.filter(s => s.arxivId && s.abstract.length > 100).slice(0, 8)) {
    const response = await fetch(`https://arxiv.org/pdf/${candidate.arxivId}`, { method: 'HEAD', signal: AbortSignal.timeout(15000) })
    const size = Number(response.headers.get('content-length'))
    if (response.ok && size > 0 && size < 40_000_000) { source = candidate; break }
  }
  assert(source); source.roles = ['core']; source.topics = ['异常检测']
  service = new ResearchExplorer(paths, papers, async (_system, prompt) => {
    if (prompt.startsWith('为用户筛选')) return JSON.stringify({ ids: [source.id] })
    if (prompt.startsWith('以简体')) return JSON.stringify({ sourceId: source.id, summary: '集成验证的占位分析，不代表论文评价。', method: '仅验证下载流程。', datasets: '此验证不分析数据集。', evaluation: '此验证不分析基准。', contribution: 'uncertain', contributionReason: '仅验证程序流程。', risks: '未进行研究质量评估。', transfer: '不提供论文结论。', evidence: [{ claim: '摘要采集成功。', quote: source.abstract.slice(0, 120) }] })
    return JSON.stringify({ overview: '集成验证，不调用模型。', insights: ['推演占位，仅验证数据格式。', '推演占位，仅验证数据格式。'] })
  }, async () => ({ sources: [source], warnings: [] }), async s => { s.evidenceKind = 'abstract'; s.evidence = s.abstract })
  const run = service.start({ mode: 'recommend', topics: ['异常检测'], inspirations: [], count: 5, publicationYears: 2, preprintMonths: 6 })
  const started = Date.now()
  while (service.list()[0].status !== 'complete') { assert(Date.now() - started < 10000); assert.notEqual(service.list()[0].status, 'failed'); await new Promise(resolve => setTimeout(resolve, 50)) }
  const first = await service.import(run.id, source.id), again = await service.import(run.id, source.id)
  assert.equal(first.id, again.id); assert(first.pageCount > 0); assert(fs.existsSync(first.sourcePath)); assert(first.sourcePath.startsWith(paths.data))
  assert.equal((await papers.list()).length, 1); assert.equal(service.list()[0].items[0].libraryId, first.id)
  report.checks.push(`Public arXiv ${source.arxivId} downloaded, parsed (${first.pageCount} pages), copied into an isolated managed library, duplicate import reused the same paper, and recommendation import state persisted`)
} catch (error) { report.errors.push(String(error)); process.exitCode = 1 }
finally { await service?.close(); papers.close(); fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2)) }
