/** Text the main composer inserts for one @ mention. The id, not the title, is the identity. */
export function mentionToken(kind: 'field' | 'paper', title: string, id: string): string {
  const fallback = kind === 'field' ? '未命名领域' : '未命名论文'
  const safe = title.replace(/[\[\]()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || fallback
  return `@[${safe}](singularity-${kind}:${id})`
}

export interface MentionItem {
  kind: 'field' | 'paper'
  id: string
  title: string
  detail: string
  mention: string
}
