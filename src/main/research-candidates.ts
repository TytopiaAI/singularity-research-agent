import { DOMParser } from '@xmldom/xmldom'
import { setTimeout as delay } from 'node:timers/promises'
import { boundedFetch, parseFeed, sourceKey } from './digest-sources'
import type { ResearchCandidate, ResearchRequest } from '../shared/research-explorer'

const decoder = new TextDecoder()
export const arxivPattern = /^(?:\d{4}\.\d{4,5}|[a-z-]+\/\d{7})(?:v\d+)?$/
export const topicQueries: Record<string, string> = {
  '多模态医疗推理': 'multimodal medical reasoning', '图像—报告一致性验证': 'medical image report consistency',
  '异常检测': 'anomaly detection', '统一理解与生成': 'unified multimodal understanding generation',
  '基于重建的异常检测': 'reconstruction anomaly detection', 'LLM-based 异常检测': 'large language model anomaly detection',
  '大语言模型': 'large language models', '强化学习': 'reinforcement learning', 'LLM 智能体': 'LLM agents',
  '视觉语言模型': 'vision language models', '表征学习': 'representation learning', '扩散模型': 'diffusion models',
}
const topVenue = /\b(CVPR|ICCV|ECCV|NeurIPS|ICML|ICLR|ACL|EMNLP|MICCAI|AAAI|IJCAI)\b|computer vision and pattern recognition|neural information processing systems|international conference on machine learning|learning representations|medical image computing|association for computational linguistics|pattern analysis and machine intelligence|medical imaging|^medical image analysis$|^nature(?:\s+(?:communications|medicine|machine intelligence|methods|biomedical engineering))?$|^science(?:\s+(?:advances|robotics|translational medicine))?$/i
const publisherHosts = new Set(['openaccess.thecvf.com', 'proceedings.neurips.cc', 'proceedings.mlr.press', 'openreview.net', 'aclanthology.org', 'ieeexplore.ieee.org', 'link.springer.com', 'www.nature.com', 'www.science.org', 'www.sciencedirect.com', 'dl.acm.org', 'ojs.aaai.org', 'www.ijcai.org'])
export function monthsAgo(months: number, now = new Date()): string {
  const result = new Date(now); result.setUTCDate(1); result.setUTCMonth(result.getUTCMonth() - months)
  const last = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()
  result.setUTCDate(Math.min(now.getUTCDate(), last)); return result.toISOString().slice(0, 10)
}
export function withinWindow(date: string, months: number, now = new Date()): boolean {
  const time = Date.parse(date)
  let end = time
  if (/^\d{4}-\d{2}$/.test(date)) end = Date.UTC(Number(date.slice(0,4)), Number(date.slice(5,7)), 1) - 1
  else if (/^\d{4}$/.test(date)) end = Date.UTC(Number(date) + 1, 0, 1) - 1
  return Number.isFinite(time) && time >= Date.parse(monthsAgo(months, now)) && end <= now.getTime()
}
/** Inclusive explicit window check; `to` counts as a full day. */
export function withinRange(date: string, from: string, to: string): boolean {
  const time = Date.parse(date)
  let end = time
  if (/^\d{4}-\d{2}$/.test(date)) end = Date.UTC(Number(date.slice(0,4)), Number(date.slice(5,7)), 1) - 1
  else if (/^\d{4}$/.test(date)) end = Date.UTC(Number(date) + 1, 0, 1) - 1
  return Number.isFinite(time) && time >= Date.parse(from) && end <= Date.parse(to) + 86_399_000
}
/** Short windows are split by month so a broad topic is not reduced to the newest page. */
export function preprintBuckets(months: number): [number, number][] {
  const width = months <= 12 ? 1 : 6
  if (months <= width) return [[months, 0]]
  const buckets: [number, number][] = []
  for (let to = 0; to < months; to += width) buckets.push([Math.min(months, to + width), to])
  return buckets.reverse()
}
function shiftMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const result = new Date(Date.UTC(year, month - 1 + months, 1))
  const last = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()
  result.setUTCDate(Math.min(day, last))
  return result.toISOString().slice(0, 10)
}
function shiftDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}
/** Split an explicit window the same way: one slice under 45 days, monthly through about a year, then six-month slices. */
export function dateSlices(from: string, to: string): [string, string][] {
  if (from > to) return []
  const spanDays = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)
  if (spanDays <= 45) return [[from, to]]
  const width = spanDays <= 400 ? 1 : 6
  const slices: [string, string][] = []
  let cursor = from
  while (cursor <= to && slices.length < 24) {
    const end = shiftDays(shiftMonths(cursor, width), -1)
    const bounded = end < cursor ? cursor : end > to ? to : end
    slices.push([cursor, bounded])
    const next = shiftDays(bounded, 1)
    if (next <= cursor) break
    cursor = next
  }
  return slices
}
function cleanHtml(value: string): string {
  return new DOMParser().parseFromString(`<x>${value.replace(/<[^>]*>/g, ' ').replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/gi, '&amp;')}</x>`, 'text/xml').documentElement.textContent?.replace(/\s+/g, ' ').trim() ?? ''
}
export function parseArxivSearch(html: string): ResearchCandidate[] {
  return [...html.matchAll(/<li class="arxiv-result">([\s\S]*?)<\/li>/g)].flatMap(match => {
    const block = match[1], id = /arxiv\.org\/abs\/(\d{4}\.\d{4,5}(?:v\d+)?)/.exec(block)?.[1]
    const title = cleanHtml(/<p class="title[^\"]*">([\s\S]*?)<\/p>/.exec(block)?.[1] ?? '')
    const abstract = cleanHtml(/<span class="abstract-full[^\"]*"[^>]*>([\s\S]*?)<\/span>/.exec(block)?.[1] ?? '')
    const submitted = /Submitted<\/span>\s*([^;<]+)[;<]/.exec(block)?.[1]?.trim() ?? ''
    if (!id || !title || !Number.isFinite(Date.parse(submitted)) || /withdrawn|fundamental errors|do not cite/i.test(block)) return []
    return [{ id: `arxiv:${id.replace(/v\d+$/, '')}`, arxivId: id, title, abstract, authors: cleanHtml(/<p class="authors">([\s\S]*?)<\/p>/.exec(block)?.[1] ?? '').replace(/^Authors:\s*/, ''), date: new Date(submitted).toISOString(), venue: 'arXiv 预印本', url: `https://arxiv.org/abs/${id}`, group: 'preprint' as const, roles: [], topics: [] }]
  })
}
export const arxivWindowLimit = 100
export async function searchArxiv(query: string, signal: AbortSignal, startDate?: string, endDate = new Date().toISOString().slice(0,10)): Promise<ResearchCandidate[]> {
  const words = query.split(/\s+/).filter(Boolean).slice(0, 12).map(w => `all:${JSON.stringify(w.replace(/[^\p{L}\p{N}-]/gu, ''))}`).join(' AND ')
  const pageSize = startDate ? arxivWindowLimit : 30
  const collected: ResearchCandidate[] = []
  try {
    for (let start = 0; collected.length < pageSize && start < 500; start += pageSize) {
      if (start > 0) await delay(3100, undefined, { signal })
      const params = new URLSearchParams({ search_query: words + (startDate ? ` AND submittedDate:[${startDate.replaceAll('-', '')}0000 TO ${endDate.replaceAll('-', '')}2359]` : ''), sortBy: 'submittedDate', sortOrder: 'descending', start: String(start), max_results: String(pageSize) })
      const page = parseFeed(decoder.decode(await boundedFetch(`https://export.arxiv.org/api/query?${params}`, signal)), true, pageSize).map(s => ({ id: s.id, title: s.title, abstract: s.text, authors: s.authors ?? '', date: s.publishedAt, venue: 'arXiv 预印本', url: s.url, arxivId: s.pdfUrl?.split('/pdf/')[1], group: 'preprint' as const, roles: [], topics: [] }))
      if (!page.length) break
      let older = false
      for (const item of page) {
        const date = item.date.slice(0, 10)
        if (startDate && date < startDate) { older = true; break }
        if (!startDate || date <= endDate) collected.push(item)
        if (collected.length >= pageSize) break
      }
      if (older || page.length < pageSize) break
    }
    return collected
  } catch (error) {
    if (signal.aborted) throw error
    if (collected.length) return collected
    const htmlParams = new URLSearchParams({ query, searchtype: 'all', order: '-announced_date_first', size: '50' })
    return parseArxivSearch(decoder.decode(await boundedFetch(`https://arxiv.org/search/?${htmlParams}`, signal)))
  }
}
export function parsePublishedWorks(value: unknown): ResearchCandidate[] {
  const results = (value as { results?: unknown[] })?.results
  if (!Array.isArray(results)) throw new Error('正式论文索引格式无效')
  return results.flatMap(raw => {
    const item = raw as { id?: string; title?: string; is_retracted?: boolean; publication_date?: string; abstract_inverted_index?: Record<string, number[]>; authorships?: { author?: { display_name?: string } }[]; primary_location?: { source?: { display_name?: string }; landing_page_url?: string; is_published?: boolean }; locations?: { landing_page_url?: string; pdf_url?: string }[] }
    const venue = item.primary_location?.source?.display_name ?? '', url = item.primary_location?.landing_page_url ?? ''
    let official = false; try { const parsed = new URL(url); official = parsed.protocol === 'https:' && !parsed.username && !parsed.password && (publisherHosts.has(parsed.hostname) || parsed.hostname === 'doi.org' && /^\/10\.\d{4,9}\//.test(parsed.pathname)) } catch { /* Missing primary record. */ }
    if (!item.title || !item.id || item.is_retracted || !item.primary_location?.is_published || !topVenue.test(venue) || /workshop|findings/i.test(venue) || !official) return []
    const tokens: string[] = []
    for (const [word, positions] of Object.entries(item.abstract_inverted_index ?? {})) for (const pos of positions) if (Number.isInteger(pos) && pos >= 0 && pos < 5000) tokens[pos] = word
    const arxiv = item.locations?.map(l => /https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf)\/((?:\d{4}\.\d{4,5}|[a-z-]+\/\d{7})(?:v\d+)?)/.exec(l.landing_page_url ?? l.pdf_url ?? '')?.[1]).find(Boolean)
    return [{ id: item.id, title: item.title, authors: item.authorships?.slice(0, 5).map(a => a.author?.display_name ?? '').join('、') ?? '', date: item.publication_date ?? '', venue, url, arxivId: arxiv, abstract: tokens.filter(Boolean).join(' '), group: 'published' as const, roles: [], topics: [] }]
  })
}
export function mergeCandidates(values: ResearchCandidate[]): ResearchCandidate[] {
  const records: ResearchCandidate[] = []
  for (const item of values) {
    const index = records.findIndex(prior => sourceKey(prior.title) === sourceKey(item.title) || prior.id.toLowerCase() === item.id.toLowerCase() || !!prior.arxivId && !!item.arxivId && prior.arxivId.replace(/v\d+$/, '') === item.arxivId.replace(/v\d+$/, ''))
    if (index < 0) { records.push(item); continue }
    const prior = records[index]
    const preferred = item.group === 'published' ? item : prior
    records[index] = { ...preferred, arxivId: preferred.arxivId ?? prior.arxivId ?? item.arxivId, abstract: preferred.abstract || prior.abstract || item.abstract, topics: [...new Set([...prior.topics, ...item.topics])], roles: [...new Set([...prior.roles, ...item.roles])] }
  }
  return records
}
export function parseCrossrefWorks(value: unknown): ResearchCandidate[] {
  const records = (value as { message?: { items?: unknown[] } })?.message?.items
  if (!Array.isArray(records)) throw new Error('Crossref 返回格式无效')
  return records.flatMap(raw => {
    const record = raw as { DOI?: string; title?: string[]; 'container-title'?: string[]; type?: string; abstract?: string; published?: { 'date-parts'?: number[][] }; 'published-online'?: { 'date-parts'?: number[][] }; 'published-print'?: { 'date-parts'?: number[][] }; author?: { given?: string; family?: string }[]; relation?: Record<string, unknown>; update?: unknown }
    const venue = record['container-title']?.[0] ?? '', title = record.title?.[0], parts = record['published-online']?.['date-parts']?.[0] ?? record.published?.['date-parts']?.[0] ?? record['published-print']?.['date-parts']?.[0]
    if (!title || !record.DOI || !/^10\.\d{4,9}\/\S+$/.test(record.DOI) || !parts?.length || !topVenue.test(venue) || /workshop|findings/i.test(venue) || !['journal-article', 'proceedings-article'].includes(record.type ?? '') || record.update) return []
    const date = parts.slice(0,3).map((part,index) => index ? String(part).padStart(2,'0') : String(part)).join('-')
    return [{ id: `doi:${record.DOI}`, title, venue, url: `https://doi.org/${encodeURIComponent(record.DOI).replace(/%2F/gi,'/')}`, date, authors: record.author?.slice(0,5).map(a => `${a.given ?? ''} ${a.family ?? ''}`.trim()).join('、') ?? '', abstract: cleanHtml(record.abstract ?? ''), group: 'published' as const, roles: [], topics: [] }]
  })
}
export async function collectResearchCandidates(request: ResearchRequest, queries: string[], signal: AbortSignal, progress: (message: string) => void): Promise<{ sources: ResearchCandidate[]; warnings: string[] }> {
  const topics = [...request.topics, ...request.inspirations], sources: ResearchCandidate[] = [], warnings: string[] = []
  const today = new Date().toISOString().slice(0, 10)
  const custom = !!(request.dateFrom && request.dateTo)
  const publishedFrom = request.dateFrom ?? monthsAgo(request.publicationYears * 12)
  const publishedTo = request.dateTo ?? today
  const paperInWindow = (date: string) => custom ? withinRange(date, publishedFrom, publishedTo) : withinWindow(date, request.publicationYears * 12)
  const arxivWindows: [string, string][] = custom
    ? dateSlices(publishedFrom, publishedTo)
    : preprintBuckets(request.preprintMonths).map(([from, to]) => [monthsAgo(from), monthsAgo(to)])
  for (let index = 0; index < topics.length; index++) {
    signal.throwIfAborted(); progress(`正在检索 ${topics[index]} · ${index + 1}/${topics.length}`)
    const query = queries[index], role = index < request.topics.length ? 'core' as const : 'inspiration' as const
    const decorate = (items: ResearchCandidate[]) => items.map(item => ({ ...item, topics: [topics[index]], roles: [role] }))
    try {
      for (let windowIndex = 0; windowIndex < arxivWindows.length; windowIndex++) {
        if (windowIndex > 0) await delay(3100, undefined, { signal })
        const [start, end] = arxivWindows[windowIndex]
        progress(`正在检索 ${topics[index]} · arXiv ${start} 至 ${end}`)
        const found = await searchArxiv(query, signal, start, end)
        sources.push(...decorate(found.filter(s => { const date = s.date.slice(0, 10); return date >= start && date <= end })))
        if (found.length >= arxivWindowLimit) warnings.push(`${topics[index]}：arXiv ${start} 至 ${end} 超过 ${arxivWindowLimit} 篇，已保留这段时间里较新的 ${arxivWindowLimit} 篇。`)
      }
    }
    catch (error) { if (signal.aborted) throw error; warnings.push(`${topics[index]}：arXiv 检索暂不可用`) }
    try {
      const params = new URLSearchParams({ search: query, filter: `from_publication_date:${publishedFrom},to_publication_date:${publishedTo}`, 'per-page': '40', sort: 'relevance_score:desc' })
      const published = parsePublishedWorks(JSON.parse(decoder.decode(await boundedFetch(`https://api.openalex.org/works?${params}`, signal)))).filter(s => paperInWindow(s.date))
      sources.push(...decorate(published))
      if (published.length < 5) throw new Error('正式论文覆盖不足，补查 DOI 登记记录')
    } catch (error) {
      if (signal.aborted) throw error
      try {
        const params = new URLSearchParams({ query, filter: `from-pub-date:${publishedFrom},until-pub-date:${publishedTo}`, rows: '40' })
        const broad = parseCrossrefWorks(JSON.parse(decoder.decode(await boundedFetch(`https://api.crossref.org/works?${params}`, signal)))).filter(s => paperInWindow(s.date))
        sources.push(...decorate(broad))
        if (broad.length < 5) {
          progress(`正在补查 ${topics[index]} 的正式发表记录`)
          const venues = /medical|clinical|radiology|diagnos/i.test(query) ? ['IEEE Transactions on Medical Imaging', 'Medical Image Analysis', 'Medical Image Computing and Computer Assisted Intervention'] : ['IEEE Transactions on Pattern Analysis and Machine Intelligence', 'Computer Vision and Pattern Recognition', 'International Conference on Machine Learning']
          const results = await Promise.allSettled(venues.map(async venue => {
            const scoped = new URLSearchParams({ 'query.title': query, 'query.container-title': venue, filter: params.get('filter')!, rows: '20' })
            return parseCrossrefWorks(JSON.parse(decoder.decode(await boundedFetch(`https://api.crossref.org/works?${scoped}`, signal)))).filter(s => paperInWindow(s.date))
          }))
          for (const result of results) if (result.status === 'fulfilled') sources.push(...decorate(result.value))
          signal.throwIfAborted()
        }
      } catch (error) { if (signal.aborted) throw error; warnings.push(`${topics[index]}：正式发表论文索引暂不可用；不会把预印本冒充顶会顶刊`) }
    }
    if (index + 1 < topics.length) await delay(3100, undefined, { signal })
  }
  return { sources: mergeCandidates(sources), warnings }
}
