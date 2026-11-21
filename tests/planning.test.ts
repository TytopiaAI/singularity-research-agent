import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { PlanningStore } from '../src/main/planning-store'
import { addDays, bookmarkUrl, calendarDays, monthDays, planningStats, plansForDay, type PlanInput } from '../src/shared/planning'

let directory:string,store:PlanningStore
const input:PlanInput={title:'阅读论文',note:'',date:'2026-10-26',time:'09:30',categoryId:'plan-reading',priority:'important',repeat:'daily',until:''}
it('retains optional end times after reopening and rejects inverted, malformed or all-day time ranges',()=>{
  const first=store.savePlan({...input,endTime:'11:00'}).plans[0]
  store.close();store=new PlanningStore(directory,()=> '2026-10-29')
  expect(store.get().plans[0]).toMatchObject({id:first.id,time:'09:30',endTime:'11:00'})
  for(const invalid of [{time:'',endTime:'10:00'},{time:'09:30',endTime:'09:30'},{time:'09:30',endTime:'08:00'},{time:'09:30',endTime:'25:00'}])expect(()=>store.savePlan({...input,...invalid})).toThrow()
  const legacy=store.savePlan({...input,title:'Legacy start only'}).plans.find(p=>p.title==='Legacy start only')!
  expect(legacy.endTime).toBe('');expect(plansForDay(store.get(),'2026-10-27')).toHaveLength(2)
})
beforeEach(()=>{directory=fs.mkdtempSync(path.join(os.tmpdir(),'singularity-planning-'));store=new PlanningStore(directory,()=> '2026-10-29')})
afterEach(()=>{store.close();fs.rmSync(directory,{recursive:true,force:true})})
it('starts without fake tasks or rewards, and preserves recurring day-specific completions after reopening',()=>{
  expect(store.get().plans).toEqual([]);expect(store.get().earnedDays).toEqual([])
  const saved=store.savePlan(input),plan=saved.plans[0]
  store.complete(plan.id,'2026-10-27',true)
  store.close();store=new PlanningStore(directory,()=> '2026-10-29')
  const reopened=store.get()
  expect(plansForDay(reopened,'2026-10-27')[0].done).toBe(true)
  expect(plansForDay(reopened,'2026-10-28')[0].done).toBe(false)
  expect(reopened.earnedDays).toEqual(['2026-10-27'])
})
it('handles leap days, month transitions, Monday alignment, weekday and weekly repeats',()=>{
  expect(monthDays('2028-02')).toHaveLength(29);expect(monthDays('2026-02')).toHaveLength(28)
  expect(calendarDays('2026-11')[0]).toBe('2026-10-26');expect(addDays('2026-12-31',1)).toBe('2027-01-01')
  store.savePlan({...input,repeat:'weekdays',until:'2026-11-02'})
  store.savePlan({...input,title:'每周回顾',repeat:'weekly',until:'2026-11-09'})
  const data=store.get()
  expect(plansForDay(data,'2026-10-31')).toHaveLength(0)
  expect(plansForDay(data,'2026-11-02')).toHaveLength(2)
  expect(plansForDay(data,'2026-11-09')).toHaveLength(1)
  expect(plansForDay(data,'2026-11-16')).toHaveLength(0)
})
it('repeats on weekends and on any chosen weekdays, while an older weekly plan stays on its start weekday',()=>{
  store.savePlan({...input,title:'研讨',repeat:'weekly',weekdays:[5,3,0,3],until:'2026-11-08'})
  store.savePlan({...input,title:'休息',repeat:'weekends',weekdays:[1],until:'2026-11-01'})
  const data=store.get()
  expect(data.plans.find(plan=>plan.title==='研讨')?.weekdays).toEqual([0,3,5])
  expect(data.plans.find(plan=>plan.title==='休息')?.weekdays).toBeUndefined()
  expect(plansForDay(data,'2026-10-26').map(plan=>plan.title)).toEqual([])
  expect(plansForDay(data,'2026-10-28').map(plan=>plan.title)).toEqual(['研讨'])
  expect(plansForDay(data,'2026-10-30').map(plan=>plan.title)).toEqual(['研讨'])
  expect(plansForDay(data,'2026-10-31').map(plan=>plan.title)).toEqual(['休息'])
  expect(plansForDay(data,'2026-11-01').map(plan=>plan.title)).toEqual(['研讨','休息'])
  expect(plansForDay(data,'2026-11-08').map(plan=>plan.title)).toEqual(['研讨'])
  expect(plansForDay(data,'2026-11-07')).toHaveLength(0)
  store.savePlan({...input,title:'下周一',date:'2026-10-28',repeat:'weekly',weekdays:[1],until:''})
  expect(plansForDay(store.get(),'2026-10-26').map(plan=>plan.title)).toEqual([])
  expect(plansForDay(store.get(),'2026-11-02').map(plan=>plan.title)).toEqual(['下周一'])
  expect(()=>store.savePlan({...input,repeat:'weekly',weekdays:[]})).toThrow('星期')
})
it('removes one repeated occurrence without altering other days, and removes completion with the series',()=>{
  const plan=store.savePlan(input).plans[0]
  store.complete(plan.id,'2026-10-27',true)
  store.removePlan(plan.id,'2026-10-27')
  expect(plansForDay(store.get(),'2026-10-27')).toEqual([])
  expect(plansForDay(store.get(),'2026-10-28')).toHaveLength(1)
  expect(()=>store.complete(plan.id,'2026-10-27',true)).toThrow('没有')
  store.removePlan(plan.id)
  expect(store.get().completions).toEqual([])
})
it('requires all scheduled tasks for a reward day, does not count future days or duplicate clicks, and never relocks earned art',()=>{
  const a=store.savePlan(input).plans[0],b=store.savePlan({...input,title:'运动',categoryId:'plan-health'}).plans[1]
  expect(store.complete(a.id,'2026-10-29',true).earnedDays).toEqual([])
  expect(store.complete(b.id,'2026-10-29',true).earnedDays).toEqual(['2026-10-29'])
  expect(store.complete(b.id,'2026-10-29',true).earnedDays).toHaveLength(1)
  store.complete(a.id,'2026-10-30',true);store.complete(b.id,'2026-10-30',true)
  expect(store.get().earnedDays).toHaveLength(1)
  store.complete(a.id,'2026-10-29',false)
  expect(store.get().earnedDays).toHaveLength(1)
})
it('computes totals, ratios and classification using occurrences, including empty days',()=>{
  const a=store.savePlan(input).plans[0]
  store.savePlan({...input,title:'锻炼',repeat:'none',categoryId:'plan-health',priority:'urgent-important'})
  store.complete(a.id,'2026-10-26',true)
  const stats=planningStats(store.get(),['2026-10-26','2026-10-27'])
  expect(stats.total).toBe(3);expect(stats.done).toBe(1);expect(stats.rate).toBe(33)
  expect(stats.categories.find(item=>item.label==='学习')?.count).toBe(1)
  expect(stats.priorities.find(item=>item.id==='important')?.count).toBe(1)
  expect(planningStats(store.get(),['2025-01-01']).rate).toBe(0)
})
it('keeps child categories in their parent color family and prevents cycles or removal of occupied categories',()=>{
  store.saveCategory({id:'plan-study',name:'学习',kind:'plan',parentId:null,color:'violet',shade:0})
  expect(store.get().categories.find(cat=>cat.id==='plan-reading')?.color).toBe('violet')
  expect(()=>store.saveCategory({id:'plan-study',name:'学习',kind:'plan',parentId:'plan-reading',color:'rose',shade:1})).toThrow('循环')
  store.savePlan(input)
  expect(()=>store.removeCategory('plan-reading')).toThrow('内容')
  expect(()=>store.savePlan({...input,categoryId:'bookmark-design'})).toThrow('类型')
})
it('extracts shared links, keeps notes/tags/star state, and rejects executable or credential URLs',()=>{
  const saved=store.saveBookmark({title:'灵感',url:'分享一个设计网站 https://example.com/a?x=1。 快来看看',note:'参考配色',tags:['设计','设计','稍后看'],categoryId:'bookmark-design',pinned:true})
  expect(saved.bookmarks[0]).toMatchObject({url:'https://example.com/a?x=1',tags:['设计','稍后看'],pinned:true})
  expect(store.bookmarkTarget(saved.bookmarks[0].id)).toBe('https://example.com/a?x=1')
  expect(()=>bookmarkUrl('javascript:alert(1)')).toThrow()
  expect(()=>bookmarkUrl('https://user:password@example.com')).toThrow()
  store.close();store=new PlanningStore(directory)
  expect(store.get().bookmarks[0].note).toBe('参考配色')
})
it('enforces gallery unlocks in the main process and persists frame, position, size and layering',()=>{
  const layout=[{artworkId:'bedroom',x:95,y:90,width:25,frame:'gold' as const}]
  expect(()=>store.saveGallery(layout)).toThrow('尚未解锁')
  const plan=store.savePlan({...input,repeat:'none',date:'2026-10-29'}).plans[0];store.complete(plan.id,'2026-10-29',true)
  const saved=store.saveGallery(layout)
  expect(saved.gallery[0].x).toBe(75);expect(saved.gallery[0].y).toBeLessThan(90)
  expect(()=>store.saveGallery([...layout,...layout])).toThrow('只能挂一次')
  expect(()=>store.saveGallery([{...layout[0],artworkId:'water-lilies'}])).toThrow('尚未解锁')
  store.close();store=new PlanningStore(directory)
  expect(store.get().gallery[0]).toMatchObject({artworkId:'bedroom',width:25,frame:'gold',x:75})
})
it('rejects malformed dates, colors, times and unbounded inputs before writing',()=>{
  expect(()=>store.savePlan({...input,date:'2026-02-30'})).toThrow()
  expect(()=>store.savePlan({...input,time:'25:20'})).toThrow()
  expect(()=>store.savePlan({...input,title:'x'.repeat(181)})).toThrow()
  expect(()=>store.complete('missing','2026-10-29',true)).toThrow()
  expect(store.get().plans).toEqual([])
})
it('persists dated todos with estimated minutes and still accepts legacy undated todos',()=>{
  const todos=[{id:'t1',title:'洗衣服',done:false,createdAt:'',date:'2026-11-15',minutes:30,priority:'important' as const},{id:'t2',title:'旧待办',done:false,createdAt:''}]
  expect(store.saveTodos(todos).todos).toEqual(todos)
  store.close();store=new PlanningStore(directory)
  expect(store.get().todos).toEqual(todos)
  expect(()=>store.saveTodos([{...todos[0],minutes:5}])).toThrow()
  expect(()=>store.saveTodos([{...todos[0],date:'2026-02-30'}])).toThrow()
})
it('keeps itinerary time overrides per day and clears a day with an empty object',()=>{
  store.saveScheduleOverrides('2026-11-15',{'todo:t1':'09:30','task:t2':'14:00'})
  store.saveScheduleOverrides('2026-11-16',{'todo:t1':'10:00'})
  store.close();store=new PlanningStore(directory)
  expect(store.get().scheduleOverrides).toEqual({'2026-11-15':{'todo:t1':'09:30','task:t2':'14:00'},'2026-11-16':{'todo:t1':'10:00'}})
  store.saveScheduleOverrides('2026-11-15',{})
  expect(store.get().scheduleOverrides).toEqual({'2026-11-16':{'todo:t1':'10:00'}})
  expect(()=>store.saveScheduleOverrides('2026-11-15',{'todo:t1':'25:00'})).toThrow()
  expect(()=>store.saveScheduleOverrides('2026-02-30',{})).toThrow()
})
