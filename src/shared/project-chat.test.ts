import { describe, expect, it } from 'vitest'
import { fieldBriefBudget, fieldBriefText, projectFieldMessage, projectFieldReuseMessage } from './project-chat'

const longBody = (tag: string) => `${tag}：` + '这一段说明方法在什么数据上成立、证据到什么边界。'.repeat(20)

const field = (over: Partial<Parameters<typeof fieldBriefText>[0]> = {}) => ({
  title: '强化学习',
  paperCount: 7,
  documentVersion: 3,
  documentState: 'current' as const,
  documentPath: 'E:/SingularityData/artifacts/fields/abc/knowledge.md',
  reports: [{ overview: '这一轮梳理集中在样本效率与探索。' + '概览文字'.repeat(200) }],
  sections: Array.from({ length: 9 }, (_, i) => ({ title: `第 ${i + 1} 节`, body: longBody(`节${i + 1}`) })),
  papers: [] as Array<{ starred?: boolean; source: { title: string; date?: string } }>,
  ...over,
})

describe('fieldBriefText', () => {
  it('分层截取综述：状态行、梳理概览、八节开头与全文位置', () => {
    const brief = fieldBriefText(field())
    expect(brief.version).toBe(3)
    expect(brief.summary).toContain('综述 v3（已更新）· 收录 7 篇')
    expect(brief.summary).toContain('最近一次梳理：')
    expect(brief.summary).toContain('- 第 1 节：')
    expect(brief.summary).not.toContain('- 第 9 节：')
    expect(brief.summary).toContain('完整综述：E:/SingularityData/artifacts/fields/abc/knowledge.md')
  })

  it('每节只留开头，不再整段搬运', () => {
    const brief = fieldBriefText(field())
    const line = brief.summary.split('\n').find((item) => item.startsWith('- 第 1 节：'))!
    /* 标题 40 + 正文 120，再留一点断句与省略号。 */
    expect(line.length).toBeLessThan(40 + fieldBriefBudget.section + 6)
    expect(brief.summary).not.toContain('证据到什么边界。'.repeat(10))
  })

  it('正文总量受预算约束，明显短于原来的四千多字', () => {
    const brief = fieldBriefText(field())
    expect(brief.summary.length).toBeLessThanOrEqual(fieldBriefBudget.total)
  })

  it('论文名限量、星标优先，并跳过项目已关联的论文', () => {
    const papers: Array<{ starred?: boolean; source: { title: string; date?: string } }> = Array.from({ length: 14 }, (_, i) => ({ source: { title: `论文标题 ${i + 1}`, date: `2026-0${(i % 9) + 1}-01` } }))
    papers.push({ starred: true, source: { title: '强化学习：综述', date: '2018-01-01' } })
    const brief = fieldBriefText(field({ paperCount: 15, papers }), { excludeTitles: ['强化学习：综述'] })
    expect(brief.summary).toContain('已精读 15 篇（列 10 篇，其余略）：')
    expect(brief.summary).not.toContain('强化学习：综述')
    const listed = brief.summary.split('\n').filter((line) => line.startsWith('- 论文标题'))
    expect(listed).toHaveLength(10)
  })

  it('星标论文排在最前', () => {
    const brief = fieldBriefText(field({
      paperCount: 3,
      papers: [
        { source: { title: '普通论文', date: '2026-05-01' } },
        { starred: true, source: { title: '星标论文', date: '2020-01-01' } },
      ],
    }))
    const rows = brief.summary.split('\n').filter((line) => line.startsWith('- 普通论文') || line.startsWith('- 星标论文'))
    expect(rows[0]).toContain('星标论文')
    expect(rows[0]).toContain('★')
  })

  it('同一篇论文从两次检索进来时只列一次', () => {
    const brief = fieldBriefText(field({
      paperCount: 2,
      papers: [
        { source: { title: 'Reinforcement Learning with Action Chunking', date: '2025-06-01' } },
        { source: { title: 'Reinforcement Learning with Action  Chunking', date: '2025-06-02' } },
      ],
    }))
    const rows = brief.summary.split('\n').filter((line) => line.includes('Action'))
    expect(rows).toHaveLength(1)
  })

  it('没有综述也没有论文时给出明确说明', () => {
    const brief = fieldBriefText(field({ paperCount: 0, documentVersion: 0, documentState: 'draft', sections: [], reports: [], documentPath: undefined }))
    expect(brief.summary).toContain('综述 v0（尚未综述）· 收录 0 篇')
    expect(brief.paperCount).toBe(0)
    expect(brief.documentPath).toBe('')
  })
})

describe('领域上下文消息', () => {
  it('首次附加时带完整简报', () => {
    const brief = fieldBriefText(field())
    const message = projectFieldMessage(brief)
    expect(message).toContain('【领域上下文更新】')
    expect(message).toContain('领域：强化学习')
    expect(message).toContain('综述 v3')
  })

  it('沿用同一版本时只说一句，不重复正文', () => {
    const brief = fieldBriefText(field())
    const message = projectFieldReuseMessage(brief)
    expect(message).toContain('【领域上下文沿用】')
    expect(message).toContain('v3')
    expect(message).not.toContain('各节要点')
    expect(message).not.toContain('第 1 节')
    expect(message).toContain('knowledge.md')
  })
})
