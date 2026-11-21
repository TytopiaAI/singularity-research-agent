// Read-only connectivity check. Does not call any model or generate a digest.
import { boundedFetch, parseFeed } from '../src/main/digest-sources'

const urls = [
  'https://export.arxiv.org/api/query?search_query=all:medical&max_results=2',
  'https://www.qbitai.com/feed',
  'https://techcrunch.com/category/artificial-intelligence/feed/',
]
await Promise.all(urls.map(async (url) => {
  try {
    const bytes = await boundedFetch(url)
    const items = parseFeed(new TextDecoder().decode(bytes))
    console.log(JSON.stringify({ source: new URL(url).hostname, bytes: bytes.length, items: items.length, dated: items.filter((item) => item.publishedAt).length }))
  } catch (error) {
    console.log(JSON.stringify({ source: new URL(url).hostname, error: String(error) }))
  }
}))
