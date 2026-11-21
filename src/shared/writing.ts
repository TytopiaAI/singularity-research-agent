import type { WritingParagraph, WritingSectionKey } from './types'
export const writingSections:Array<{key:WritingSectionKey;label:string;english:string;color:string;core?:boolean}>=[
  {key:'abstract',label:'摘要',english:'Abstract',color:'#bf9d60',core:true},
  {key:'introduction',label:'介绍',english:'Introduction',color:'#7198bd',core:true},
  {key:'related_work',label:'相关工作',english:'Related Work',color:'#a08bb8',core:true},
  {key:'methods',label:'方法',english:'Methods',color:'#73a590',core:true},
  {key:'experiments',label:'实验',english:'Experiments',color:'#c08e6d',core:true},
  {key:'conclusion',label:'结论',english:'Conclusion',color:'#b78494',core:true},
  {key:'title',label:'标题',english:'Title',color:'#8996a4'},
  {key:'results',label:'结果',english:'Results',color:'#bc8a75'},
  {key:'discussion',label:'讨论',english:'Discussion',color:'#7b9d9b'},
]
export interface WritingGroup { id:string;projectId:string;section:WritingSectionKey;parentId:string|null;title:string;position:number;createdAt:string;updatedAt:string }
export interface ParagraphRequest { mode:'draft'|'polish'|'revise';feedback:string;baseVersionId?:string|null }
export interface TemplateAnchor { id:string;file:string;label:string;kind:'abstract'|'heading'|'append';title:string }
export interface WritingLatexMapping { section:WritingSectionKey;target:string }
export interface WritingLatexBinding { projectId:string;latexProjectId:string;language:'en'|'zh';mappings:WritingLatexMapping[];updatedAt:string }
export interface WritingTemplateInfo { binding:WritingLatexBinding|null;anchors:TemplateAnchor[];suggested:WritingLatexMapping[];finalizedCount:number }
export interface WritingLatexChange { file:string;before:string|null;after:string }
export interface WritingLatexPreview { id:string;projectId:string;latexProjectId:string;paragraphCount:number;sections:string[];changes:WritingLatexChange[];warnings:string[] }
export interface WritingWorkflowApi {
  groups(projectId:string,section:WritingSectionKey):Promise<WritingGroup[]>
  createGroup(projectId:string,section:WritingSectionKey,title:string,parentId?:string|null):Promise<WritingGroup>
  updateGroup(id:string,title:string):Promise<WritingGroup>
  removeGroup(id:string):Promise<void>
  moveParagraph(id:string,groupId:string|null,position?:number):Promise<WritingParagraph>
  finalizeParagraph(id:string,finalized:boolean):Promise<WritingParagraph>
  template(projectId:string):Promise<WritingTemplateInfo>
  bindTemplate(projectId:string,latexProjectId:string,language:'en'|'zh',mappings?:WritingLatexMapping[]):Promise<WritingTemplateInfo>
  previewLatex(projectId:string):Promise<WritingLatexPreview>
  applyLatex(previewId:string):Promise<{latexProjectId:string}>
}
