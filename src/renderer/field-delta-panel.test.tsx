// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FieldKnowledgePanel } from './FieldKnowledgePanel'
import type { FieldKnowledge, FieldDeltaReport } from '../shared/field-knowledge'

let root: Root, host: HTMLDivElement
const runId = 'run-delta-1'
const source = (n: number) => ({ id: `s${n}`, title: `New method ${n}`, authors: 'A', date: '2026-11-1' + n + 'T00:00:00Z', venue: 'arXiv 预印本', url: `https://arxiv.org/abs/2611.${n}`, group: 'preprint' as const, topics: ['异常检测'], roles: ['core' as const], abstract: 'A', evidenceKind: 'full-text' as const })
const paper = (n: number) => ({ id: `p${n}`, source: source(n), analysis: { sourceId: `s${n}`, summary: 's', method: 'm', datasets: 'd', evaluation: 'e', contribution: 'substantive' as const, contributionReason: 'c', risks: 'r', transfer: 't', evidence: [] }, directions: ['重建'], curated: false, origins: [{ runId, sourceId: `s${n}` }], firstSeenAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z' })
const delta: FieldDeltaReport = {
  id: 'delta-1', runId, createdAt: '2026-11-14T09:00:00.000Z', dateFrom: '2026-10-10', dateTo: '2026-11-14',
  baselineAt: '2026-10-10T00:00:00.000Z', baselineVersion: 2,
  summary: '上次关于独立基线的结论仍成立，但适用范围被扩展。',
  shifts: ['原来只考虑独立基线，现在补上了跨数据集条件。'],
  action: '建议更新综述的评估一节。',
  items: [
    { sourceId: 's0', title: 'New method 0', verdict: 'supports', claim: '独立基线仍是评估边界的关键', section: '评估比较', reason: '新论文复现了独立基线结论。', quote: 'Our model evaluates held-out anomalies against independent baselines.', evidenceKind: 'full-text' },
    { sourceId: 's1', title: 'New method 1', verdict: 'unverified', claim: '跨数据集泛化尚无定论', section: '未来趋势', reason: '仅有摘要，无法核验。', quote: '', evidenceKind: 'abstract' },
  ],
  warnings: ['New method 1：仅有摘要或缺少可核验原句，不能判定为「推翻」，已降为「证据不足」。'],
}
const field: FieldKnowledge = {
  id: 'field-1', title: '异常检测', paperCount: 2, directionCount: 1, revision: 4, updatedAt: '2026-11-14T09:00:00Z',
  documentVersion: 3, documentState: 'current', documentUpdatedAt: '2026-11-14T09:00:00Z', documentPath: '', documentMarkdown: '',
  synthesisCoverage: 2, error: null, notes: '', relations: [], lastSurveyAt: '2026-10-10T00:00:00.000Z',
  papers: [paper(0), paper(1)], deltas: [delta],
  sections: [{ title: '评估比较', body: '独立基线仍是评估边界的关键。', kind: 'evaluation', sourceIds: ['p0'] }],
}
const summary = { id: field.id, title: field.title, paperCount: 2, directionCount: 1, revision: 4, updatedAt: field.updatedAt, documentVersion: 3, documentState: 'current' as const, lastSurveyAt: field.lastSurveyAt }

async function render(value: FieldKnowledge = field) {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true })
  Object.defineProperty(window, 'singularity', { configurable: true, value: { research: {
    explorations: vi.fn().mockResolvedValue([]), fields: vi.fn().mockResolvedValue([summary]),
    field: vi.fn().mockResolvedValue(value),
    setFieldMonthly: vi.fn(), starFieldPaper: vi.fn(), saveFieldNotes: vi.fn(), setFieldDirections: vi.fn(),
    addFieldRelation: vi.fn(), removeFieldRelation: vi.fn(), updateFieldDocument: vi.fn(), importFieldPaper: vi.fn(),
    cancelExploration: vi.fn(), openSource: vi.fn(),
  } } })
  const onSearch = vi.fn()
  await act(async () => { root.render(<FieldKnowledgePanel initialId="field-1" onBack={() => {}} onSearch={onSearch}/>) })
  return onSearch
}
const click = async (selector: string) => act(async () => { host.querySelector<HTMLElement>(selector)!.click() })

beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => { root.unmount() }); host.remove() })

describe('field delta follow-up panel', () => {
  it('passes delta:true and the last survey window when starting a follow-up', async () => {
    const onSearch = await render()
    await click('button[aria-label^="Delta 跟进："]')
    expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ id: 'field-1' }), expect.objectContaining({
      delta: true, dateFrom: '2026-10-10', dateTo: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }))
  })
  it('shows verdicts, conclusion changes, verbatim evidence and warnings', async () => {
    await render()
    await click('button[aria-label="Delta 跟进"]')
    const text = host.textContent ?? ''
    expect(text).toContain('支持 1')
    expect(text).toContain('证据不足 1')
    expect(text).toContain('上次关于独立基线的结论仍成立')
    expect(text).toContain('影响的结论')
    expect(text).toContain('Our model evaluates held-out anomalies against independent baselines.')
    expect(text).toContain('不能判定为「推翻」')
    expect(host.querySelectorAll('.field-delta-item')).toHaveLength(2)
    expect(host.querySelectorAll('.field-delta-item .field-document-citations button')).toHaveLength(2)
  })
  it('explains the empty state before the first delta follow-up', async () => {
    await render({ ...field, deltas: [] })
    await click('button[aria-label="Delta 跟进"]')
    expect(host.textContent).toContain('还没有 Delta 跟进')
    expect(host.querySelectorAll('.field-delta-item')).toHaveLength(0)
  })
})
