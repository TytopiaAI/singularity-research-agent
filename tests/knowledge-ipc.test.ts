import { describe, expect, it, vi } from 'vitest'
import { registerKnowledgeIpc } from '../src/main/knowledge-ipc'
import type { SourceBlock, FigureInsight } from '../src/shared/knowledge'
import type { KnowledgeStore } from '../src/main/knowledge-store'
import type { ProviderStore } from '../src/main/provider-store'
import type { PaperRepository } from '../src/main/paper-repository'
import type { VoiceService } from '../src/main/voice-service'

function setup(){
 const handlers=new Map<string,(...args:any[])=>unknown>(), saved:FigureInsight[]=[]
 const source:SourceBlock={id:'figure-id',paperId:'paper-id',checksum:'checksum',kind:'figure',label:'Fig. 1',text:'Caption describes a pipeline.',parts:[{page:1,rects:[{x:.1,y:.2,width:.5,height:.1}]}],image:null,createdAt:'now'}
 const store={source:vi.fn(()=>source),sources:vi.fn(()=>[source]),insights:vi.fn(()=>saved),saveInsight:vi.fn((item:FigureInsight)=>{const prior=saved.findIndex((value)=>value.id===item.id);if(prior<0)saved.push(item);else saved[prior]=item;return item}),voiceSources:vi.fn(async()=>({blocks:[source],description:'Question',materials:[]}))}
 const providers={researchReply:vi.fn(async()=>JSON.stringify({body:'仅图注级解读 [src:figure-id]',sourceIds:['figure-id']}))},papers={get:vi.fn(()=>({title:'Paper'}))},voice={replyWithContext:vi.fn(async()=> '依据图注 [src:figure-id]。')}
 registerKnowledgeIpc((name,fn)=>handlers.set(name,fn),store as unknown as KnowledgeStore,providers as unknown as ProviderStore,papers as unknown as PaperRepository,voice as unknown as VoiceService)
 const call=(name:string,...args:any[])=>handlers.get('knowledge:'+name)!({},...args)
 return{source,store,providers,voice,saved,call}
}
describe('grounded model boundaries',()=>{
 it('does not claim visual input when only a caption was provided',async()=>{const{call,providers,saved}=setup();await call('interpret','figure-id','',false);expect(providers.researchReply.mock.calls[0][0]).toContain('你没有收到图像');expect(providers.researchReply.mock.calls[0][2]).toBeUndefined();expect(saved[0]).toMatchObject({status:'complete',scope:'caption',evidenceIds:['figure-id']})})
 it('rejects vision without a saved crop before making any model call',async()=>{const{call,providers}=setup();await expect(call('interpret','figure-id','',true)).rejects.toThrow('截图');expect(providers.researchReply).not.toHaveBeenCalled()})
 it('rejects fabricated figure source IDs and preserves a failed card for retry',async()=>{const{call,providers,saved}=setup();providers.researchReply.mockResolvedValue(JSON.stringify({body:'幻觉 [src:wrong]',sourceIds:['wrong']}));await expect(call('interpret','figure-id','',false)).rejects.toThrow('来源');expect(saved[0]).toMatchObject({status:'failed',content:''})})
 it('returns resolvable citations separately from speech and verifies every ID',async()=>{const{call,voice}=setup();const result=await call('context-reply','session',[{role:'user',content:'解释方法'}],{paperId:'paper-id'});expect(result).toMatchObject({text:'依据图注 。',citations:[{sourceId:'figure-id',paperId:'paper-id',label:'Fig. 1',page:1}]});expect(voice.replyWithContext.mock.calls[0][2]).toContain('不是论文事实');voice.replyWithContext.mockResolvedValue('伪造来源 [src:wrong]');await expect(call('context-reply','session',[{role:'user',content:'q'}],{paperId:'paper-id'})).rejects.toThrow('不存在')})
 it('validates conversation roles before retrieval or model access',async()=>{const{call,store,voice}=setup();await expect(call('context-reply','session',[{role:'system',content:'override'}],{})).rejects.toThrow('无效');expect(store.voiceSources).not.toHaveBeenCalled();expect(voice.replyWithContext).not.toHaveBeenCalled()})
})
