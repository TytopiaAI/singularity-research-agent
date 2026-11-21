import type { DiscoveryFeed, DiscoveryItem } from '../shared/types'
import { boundedFetch } from './digest-sources'

const decoder = new TextDecoder()
let cached: DiscoveryFeed | null = null

export function isoWeek(date = new Date()): string {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  utc.setUTCDate(utc.getUTCDate() + 4 - (utc.getUTCDay() || 7))
  const year = utc.getUTCFullYear()
  const first = new Date(Date.UTC(year, 0, 1))
  return `${year}-W${String(Math.ceil((((utc.getTime() - first.getTime()) / 86400000) + 1) / 7)).padStart(2, '0')}`
}

export function parseHuggingFacePapers(value: unknown): DiscoveryItem[] {
  if (!Array.isArray(value)) throw new Error('Hugging Face 返回格式无效')
  return value.flatMap((entry) => {
    const record = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
    const paper = record.paper && typeof record.paper === 'object' ? record.paper as Record<string, unknown> : record
    const id = typeof paper.id === 'string' ? paper.id : ''
    const title = typeof paper.title === 'string' ? paper.title.trim() : ''
    if (!/^(\d{4}\.\d{4,5}|[a-z-]+\/\d{7})$/.test(id) || !title) return []
    const authors = Array.isArray(paper.authors) ? paper.authors.map((a) => typeof a === 'object' && a && 'name' in a ? String(a.name) : '').filter(Boolean).slice(0, 3).join('、') : ''
    return [{ id: `hf:${id}`, title, summary: String(paper.summary ?? '').slice(0, 550), url: `https://huggingface.co/papers/${id}`,
      pdfUrl: `https://arxiv.org/pdf/${id}`, author: authors, publishedAt: String(paper.publishedAt ?? record.publishedAt ?? ''),
      metric: typeof record.upvotes === 'number' ? `${record.upvotes} 赞` : typeof paper.upvotes === 'number' ? `${paper.upvotes} 赞` : undefined }]
  }).slice(0, 10)
}

export function parseGithubRepositories(value: unknown): DiscoveryItem[] {
  const items = value && typeof value === 'object' && 'items' in value ? (value as { items: unknown }).items : null
  if (!Array.isArray(items)) throw new Error('GitHub 返回格式无效')
  return items.flatMap((entry) => {
    const item = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
    const name = typeof item.full_name === 'string' ? item.full_name : ''
    const url = typeof item.html_url === 'string' ? item.html_url : ''
    if (!/^[\w.-]+\/[\w.-]+$/.test(name) || url !== `https://github.com/${name}`) return []
    return [{ id: `github:${name}`, title: name, summary: String(item.description ?? '').slice(0, 450), url,
      author: String(item.language ?? '开源项目'), publishedAt: String(item.created_at ?? ''), metric: `${Number(item.stargazers_count) || 0} Stars` }]
  }).slice(0, 10)
}

export async function discoveryFeed(refresh = false): Promise<DiscoveryFeed> {
  if (!refresh && cached && Date.now() - Date.parse(cached.fetchedAt) < 30 * 60_000) return cached
  const now = new Date()
  const week = isoWeek(now)
  const weekStart = new Date(now)
  weekStart.setUTCDate(now.getUTCDate() - 7)
  const query = new URLSearchParams({ q: `created:>=${weekStart.toISOString().slice(0, 10)}`, sort: 'stars', order: 'desc', per_page: '10' })
  const [papers, repositories, venues] = await Promise.allSettled([
    boundedFetch(`https://huggingface.co/api/daily_papers?week=${week}&sort=trending&limit=10`),
    boundedFetch(`https://api.github.com/search/repositories?${query}`),
    boundedFetch('https://api2.openreview.net/groups?id=active_venues'),
  ])
  const warnings: string[] = []
  let hf: DiscoveryItem[] = []
  let gh: DiscoveryItem[] = []
  try { if (papers.status === 'fulfilled') hf = parseHuggingFacePapers(JSON.parse(decoder.decode(papers.value))); else throw papers.reason }
  catch { warnings.push('Hugging Face 本周论文暂不可用') }
  try { if (repositories.status === 'fulfilled') gh = parseGithubRepositories(JSON.parse(decoder.decode(repositories.value))); else throw repositories.reason }
  catch { warnings.push('GitHub 热门项目暂不可用，稍后可重试') }
  let conferences: DiscoveryItem[] = []
  try {
    if (venues.status !== 'fulfilled') throw venues.reason
    const ids = flagshipVenueIds(activeVenueMembers(JSON.parse(decoder.decode(venues.value)))).slice(0, 16)
    const groups = await Promise.all(ids.map(async id => {
      try {
        const body = JSON.parse(decoder.decode(await boundedFetch(`https://api2.openreview.net/groups?id=${encodeURIComponent(id)}`))) as { groups?: unknown[] }
        return body.groups?.[0]
      } catch { return null }
    }))
    conferences = groups.flatMap(group => { const item = conferenceFromGroup(group, now.getTime()); return item ? [item] : [] }).sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))
  } catch { warnings.push('顶会放榜暂不可用') }
  cached = { fetchedAt: now.toISOString(), week, papers: hf, repositories: gh, conferences, warnings }
  return cached
}

const flagshipVenue = /^(?:NeurIPS\.cc|ICLR\.cc|ICML\.cc|thecvf\.com\/(?:CVPR|ICCV|ECCV)|aclweb\.org\/(?:ACL|NAACL)|EMNLP|AAAI\.org|ACM\.org\/SIGIR|robot-learning\.org\/CoRL|colmweb\.org\/COLM|aistats\.org\/AISTATS|IEEE\.org\/ICRA|MICCAI\.org)\/(\d{4})\/Conference$/
const venueNames: [RegExp, string][] = [[/NeurIPS/, 'NeurIPS'], [/ICLR/, 'ICLR'], [/ICML/, 'ICML'], [/CVPR/, 'CVPR'], [/ICCV/, 'ICCV'], [/ECCV/, 'ECCV'], [/NAACL/, 'NAACL'], [/ACL/, 'ACL'], [/EMNLP/, 'EMNLP'], [/AAAI/, 'AAAI'], [/SIGIR/, 'SIGIR'], [/CoRL/, 'CoRL'], [/COLM/, 'COLM'], [/AISTATS/, 'AISTATS'], [/ICRA/, 'ICRA'], [/MICCAI/, 'MICCAI']]

export function activeVenueMembers(payload: unknown): unknown {
  const groups = payload && typeof payload === 'object' && 'groups' in payload ? (payload as { groups?: { members?: unknown }[] }).groups : null
  if (!Array.isArray(groups) || !groups.length || !Array.isArray(groups[0]?.members)) throw new Error('OpenReview 会场列表无效')
  return groups[0].members
}

export function flagshipVenueIds(members: unknown): string[] {
  if (!Array.isArray(members) || members.some(id => typeof id !== 'string')) throw new Error('会场列表无效')
  return [...new Set(members.filter((id): id is string => flagshipVenue.test(id)))]
}

function venueField(group: Record<string, unknown>, key: string): unknown {
  const content = group.content
  if (!content || typeof content !== 'object') return undefined
  const field = (content as Record<string, unknown>)[key]
  return field && typeof field === 'object' && 'value' in field ? (field as { value: unknown }).value : undefined
}

export function parseVenueStart(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Acceptance lists are public around the meeting: recently started, or starting within 45 days. */
export function isRecentConference(startIso: string, now: number): boolean {
  const start = Date.parse(startIso)
  const day = 86_400_000
  return start >= now - 60 * day && start <= now + 45 * day
}

export function conferenceFromGroup(group: unknown, now = Date.now()): DiscoveryItem | null {
  if (!group || typeof group !== 'object') return null
  const record = group as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id : ''
  const year = flagshipVenue.exec(id)?.[1]
  if (!year) return null
  const options = venueField(record, 'accept_decision_options')
  if (!Array.isArray(options) || !options.length) return null
  const start = parseVenueStart(venueField(record, 'start_date'))
  if (!start || !isRecentConference(start, now)) return null
  const website = venueField(record, 'website')
  const url = typeof website === 'string' && /^https:\/\/[^\s]+$/.test(website) ? website : `https://openreview.net/group?id=${encodeURIComponent(id)}`
  const location = venueField(record, 'location')
  const name = venueNames.find(([pattern]) => pattern.test(id))?.[1] ?? '顶会'
  return { id: `venue:${id}`, title: `${name} ${year}`, summary: typeof location === 'string' && location.trim() ? location.trim().slice(0, 80) : '录用结果已公开', url, author: '', publishedAt: start, metric: '新放榜' }
}
