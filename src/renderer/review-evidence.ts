import type { PaperReview, ReviewSectionKey } from '../shared/types'

export const reviewLabels: Record<ReviewSectionKey,string> = {
  problem:'核心问题', innovation:'关键贡献', method:'方法架构', dataset:'数据集分析',
  setup:'实验设置', results:'结果与消融', explanation:'直观理解', context:'学术脉络',
  future:'未来想象力', concepts:'关键概念', action:'行动建议',
}

export interface EvidenceRect<TKey extends string = ReviewSectionKey> { key: TKey; quote: string; index: number; x: number; y: number; width: number; height: number }

function normalizedText(value:string):string { return value.normalize('NFKC').replace(/\s+/gu,' ').trim().toLocaleLowerCase() }

export function locateEvidenceQuotes<TKey extends string>(layer:HTMLElement,sheet:HTMLElement,entries: Array<{key:TKey;index:number;page:number;quote:string}>,page:number):EvidenceRect<TKey>[] {
  const walker=document.createTreeWalker(layer,NodeFilter.SHOW_TEXT)
  const chars:{node:Text;offset:number}[]=[]
  let flat='';let current:Node|null
  while((current=walker.nextNode())) {
    const node=current as Text
    for(let i=0;i<node.data.length;i++) {
      const source=node.data[i].normalize('NFKC').toLocaleLowerCase()
      for(const char of source) {
        const normalized=/\s/u.test(char)?' ':char
        if(normalized===' '&&flat.endsWith(' '))continue
        flat+=normalized;chars.push({node,offset:i})
      }
    }
    if(flat&&!flat.endsWith(' ')){flat+=' ';chars.push({node,offset:node.length-1})}
  }
  const bounds=sheet.getBoundingClientRect();if(!bounds.width||!bounds.height)return []
  const compactChars:typeof chars=[];let compact=''
  for(let i=0;i<flat.length;i++)if(flat[i]!==' '){compact+=flat[i];compactChars.push(chars[i])}
  const output:EvidenceRect<TKey>[]=[]
  for(const evidence of entries) {
    if(evidence.page!==page)continue
    const quote=normalizedText(evidence.quote).replaceAll(' ','');const start=compact.indexOf(quote)
    if(start<0||!compactChars[start]||!compactChars[start+quote.length-1])continue
    // A range across multiple PDF.js spans can include their line boxes and the
    // blank space between columns. Measure the matched text within each span.
    const fragments=new Map<Text,{start:number;end:number}>()
    for(let i=start;i<start+quote.length;i++) {
      const character=compactChars[i]
      const fragment=fragments.get(character.node)
      if(fragment) { fragment.start=Math.min(fragment.start,character.offset);fragment.end=Math.max(fragment.end,character.offset+1) }
      else fragments.set(character.node,{start:character.offset,end:character.offset+1})
    }
    for(const [node,fragment] of fragments) {
      const range=document.createRange()
      range.setStart(node,fragment.start)
      range.setEnd(node,fragment.end)
      for(const rect of range.getClientRects()) {
        const left=Math.max(bounds.left,rect.left),top=Math.max(bounds.top,rect.top)
        const right=Math.min(bounds.right,rect.right),bottom=Math.min(bounds.bottom,rect.bottom)
        if(right-left<=1||bottom-top<=1)continue
        output.push({key:evidence.key,quote:evidence.quote,index:evidence.index,
          x:(left-bounds.left)/bounds.width,y:(top-bounds.top)/bounds.height,
          width:(right-left)/bounds.width,height:(bottom-top)/bounds.height})
      }
    }
  }
  return output
}

export function locateReviewEvidence(layer:HTMLElement,sheet:HTMLElement,review:PaperReview,page:number):EvidenceRect[] {
  return locateEvidenceQuotes(layer,sheet,review.sections.flatMap((section)=>section.evidence.map((evidence,index)=>({key:section.key,index,...evidence}))),page)
}
