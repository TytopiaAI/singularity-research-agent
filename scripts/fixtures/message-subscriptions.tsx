import { createRoot } from 'react-dom/client'
import { DigestPage } from '../../src/renderer/ResearchPages'
import type { DigestIssue, DigestSubscription } from '../../src/shared/types'
import '../../src/renderer/styles.css'
import '../../src/renderer/workspace.css'
import '../../src/renderer/acrylic.css'
import '../../src/renderer/design.css'
import '../../src/renderer/scrollbars'

const configs:DigestSubscription[]=[],issues:DigestIssue[]=[]
const canvas=document.createElement('canvas');canvas.width=720;canvas.height=280
const context=canvas.getContext('2d')!,gradient=context.createLinearGradient(0,0,720,280)
gradient.addColorStop(0,'#d6e3f2');gradient.addColorStop(1,'#eee6d9');context.fillStyle=gradient;context.fillRect(0,0,720,280)
context.strokeStyle='#ffffffa0';context.lineWidth=2
for(let i=0;i<6;i++){context.beginPath();context.arc(510,140,36+i*19,0,Math.PI*2);context.stroke()}
context.fillStyle='#596879';context.font='20px sans-serif';context.fillText('SOURCE IMAGE / TEST FIXTURE',34,148)
const test={configs,issues,saved:[] as DigestSubscription[],removed:[] as string[],opened:[] as string[],read:[] as string[],stars:[] as string[],fail:false}
Object.assign(window,{messagePreview:test,singularity:{research:{
 list:async()=>structuredClone(issues),subscriptions:async()=>structuredClone(configs),
 subscribe:async(input:DigestSubscription)=>{if(test.fail)throw Error('Mock permission failure');test.saved.push(structuredClone(input));const at=configs.findIndex(c=>c.id===input.id);if(at<0)configs.push(input);else configs[at]=input},
 removeSubscription:async(id:string)=>{test.removed.push(id);configs.splice(configs.findIndex(c=>c.id===id),1)},
 generate:async(_kind:string,id:string)=>{
  const config=configs.find(c=>c.id===id)!,issue:DigestIssue={id:crypto.randomUUID(),kind:'news',subscriptionId:id,subscription:structuredClone(config),createdAt:new Date().toISOString(),status:'complete',warnings:['隔离界面测试，不会访问外部消息服务。'],sources:[],items:[],overview:config.includeOverview===false?'':'本期关注研究工具、设计方法与公开评估的变化。新的工具强调可复现的工作流程，设计实践更重视清晰的交互层级。下一步可以关注开放数据与真实场景验证；本段为隔离测试资料。'}
  const titles=['从想法到实践：研究工作流的新变化','把复杂信息整理成清晰的阅读体验','开放工具与可复现方法：值得关注的进展','一个很长的消息标题，验证卡片尺寸与点击展开后能否完整阅读。'.repeat(5),'本周公开资料与方法更新','设计与科技交叉领域的最新观察']
  for(let i=0;i<(config.count??6);i++){
   issue.sources.push({id:'s-'+i,title:'公开测试来源 '+i,url:'https://example.org/message/'+id+'/'+i,publishedAt:new Date().toISOString(),text:'隔离测试来源',official:false,...([0,2].includes(i)&&config.presentation!=='text'?{imageData:canvas.toDataURL('image/png')}:{} )})
   issue.items.push({id:'item-'+i,sourceId:'s-'+i,title:titles[i%titles.length],summary:i===1?'一则简短消息。':'围绕具体场景、实际方法和可核验的来源，整理这一阶段值得关注的变化，帮助快速了解背景、影响与后续方向。'.repeat(i===3?12:2),why:'应结合公开来源评估实际效果，区分已验证的结果与尚待确认的方向。',category:'方法与工具'})
  }
  issues.unshift(issue);return structuredClone(issue)
 },
 read:async(issueId:string,id:string)=>{test.read.push(id);issues.find(i=>i.id===issueId)!.items.find(i=>i.id===id)!.read=true},
 star:async(issueId:string,id:string,starred:boolean)=>{test.stars.push(id);issues.find(i=>i.id===issueId)!.items.find(i=>i.id===id)!.starred=starred},
 openSource:async(url:string)=>{test.opened.push(url)},
}}})
createRoot(document.getElementById('root')!).render(<div className="app-shell sidebar-open"><aside className="app-sidebar"/><header className="titlebar"/><main className="main-content" data-chat-theme="warm"><DigestPage kind="news"/></main></div>)
