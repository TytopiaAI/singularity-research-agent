// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { buildVisualParagraphs, groupVisualLines, isReferenceHeading, paragraphAt, translatedParagraphTexts } from '../src/renderer/reader-paragraphs'
import type { ReaderCard } from '../src/shared/types'

describe('clickable PDF paragraphs',()=>{
 it('groups wrapped lines but keeps visually separated paragraphs as different cards',()=>{
  const sheet=document.createElement('div')
  const layer=document.createElement('div')
  sheet.appendChild(layer)
  sheet.getBoundingClientRect=()=>new DOMRect(0,0,600,800)
  for(const [text,x,y] of [['The method uses',100,100],['reliable evaluation.',100,115],['Results improve.',100,150]] as const){
   const span=document.createElement('span');span.textContent=text
   span.getBoundingClientRect=()=>new DOMRect(x,y,190,10)
   layer.appendChild(span)
  }
  const paragraphs=buildVisualParagraphs(layer,sheet)
  expect(paragraphs.map((item)=>item.text)).toEqual(['The method uses reliable evaluation.','Results improve.'])
  expect(paragraphAt(paragraphs,sheet,150,106)?.text).toContain('The method')
  expect(paragraphAt(paragraphs,sheet,150,155)?.text).toBe('Results improve.')
  expect(paragraphAt(paragraphs,sheet,150,130)).toBeNull()
 })
 it('does not mix adjacent columns into a single translation card',()=>{
  const sheet=document.createElement('div');const layer=document.createElement('div');sheet.appendChild(layer)
  sheet.getBoundingClientRect=()=>new DOMRect(0,0,600,800)
  for(const [text,x,y] of [
   ['Left paragraph starts',40,100],['Left paragraph continues',40,115],['Left paragraph ends.',40,130],
   ['Right paragraph starts',335,100],['Right paragraph continues',335,115],['Right paragraph ends.',335,130],
  ] as const){const span=document.createElement('span');span.textContent=text;span.getBoundingClientRect=()=>new DOMRect(x,y,180,10);layer.appendChild(span)}
  const paragraphs=buildVisualParagraphs(layer,sheet)
  expect(paragraphs).toHaveLength(2)
  expect(paragraphs[0].text).toBe('Left paragraph starts Left paragraph continues Left paragraph ends.')
  expect(paragraphs[1].text).toBe('Right paragraph starts Right paragraph continues Right paragraph ends.')
  expect(paragraphAt(paragraphs,sheet,350,105)?.text).toContain('Right paragraph')
 })
 it('removes a completed paragraph underline and restores it when the card is hidden',()=>{
  const card: ReaderCard = {id:'translation-1',paperId:'paper-1',kind:'translation',artifactId:'artifact-1',sectionKey:null,pageNumber:2,
   sourceText:'The method  uses reliable evaluation.',content:'该方法采用可靠评估。',rects:[],noteColor:null,hidden:false,included:false,createdAt:'',updatedAt:''}
  expect(translatedParagraphTexts([card],2).has('The method uses reliable evaluation.')).toBe(true)
  expect(translatedParagraphTexts([card],1).size).toBe(0)
  expect(translatedParagraphTexts([{...card,hidden:true}],2).size).toBe(0)
  expect(translatedParagraphTexts([{...card,content:''}],2).size).toBe(0)
 })
 it('uses the actual text range, not an oversized span box, for underline coordinates',()=>{
  const sheet=document.createElement('div'), layer=document.createElement('div'), span=document.createElement('span')
  sheet.appendChild(layer);layer.appendChild(span);span.textContent='A paragraph with measured letters.'
  sheet.getBoundingClientRect=()=>new DOMRect(0,0,600,800)
  span.getBoundingClientRect=()=>new DOMRect(100,20,500,12)
  const mocked=vi.spyOn(document,'createRange').mockReturnValue({setStart(){},setEnd(){},getClientRects:()=>[new DOMRect(100,20,180,12)]} as unknown as Range)
  try { expect(buildVisualParagraphs(layer,sheet)[0].rects[0].width).toBeCloseTo(.3) }
  finally { mocked.mockRestore() }
 })
 it('splits at a short natural-paragraph ending and skips references',()=>{
  const bounds=new DOMRect(0,0,600,800)
  const line=(text:string,y:number,width=360)=>({text,rect:new DOMRect(100,y,width,12),height:12})
  const paragraphs=groupVisualLines([
   line('ABSTRACT',10,90),
   line('First sentence of the abstract continues across this line',30),
   line('and completes the abstract paragraph.',46,170),
   line('Second paragraph starts here and has its own analysis',62),
   line('with a separate conclusion.',78,160),
   line('REFERENCES',110,110),
   line('[1] An external study that should never be translated',130),
  ],bounds,true)
  expect(paragraphs).toHaveLength(2)
  expect(paragraphs[0].text).toContain('completes the abstract')
  expect(paragraphs[1].text).toContain('Second paragraph')
  expect(paragraphs.some((item)=>item.text.includes('external study'))).toBe(false)
  expect(isReferenceHeading('3 References')).toBe(true)
 })
})
