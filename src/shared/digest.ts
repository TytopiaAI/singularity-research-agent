import type { DigestIssue, DigestSubscription } from './types'

/** A digest day follows the subscription's Beijing timezone on every host. */
export function beijingDay(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit' }).format(now)
}

export const messageChannel = (issue:DigestIssue) => issue.subscriptionId ?? 'legacy-news'
export function subscriptionKey(config:DigestSubscription) { return config.kind==='papers'?'papers':config.id==='legacy-news'||!config.id?'news':'news:'+config.id }
export function normalizeSubscription(raw:DigestSubscription):DigestSubscription {
  if(!raw || !['papers','news'].includes(raw.kind) || typeof raw.enabled!=='boolean' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time) || !Array.isArray(raw.topics) || !raw.topics.length || raw.topics.length>6 || raw.topics.some(t=>typeof t!=='string'||!t.trim()||t.length>120))throw Error('主题和推送时间无效')
  const config:DigestSubscription={kind:raw.kind,enabled:raw.enabled,time:raw.time,topics:raw.topics.map(t=>t.trim())}
  if(raw.kind==='papers')return config
  const id=raw.id??'legacy-news',repeat=raw.repeat??'daily'
  if(!/^[a-zA-Z0-9-]{1,100}$/.test(id)||!['once','daily','weekly','biweekly','monthly','yearly','interval'].includes(repeat))throw Error('订阅标识或重复方式无效')
  Object.assign(config,{id,repeat,startDate:raw.startDate??beijingDay()})
  if(!/^\d{4}-\d{2}-\d{2}$/.test(config.startDate!)||!Number.isFinite(Date.parse(config.startDate!))||new Date(config.startDate!).toISOString().slice(0,10)!==config.startDate)throw Error('开始日期无效')
  if(raw.description!==undefined&&(typeof raw.description!=='string'||raw.description.length>2000))throw Error('描述最多 2000 字')
  if(raw.weekdays!==undefined&&(!Array.isArray(raw.weekdays)||raw.weekdays.some(d=>!Number.isInteger(d)||d<0||d>6)))throw Error('星期选择无效')
  if(['weekly','biweekly'].includes(repeat)&&!raw.weekdays?.length)throw Error('请至少选择一个星期')
  if(raw.newsType!==undefined&&!['all','research','industry','product','policy','culture'].includes(raw.newsType))throw Error('消息类型无效')
  if(raw.presentation!==undefined&&!['mixed','text','image'].includes(raw.presentation))throw Error('展示方式无效')
  if(raw.imageCardStyle!==undefined&&!['auto','cover','immersive'].includes(raw.imageCardStyle))throw Error('封面样式无效')
  if(raw.includeOverview!==undefined&&typeof raw.includeOverview!=='boolean')throw Error('总结卡片选项无效')
  for(const [key,max] of [['count',20],['rangeDays',365],['intervalDays',365]] as const){const value=raw[key];if(value!==undefined&&(!Number.isInteger(value)||value<1||value>max))throw Error('消息数量或时间范围无效')}
  return {...config,description:raw.description?.trim(),rangeDays:raw.rangeDays??7,count:raw.count??6,weekdays:[...new Set(raw.weekdays??[])].sort(),intervalDays:raw.intervalDays??2,newsType:raw.newsType??'all',presentation:raw.presentation??'mixed',imageCardStyle:raw.imageCardStyle??'auto',includeOverview:raw.includeOverview??true}
}

export function digestIsDue(config:DigestSubscription,lastDay:string,now=new Date()):boolean {
  const today=beijingDay(now),time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now)
  if(!config.enabled||time<config.time||lastDay===today)return false
  if(config.kind==='papers')return true
  const start=config.startDate??today
  if(today<start)return false
  const date=new Date(today+'T00:00:00Z'),anchor=new Date(start+'T00:00:00Z'),repeat=config.repeat??'daily'
  if(repeat==='once')return !lastDay
  if(repeat==='weekly'||repeat==='biweekly') {
    if(!config.weekdays?.includes(date.getUTCDay()))return false
    if(repeat==='weekly')return true
    const weekStart=(d:Date)=>d.getTime()-((d.getUTCDay()+6)%7)*86400000
    return Math.round((weekStart(date)-weekStart(anchor))/604800000)%2===0
  }
  if(repeat==='interval')return Math.round((date.getTime()-anchor.getTime())/86400000)%(config.intervalDays??2)===0
  const lastDate=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate()
  if(repeat==='monthly')return date.getUTCDate()===Math.min(anchor.getUTCDate(),lastDate)
  if(repeat==='yearly')return date.getUTCMonth()===anchor.getUTCMonth()&&date.getUTCDate()===Math.min(anchor.getUTCDate(),lastDate)
  return true
}

export const weekdayNames=['日','一','二','三','四','五','六']
export function subscriptionSchedule(config:DigestSubscription) {
  const repeat=config.repeat??'daily',label={once:'单次',daily:'每天',weekly:'每周',biweekly:'每双周',monthly:'每月',yearly:'每年',interval:`每 ${config.intervalDays??2} 天`}[repeat]
  const days=['weekly','biweekly'].includes(repeat)?' '+(config.weekdays??[]).map(d=>'周'+weekdayNames[d]).join('、'):['monthly','yearly','once'].includes(repeat)?' '+(config.startDate??'').slice(repeat==='monthly'?8:repeat==='yearly'?5:0):''
  return `${label}${days} · ${config.time}`
}
