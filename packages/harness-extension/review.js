export const reviewSections = [
  ['problem', '核心问题'], ['innovation', '关键贡献'], ['method', '方法架构'],
  ['dataset', '数据集分析'], ['setup', '实验设置'], ['results', '结果与消融'],
  ['explanation', '直观理解'], ['context', '学术脉络'], ['future', '未来想象力'],
  ['concepts', '关键概念'], ['action', '行动建议'],
]

const normalize = (value) => value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase()

export function validateReview(raw, readPage) {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.sections) || raw.sections.length !== reviewSections.length) throw new Error('总结必须包含 11 个小节')
  const sections = raw.sections.map((item, index) => {
    const [key] = reviewSections[index]
    if (item?.key !== key || typeof item.body !== 'string' || !item.body.trim() || item.body.length > 8000) throw new Error(`小节 ${key} 无效`)
    if (!Array.isArray(item.evidence) || item.evidence.length > 4) throw new Error(`小节 ${key} 的依据无效`)
    const evidence = item.evidence.map((entry) => {
      if (!Number.isInteger(entry?.page) || typeof entry.quote !== 'string' || entry.quote.trim().length < 12 || entry.quote.length > 500) throw new Error(`小节 ${key} 的页码或引文无效`)
      const pageText = readPage(entry.page)
      if (!pageText || !normalize(pageText).includes(normalize(entry.quote))) throw new Error(`第 ${entry.page} 页找不到引文：${entry.quote.slice(0, 60)}`)
      return { page: entry.page, quote: entry.quote.trim() }
    })
    if (item.nature !== undefined && !['fact', 'inference'].includes(item.nature)) throw new Error(`小节 ${key} 的内容性质无效`)
    return { key, body: item.body.trim(), evidence, nature: item.nature ?? (['future','action','explanation','concepts'].includes(key) ? 'inference' : 'fact') }
  })
  return { version: 1, sections }
}

export function reviewToMarkdown(review) {
  return ['# 论文深度解读', ...review.sections.map((section, index) => {
    const citations = section.evidence.map((item) => `> [p.${item.page}] ${item.quote}`).join('\n')
    const nature = section.nature ?? (['future','action','explanation','concepts'].includes(section.key) ? 'inference' : 'fact')
    return `## ${index + 1}. ${reviewSections[index][1]} · ${nature === 'fact' ? '论文事实' : '研究推演（待验证）'}\n\n${section.body}${citations ? `\n\n${citations}` : ''}`
  })].join('\n\n') + '\n'
}

export function validateAnswer(raw, readPage) {
  if (!raw || raw.version !== 1 || typeof raw.body !== 'string' || !raw.body.trim() || raw.body.length > 50_000 ||
      !Array.isArray(raw.evidence) || raw.evidence.length > 8) throw new Error('论文回答结构无效')
  const evidence = raw.evidence.map((entry) => {
    if (!Number.isInteger(entry?.page) || typeof entry.quote !== 'string' || entry.quote.trim().length < 12 || entry.quote.length > 500) throw new Error('回答引文无效')
    const pageText = readPage(entry.page)
    if (!pageText || !normalize(pageText).includes(normalize(entry.quote))) throw new Error(`第 ${entry.page} 页找不到回答引文`)
    return { page: entry.page, quote: entry.quote.trim() }
  })
  const citedPages = [...raw.body.matchAll(/\[p\.(\d+)\]/g)].map((match) => Number(match[1]))
  if (citedPages.some((page) => !evidence.some((item) => item.page === page))) throw new Error('回答页码缺少可核验引文')
  return { version: 1, body: raw.body.trim(), evidence }
}
