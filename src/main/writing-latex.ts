import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { writingSections, type TemplateAnchor, type WritingLatexChange, type WritingLatexMapping, type WritingLatexPreview, type WritingTemplateInfo } from '../shared/writing'
import type { WritingSectionKey } from '../shared/types'
import { LatexStore } from './latex-store'
import { PaperRepository } from './paper-repository'

type Anchor=TemplateAnchor&{start:number;end:number;level:number}
// Mask comments without changing offsets; escaped percent signs remain literal.
function visible(text:string){return text.replace(/(^|[^\\])%[^\n]*/gm,m=>m[0]==='%'?' '.repeat(m.length):m[0]+' '.repeat(m.length-1))}
function anchors(file:string,text:string,main:boolean):Anchor[]{
  const source=visible(text),result:Anchor[]=[],headingStarts=new Map<string,number>()
  const expression=/\\(section|subsection|subsubsection|paragraph|subparagraph)(\*)?\s*(?:\[[^\]]*\]\s*)?\{/g
  let match:RegExpExecArray|null
  const counts=new Map<string,number>()
  while((match=expression.exec(source))){
    let i=expression.lastIndex,depth=1;for(;i<source.length&&depth;i++){if(source[i]==='{'&&source[i-1]!=='\\')depth++;if(source[i]==='}'&&source[i-1]!=='\\')depth--}
    if(depth)continue
    const title=text.slice(expression.lastIndex,i-1),key=match[1]+':'+title,n=(counts.get(key)??0)+1;counts.set(key,n)
    const anchor={id:file+'#'+key+':'+n,file,kind:'heading' as const,title,label:file+' · '+title,start:i,end:source.length,level:['section','subsection','subsubsection','paragraph','subparagraph'].indexOf(match[1])+1}
    result.push(anchor);headingStarts.set(anchor.id,match.index)
    expression.lastIndex=i
  }
  const tail=source.search(/\\(?:bibliography(?:style)?\b|printbibliography\b|appendix\b|end\s*\{document\})/)
  for(const [i,a] of result.entries()){const next=result.slice(i+1).find(b=>b.level<=a.level);a.end=next?headingStarts.get(next.id)!:text.length;if(tail>a.start)a.end=Math.min(a.end,tail)}
  const abstract=/\\begin\s*\{abstract\}([\s\S]*?)\\end\s*\{abstract\}/g
  while((match=abstract.exec(source))){const start=match.index+match[0].indexOf('}')+1;result.push({id:file+'#abstract:'+result.filter(a=>a.kind==='abstract').length,file,kind:'abstract',title:'Abstract',label:file+' · Abstract',start,end:match.index+match[0].lastIndexOf('\\end'),level:0})}
  if(main){const end=source.search(/\\end\s*\{document\}/);if(end>=0)result.push({id:file+'#append',file,kind:'append',title:'文末新增章节',label:file+' · 文末新增章节',start:tail>=0?tail:end,end:tail>=0?tail:end,level:0})}
  return result
}
const aliases:Record<string,RegExp>={abstract:/abstract|摘要/i,introduction:/introduction|引言|介绍|绪论/i,related_work:/related\s*work|background|literature|相关工作|文献综述/i,methods:/method|approach|方法/i,experiments:/experiment|evaluation|实验/i,results:/results?|结果/i,discussion:/discussion|讨论/i,conclusion:/conclu|结论|总结/i,title:/^title$|^标题$/i}

/** Convert prose to TeX, retaining explicit math and citation/reference commands only. */
export function proseToLatex(value:string):string{
  const tokens:string[]=[]
  const protect=(text:string)=>{const i=tokens.push(text)-1;return `\u0001${i}\u0002`}
  const source=value.replace(/\r\n/g,'\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'')
    .replace(/\$\$[\s\S]*?\$\$|(?<!\\)\$(?:\\.|[^$\n])*?\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\\(?:cite[pt]?|ref|eqref|autoref)\*?(?:\[[^\]\n]*\])?\{[a-zA-Z0-9_.:, /-]+\}/g,match=>{
      if(/\\(?:input|include|write|read|open|catcode|def|newcommand|csname|usepackage|documentclass|special|directlua|immediate|end|begin|loop|file|url|href)/i.test(match))throw Error('段落公式包含文件或执行指令，请先移除后再转换。')
      return protect(match)
    })
  return source.replace(/[\\{}%&#_$~^]/g,c=>({'\\':'\\textbackslash{}','{':'\\{','}':'\\}','%':'\\%','&':'\\&','#':'\\#','_':'\\_','$':'\\$','~':'\\textasciitilde{}','^':'\\textasciicircum{}'}[c]!)).replace(/\u0001(\d+)\u0002/g,(_,i)=>tokens[Number(i)])
}

export class WritingLatexService {
  private previews=new Map<string,{result:WritingLatexPreview;fingerprint:string;at:number}>()
  constructor(private papers:PaperRepository,private latex:LatexStore){}
  private cards(id:string){return writingSections.flatMap(s=>this.papers.writingParagraphs(id,s.key))}
  private scan(id:string){const project=this.latex.project(id);return project.files.filter(f=>f.editable&&/\.tex$/i.test(f.path)&&!f.path.includes('singularity-writing/')).flatMap(f=>anchors(f.path,this.latex.read(id,f.path).text,f.path===project.mainFile))}
  info(projectId:string):WritingTemplateInfo{
    const binding=this.papers.writingTemplateBinding(projectId),items=binding?this.scan(binding.latexProjectId):[]
    const fallback=items.find(a=>a.kind==='append')
    return {binding,anchors:items.map(({start,end,level,...a})=>a),suggested:writingSections.flatMap(s=>{const a=items.find(a=>a.kind!=='append'&&aliases[s.key].test(a.title))??fallback;return a?[{section:s.key,target:a.id}]:[]}),finalizedCount:this.cards(projectId).filter(p=>p.finalized).length}
  }
  bind(projectId:string,latexProjectId:string,language:'en'|'zh',mappings?:WritingLatexMapping[]){
    if(!['en','zh'].includes(language))throw Error('请选择输出语言。')
    const items=this.scan(latexProjectId)
    if(!items.some(a=>a.kind==='append'))throw Error('主文件缺少 document 结束标记，不能连接模板。')
    if(mappings&&(!Array.isArray(mappings)||mappings.length>writingSections.length||mappings.some(m=>!writingSections.some(s=>s.key===m.section)||!items.some(a=>a.id===m.target))||new Set(mappings.map(m=>m.section)).size!==mappings.length))throw Error('章节映射无效，请重新选择。')
    this.papers.saveWritingTemplateBinding({projectId,latexProjectId,language,mappings:mappings??[]});return this.info(projectId)
  }
  private fingerprint(projectId:string){return createHash('sha256').update(JSON.stringify({binding:this.papers.writingTemplateBinding(projectId),cards:this.cards(projectId),groups:writingSections.flatMap(s=>this.papers.writingGroups(projectId,s.key)),meta:this.papers.writingTemplateBinding(projectId)?this.latex.meta(this.papers.writingTemplateBinding(projectId)!.latexProjectId).mainFile:null})).digest('hex')}
  preview(projectId:string):WritingLatexPreview{
    const info=this.info(projectId),binding=info.binding;if(!binding)throw Error('请先上传或连接 LaTeX 模板。')
    const cards=this.cards(projectId).filter(p=>p.finalized),items=this.scan(binding.latexProjectId),meta=this.latex.meta(binding.latexProjectId)
    const sourceFiles=this.latex.project(binding.latexProjectId).files.filter(f=>f.editable&&/\.tex$/i.test(f.path)&&!f.path.includes('singularity-writing/')).map(f=>({file:f.path,text:this.latex.read(binding.latexProjectId,f.path).text}))
    if(!cards.length&&!sourceFiles.some(f=>f.text.includes(`%<singularity:${projectId}:`)))throw Error('还没有定稿段落，请先采纳双语版本并点击卡片左上角的星星。')
    const changes=new Map<string,WritingLatexChange>(),replacements=new Map<string,Array<{start:number;end:number;text:string}>>(),warnings:string[]=[],sections:string[]=[]
    const read=(file:string)=>this.latex.files(binding.latexProjectId).some(f=>f.path===file)?this.latex.read(binding.latexProjectId,file).text:null
    const add=(file:string,after:string)=>{const before=read(file);if(before!==after)changes.set(file,{file,before,after})}
    const mappings=binding.mappings.length?binding.mappings:info.suggested
    for(const section of writingSections){
      const paragraphs=cards.filter(p=>p.section===section.key)
      const start=`%<singularity:${projectId}:${section.key}>`,end=`%</singularity:${projectId}:${section.key}>`
      const managed=sourceFiles.flatMap(f=>{const a=f.text.indexOf(start),b=f.text.indexOf(end);return a<0?[]:[{file:f.file,start:a,end:b<0?-1:b+end.length}]})
      if(managed.length>1||managed.some(m=>m.end<0))throw Error('模板中的受管理段落标记不完整，请在 LaTeX 中检查。')
      if(!paragraphs.length){
        if(managed.length){const position=managed[0],list=replacements.get(position.file)??[];list.push({...position,text:''});replacements.set(position.file,list);warnings.push(`${section.label}已取消定稿，本次将从模板移除先前写入的内容；可在文件历史中恢复。`);sections.push(section.label)}
        continue
      }
      const target=items.find(a=>a.id===mappings.find(m=>m.section===section.key)?.target)
      if(!target)throw Error(`请为“${section.label}”选择模板位置。`)
      const groups=this.papers.writingGroups(projectId,section.key)
      const content=(parentId:string|null,depth:number):string=>{
        const own=paragraphs.filter(p=>(p.groupId??null)===parentId).map(p=>{const v=p.versions.find(v=>v.id===p.finalizedVersionId);if(!v||v.id!==p.currentVersionId||v.status!=='complete'||p.draftText.trim()!==v.academicZh.trim())throw Error('定稿状态已变化，请重新确认段落。');return proseToLatex(binding.language==='en'?v.academicEn:v.academicZh)})
        for(const g of groups.filter(g=>g.parentId===parentId)){const body=content(g.id,depth+1);if(body.trim())own.push(`\\${['subsection','subsubsection','paragraph','subparagraph'][Math.min(depth+Math.max(target.level-1,0),3)]}{${proseToLatex(g.title)}}\n${body}`)}
        return own.join('\n\n')
      }
      const text=content(null,0),folder=path.posix.dirname(meta.mainFile),relative=`singularity-writing/${projectId}/${section.key}.tex`,file=folder==='.'?relative:folder+'/'+relative
      if(binding.language==='en'&&/[\u3400-\u9fff]/.test(text))warnings.push(`${section.label}含中文标题或正文，模板需支持中文，或先改为英文。`)
      if(section.key==='abstract'&&groups.some(g=>paragraphs.some(p=>p.groupId===g.id)))warnings.push('摘要中包含分组标题，请确认目标期刊是否允许。')
      add(file,'% Generated from finalized bilingual paragraph cards. Edit in Singularity to keep versions aligned.\n'+text+'\n')
      const source=this.latex.read(binding.latexProjectId,target.file).text
      const block=`${start}\n\\input{${relative}}\n${end}`
      const position=managed[0]??{file:target.file,start:target.start,end:target.end}
      if(managed[0]&&(managed[0].file!==target.file||(target.kind!=='append'&&(managed[0].start<target.start||managed[0].end>target.end))))throw Error('已有写入内容位于另一位置，请保留原映射或先在 LaTeX 中移除旧标记。')
      let insertion=block
      if(!managed.length&&target.kind==='append')insertion=section.key==='abstract'?`\\begin{abstract}\n${block}\n\\end{abstract}\n`:`\\section{${proseToLatex(binding.language==='en'?section.english:section.label)}}\n${block}\n`
      else if(!managed.length){const label=source.slice(target.start,target.end).match(/^\s*(?:\\label\{[^}]+\}\s*)+/)?.[0]??'\n';insertion=label+block+'\n';if(source.slice(target.start,target.end).trim())warnings.push(`${section.label}将替换“${target.title}”现有正文，原文保存在文件历史中。`)}
      const list=replacements.get(position.file)??[];list.push({...position,text:insertion});replacements.set(position.file,list);sections.push(section.label)
    }
    for(const [file,entries] of replacements){let text=this.latex.read(binding.latexProjectId,file).text;const list=entries.map((r,i)=>({...r,order:i})).sort((a,b)=>b.start-a.start||b.order-a.order);for(let i=0;i<list.length;i++){const r=list[i],previous=list[i-1];if(previous&&r.end>previous.start)throw Error('章节目标重叠，请为每个章节选择独立位置。');text=text.slice(0,r.start)+r.text+text.slice(r.end)}add(file,text)}
    const result:WritingLatexPreview={id:randomUUID(),projectId,latexProjectId:binding.latexProjectId,paragraphCount:cards.length,sections,changes:[...changes.values()],warnings:[...new Set(warnings)]}
    for(const [id,p] of this.previews)if(Date.now()-p.at>30*60*1000)this.previews.delete(id)
    if(this.previews.size>=20)this.previews.delete(this.previews.keys().next().value!)
    this.previews.set(result.id,{result:structuredClone(result),fingerprint:this.fingerprint(projectId),at:Date.now()});return result
  }
  apply(id:string){const p=this.previews.get(id);if(!p||Date.now()-p.at>30*60*1000)throw Error('预览已过期，请重新预览。');if(p.fingerprint!==this.fingerprint(p.result.projectId))throw Error('段落、分组或模板设置已变化，请重新预览。');this.latex.applyBatch(p.result.latexProjectId,p.result.changes);this.previews.delete(id);return {latexProjectId:p.result.latexProjectId}}
}
