// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FieldMindMap } from './FieldMindMap'
import type { FieldKnowledge } from '../shared/field-knowledge'

let root: Root, host: HTMLDivElement

const source = (n: number) => ({ id: `s${n}`, title: `Reconstruction method ${n}`, authors: 'A', date: '2026-0' + (n + 1) + '-01', venue: 'CVPR', url: `https://arxiv.org/abs/2601.${n}`, group: 'published' as const, topics: ['异常检测'], roles: ['core' as const], abstract: 'A', evidenceKind: 'full-text' as const })
const paper = (n: number) => ({ id: `p${n}`, source: source(n), analysis: { sourceId: `s${n}`, summary: 's', method: 'm', datasets: 'd', evaluation: 'e', contribution: 'substantive' as const, contributionReason: 'c', risks: 'r', transfer: 't', evidence: [] }, directions: [n ? '知识嵌入' : '重建'], curated: false, origins: [], firstSeenAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' })
const field: FieldKnowledge = {
  id: 'field-1', title: '异常检测', paperCount: 2, directionCount: 2, revision: 3, updatedAt: '2026-10-01T00:00:00Z',
  documentVersion: 2, documentState: 'current', documentUpdatedAt: '2026-10-01T00:00:00Z', documentPath: '', documentMarkdown: '',
  synthesisCoverage: 2, error: null, notes: '', relations: [], lastSurveyAt: '2026-10-10T00:00:00Z',
  papers: [paper(0), paper(1)],
  sections: [
    { title: '过去的发展趋势', body: 'a', kind: 'development', sourceIds: ['p0'] },
    { title: '当前主线：重建与知识嵌入', body: 'b', kind: 'development', sourceIds: ['p0', 'p1'] },
    { title: '未来趋势与验证', body: 'c', kind: 'insight', sourceIds: ['p1'] },
  ],
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => { root.unmount() }); host.remove() })

describe('field review mind map', () => {
  it('lays out sections with their cited papers and reports selection', async () => {
    const select = vi.fn()
    await act(async () => { root.render(<FieldMindMap field={field} selected="" onSelect={select}/>) })
    expect(host.querySelectorAll('.field-mindmap-section')).toHaveLength(3)
    const papers = host.querySelectorAll<HTMLButtonElement>('.field-mindmap-paper')
    expect(papers).toHaveLength(4)
    expect(host.querySelector('.field-mindmap-root')?.textContent).toContain('异常检测')
    await act(async () => { papers[0].click() })
    expect(select).toHaveBeenCalledWith('p0')
  })
  it('collapses a branch and hides its papers', async () => {
    await act(async () => { root.render(<FieldMindMap field={field} selected="" onSelect={() => {}}/>) })
    const sections = host.querySelectorAll<HTMLButtonElement>('.field-mindmap-section')
    await act(async () => { sections[1].click() })
    expect(sections[1].getAttribute('aria-expanded')).toBe('false')
    expect(host.querySelectorAll('.field-mindmap-paper')).toHaveLength(2)
    await act(async () => { host.querySelector<HTMLButtonElement>('.field-mindmap-toolbar button')!.click() })
    expect(host.querySelectorAll('.field-mindmap-paper')).toHaveLength(0)
  })
  it('explains the empty state before a review exists', async () => {
    await act(async () => { root.render(<FieldMindMap field={{ ...field, sections: [] }} selected="" onSelect={() => {}}/>) })
    expect(host.textContent).toContain('还没有骨架')
    expect(host.querySelector('.field-mindmap-board')).toBeNull()
  })
})
