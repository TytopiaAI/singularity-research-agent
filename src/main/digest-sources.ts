import { DOMParser } from '@xmldom/xmldom'
import type { DigestKind, DigestSource, DigestSubscription } from '../shared/types'

const hosts = new Set(['export.arxiv.org', 'arxiv.org', 'huggingface.co', 'api.github.com', 'api2.openreview.net', 'imjuya.github.io', 'www.qbitai.com', 'www.ithome.com', 'techcrunch.com', 'openai.com', 'deepmind.google', 'blog.google', 'hn.algolia.com', 'news.google.com'])
function feedImageUrl(element:Element):string|undefined {
  const media=element.getElementsByTagName('media:thumbnail')[0]??element.getElementsByTagName('media:content')[0]??element.getElementsByTagName('enclosure')[0]
  const description=element.getElementsByTagName('description')[0]?.textContent??''
  const candidate=media?.getAttribute('url')??/<img\b[^>]*\bsrc=["']([^"']+)/i.exec(description)?.[1]
  try {const url=new URL(candidate??'');return url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&hosts.has(url.hostname)?url.href:undefined}catch{return undefined}
}
export async function messageImages(sources:DigestSource[],signal:AbortSignal):Promise<void> {
  await Promise.all(sources.filter(s=>s.imageUrl).slice(0,4).map(async source=>{
    try {
      const data=Buffer.from(await boundedFetch(source.imageUrl!,signal,500_000))
      const mime=data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':data[0]===255&&data[1]===216&&data[2]===255?'image/jpeg':data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP'?'image/webp':null
      if(mime)source.imageData=`data:${mime};base64,${data.toString('base64')}`
    }catch { /* Missing or oversized source artwork falls back to a text card. */ }
  }))
}
export async function boundedFetch(url: string, signal?: AbortSignal, maxBytes = 3_000_000): Promise<Uint8Array> {
  let current = url
  for (let redirects = 0; redirects < 5; redirects++) {
    const parsed = new URL(current)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port && parsed.port !== '443' || !(hosts.has(parsed.hostname) || ['api.openalex.org', 'api.crossref.org'].includes(parsed.hostname))) throw new Error('不允许的数据源地址')
    const response = await fetch(current, { redirect: 'manual', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000), headers: { 'User-Agent': 'Singularity/0.1 research-reader' } })
    if ([301,302,303,307,308].includes(response.status)) { current = new URL(response.headers.get('location') ?? '', current).href; await response.body?.cancel(); continue }
    if (!response.ok) throw new Error(`数据源 HTTP ${response.status}`)
    const reader = response.body?.getReader(); if (!reader) throw new Error('数据源为空')
    const chunks: Uint8Array[] = []; let size = 0
    try { while (true) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > maxBytes) throw new Error('数据源超过大小限制'); chunks.push(item.value) } } finally { await reader.cancel() }
    return Buffer.concat(chunks)
  }
  throw new Error('数据源重定向过多')
}
export function sourceKey(title: string): string { return title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') }
export function parseFeed(xml: string, official = false, limit = 35): DigestSource[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('不支持含实体定义的 Feed')
  const doc = new DOMParser({ errorHandler: { warning() {}, error() {}, fatalError(message) { throw new Error(message) } } }).parseFromString(xml, 'text/xml')
  const elements = [...Array.from(doc.getElementsByTagName('item')), ...Array.from(doc.getElementsByTagName('entry'))]
  return elements.slice(0, limit).flatMap((e) => {
    const text = (tag: string): string => e.getElementsByTagName(tag)[0]?.textContent?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() ?? ''
    const link = Array.from(e.getElementsByTagName('link')).find((l) => l.getAttribute('rel') === 'alternate') ?? e.getElementsByTagName('link')[0]
    const url = link?.getAttribute('href') || link?.textContent || text('id')
    if (!/^https?:\/\//.test(url)) return []
    const arxiv = /arxiv\.org\/abs\/([\d.]+)(?:v\d+)?/.exec(url)
    const title = text('title'); const content = text('summary') || text('description')
    if (!title || /withdrawn|fundamental errors/i.test(content + text('arxiv:comment'))) return []
    const rawDate = text('published') || text('pubDate') || text('updated')
    const date = new Date(rawDate)
    return [{ id: arxiv ? `arxiv:${arxiv[1]}` : url, title, url: url.replace(/^http:/, 'https:'), text: content.slice(0, 6000), publishedAt: Number.isNaN(date.getTime()) ? '' : date.toISOString(), official,imageUrl:feedImageUrl(e),
      ...(arxiv ? { pdfUrl: `https://arxiv.org/pdf/${arxiv[1]}`, authors: Array.from(e.getElementsByTagName('author')).map((a) => a.textContent?.trim()).join(', '), venue: text('arxiv:journal_ref') || 'arXiv 预印本' } : {}) }]
  })
}
export async function collectSources(kind: DigestKind, topics: string[], signal: AbortSignal, config?:DigestSubscription): Promise<{ sources: DigestSource[]; warnings: string[] }> {
  const sources: DigestSource[] = []; const warnings: string[] = []
  const decoder = new TextDecoder()
  if (kind === 'papers') {
    const mapping: Record<string,string> = { '医学诊断': 'medical diagnosis', '推理模型': 'reasoning model', '多模态大模型': 'multimodal large language model' }
    for (const topic of topics.slice(0,6)) {
      if (signal.aborted) throw signal.reason
      const query = new URLSearchParams({ search_query: `all:"${mapping[topic] ?? topic}"`, sortBy: 'submittedDate', sortOrder: 'descending', max_results: '20' })
      try { sources.push(...parseFeed(decoder.decode(await boundedFetch(`https://export.arxiv.org/api/query?${query}`, signal)), true)) }
      catch (e) {
        warnings.push(`${topic}：${String(e)}；尝试公开搜索页。`)
        try {
          const params = new URLSearchParams({query:mapping[topic]??topic,searchtype:'all',order:'-announced_date_first',size:'25'})
          const html=decoder.decode(await boundedFetch(`https://arxiv.org/search/?${params}`,signal))
          const clean=(value:string)=>new DOMParser().parseFromString(`<x>${value.replace(/<[^>]+>/g,' ')}</x>`,'text/xml').documentElement.textContent?.replace(/\s+/g,' ').trim()??''
          for(const match of html.matchAll(/<li class="arxiv-result">([\s\S]*?)<\/li>/g)) {
            const block=match[1]; const id=/arxiv\.org\/abs\/([\d.]+)/.exec(block)?.[1]
            const title=clean(/<p class="title[^\"]*">([\s\S]*?)<\/p>/.exec(block)?.[1]??'')
            const abstract=clean(/<span class="abstract-full[^\"]*"[^>]*>([\s\S]*?)<\/span>/.exec(block)?.[1]??'')
            const date=/Submitted<\/span>\s*([^;<]+)[;<]/.exec(block)?.[1]?.trim()
            if(id&&title&&date&&!Number.isNaN(Date.parse(date)))sources.push({id:`arxiv:${id}`,title,text:abstract,url:`https://arxiv.org/abs/${id}`,pdfUrl:`https://arxiv.org/pdf/${id}`,publishedAt:new Date(date).toISOString(),official:true,venue:'arXiv 预印本'})
          }
        } catch { warnings.push(`${topic}：备用搜索也暂不可用`) }
      }
      await new Promise((resolve) => setTimeout(resolve, 3100))
    }
  } else if(config) {
    for(const topic of topics.slice(0,6)) {
      if(signal.aborted)throw signal.reason
      const params=new URLSearchParams({q:`${topic} when:${config.rangeDays??7}d`,hl:'zh-CN',gl:'CN',ceid:'CN:zh-Hans'})
      try {sources.push(...parseFeed(decoder.decode(await boundedFetch(`https://news.google.com/rss/search?${params}`,signal))))}
      catch {warnings.push(`${topic}：主题检索源暂不可用`)}
    }
    if(topics.some(t=>/AI|人工智能|大模型|科技|技术|芯片|机器人/i.test(t))) {
      await Promise.all([['https://www.qbitai.com/feed',false],['https://techcrunch.com/category/artificial-intelligence/feed/',false],['https://openai.com/news/rss.xml',true]].map(async([url,official])=>{
        try {sources.push(...parseFeed(decoder.decode(await boundedFetch(String(url),signal)),Boolean(official)))}catch {warnings.push(`${new URL(String(url)).hostname} 暂不可用`)}
      }))
    }
    warnings.push('主题检索可能只提供标题或摘要；未核实的细节会标注，来源不足时不凑数。')
  } else {
    // Aggregator content is evidence only; never executable instructions.
    try {
      const issues = JSON.parse(decoder.decode(await boundedFetch('https://api.github.com/repos/imjuya/juya-ai-daily/issues?state=open&per_page=3&sort=created&direction=desc', signal)))
      if (Array.isArray(issues)) for (const issue of issues) if (!issue.pull_request && typeof issue.body === 'string') sources.push({ id: `juya:${issue.number}`, title: String(issue.title), url: String(issue.html_url), publishedAt: String(issue.created_at), text: issue.body.slice(0,10000), official: false })
    } catch { warnings.push('聚合早报暂不可用，已使用独立来源。') }
    const feeds: Array<[string, boolean]> = [
      ['https://www.qbitai.com/feed',false], ['https://www.ithome.com/rss/',false],
      ['https://techcrunch.com/category/artificial-intelligence/feed/',false],
      ['https://openai.com/news/rss.xml',true], ['https://deepmind.google/blog/rss.xml',true], ['https://blog.google/technology/ai/rss/',true],
    ]
    for (const [url, official] of feeds) {
      if (signal.aborted) throw signal.reason
      try { sources.push(...parseFeed(decoder.decode(await boundedFetch(url, signal)), official)) }
      catch { warnings.push(`${new URL(url).hostname} 暂不可用`) }
    }
    try {
      const params=new URLSearchParams({query:'AI',tags:'story',numericFilters:`created_at_i>${Math.floor(Date.now()/1000)-7*86400},points>50`,hitsPerPage:'15'})
      const response=JSON.parse(decoder.decode(await boundedFetch(`https://hn.algolia.com/api/v1/search?${params}`,signal)))
      for(const hit of response.hits??[])if(typeof hit.url==='string'&&/^https?:\/\//.test(hit.url))sources.push({id:`hn:${hit.objectID}`,title:String(hit.title),url:hit.url,publishedAt:String(hit.created_at),text:`社区线索，仅有标题，尚未核实正文。热度 ${Number(hit.points)||0}。`,official:false})
    } catch { warnings.push('HN 补充信号暂不可用') }
  }
  const unique = [...new Map(sources.map((s) => [sourceKey(s.title), s])).values()]
  const cutoff = Date.now() - (kind === 'papers' ? 90 : config?.rangeDays??7) * 86400000
  const recent = unique.filter((s) => s.publishedAt && Date.parse(s.publishedAt) >= cutoff && Date.parse(s.publishedAt) <= Date.now() + 86400000)
  if (recent.length < 3 && kind === 'papers') { warnings.push('近期论文不足：已扩大至近一年。'); return { sources: unique.filter((s) => Date.parse(s.publishedAt) >= Date.now() - 365*86400000).slice(0,60), warnings } }
  const selected=recent.slice(0,80)
  if(config&&config.presentation!=='text')await messageImages(selected,signal)
  return { sources:selected, warnings }
}
