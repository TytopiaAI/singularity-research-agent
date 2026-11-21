import { addDays, dayDate, localDay, type Plan } from './planning'

export type CalendarView='month'|'week'|'day'
export type DayPlan=Plan&{done:boolean}
export const calendarViewLabels:Record<CalendarView,string>={month:'月',week:'周',day:'日'}
export function weekDays(day:string){const start=addDays(day,-((dayDate(day).getDay()+6)%7));return Array.from({length:7},(_,i)=>addDays(start,i))}
export function shiftCalendarDate(day:string,view:CalendarView,amount:number){
  if(view!=='month')return addDays(day,amount*(view==='week'?7:1))
  const date=dayDate(day),desired=date.getDate();date.setDate(1);date.setMonth(date.getMonth()+amount)
  date.setDate(Math.min(desired,new Date(date.getFullYear(),date.getMonth()+1,0).getDate()));return localDay(date)
}
export function calendarRangeLabel(day:string,view:CalendarView){
  if(view==='month')return dayDate(day).toLocaleDateString('zh-CN',{year:'numeric',month:'long'})
  if(view==='day')return dayDate(day).toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'})
  const days=weekDays(day),start=dayDate(days[0]),end=dayDate(days[6]);return `${start.getFullYear()} 年 ${start.getMonth()+1} 月 ${start.getDate()} 日 — ${start.getFullYear()!==end.getFullYear()?end.getFullYear()+' 年 ':''}${end.getMonth()+1} 月 ${end.getDate()} 日`
}
export function timeMinutes(value:string){const [hours,minutes]=value.split(':').map(Number);return hours*60+minutes}
export function minuteTime(minutes:number){const bounded=Math.max(0,Math.min(1439,Math.round(minutes)));return String(Math.floor(bounded/60)).padStart(2,'0')+':'+String(bounded%60).padStart(2,'0')}
export function planTimeLabel(plan:Pick<Plan,'time'|'endTime'>){return plan.time?(plan.endTime?`${plan.time}–${plan.endTime}`:plan.time):'全天'}
export interface TimelinePlacement {plan:DayPlan;start:number;end:number;column:number;columns:number}
/** Assign simultaneous appointments separate lanes; touching boundaries may reuse a lane. */
export function timelinePlacements(plans:DayPlan[]):TimelinePlacement[]{
  const items=plans.filter(p=>p.time).map(plan=>{const start=timeMinutes(plan.time);return {plan,start,end:Math.min(1440,Math.max(start+30,plan.endTime?timeMinutes(plan.endTime):start+60)),column:0,columns:1}}).sort((a,b)=>a.start-b.start||b.end-a.end||a.plan.id.localeCompare(b.plan.id))
  let group:TimelinePlacement[]=[],ends:number[]=[],groupEnd=0
  const finish=()=>{for(const item of group)item.columns=ends.length;group=[];ends=[]}
  for(const item of items){if(group.length&&item.start>=groupEnd)finish();let lane=ends.findIndex(end=>end<=item.start);if(lane<0)lane=ends.length;ends[lane]=item.end;item.column=lane;group.push(item);groupEnd=Math.max(...ends)}
  finish();return items
}
