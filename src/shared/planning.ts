import { chatThemes, type ChatTheme } from './chat-theme'

/** 大类各占一个色系。键名写进数据库，只增不改；显示名与色相在 planningHues 里统一定义。 */
export type PlanningColor = 'rose' | 'coral' | 'orange' | 'peach' | 'sand' | 'amber' | 'olive' | 'green' | 'mint' | 'teal' | 'sky' | 'blue' | 'indigo' | 'violet' | 'plum' | 'pink' | 'slate'
export type PlanPriority = 'urgent-important' | 'important' | 'urgent' | 'ordinary'
export type PlanRepeat = 'none' | 'daily' | 'weekdays' | 'weekends' | 'weekly'
export interface PlanningCategory { id: string; name: string; kind: 'plan' | 'bookmark'; parentId: string | null; color: PlanningColor; shade: number }
export interface Plan { id: string; title: string; note: string; date: string; time: string; endTime?: string; categoryId: string; priority: PlanPriority; repeat: PlanRepeat; /** JS weekdays, 0 = Sunday. Only used when repeat is weekly; missing means the start date's weekday. */ weekdays?: number[]; until: string; excludedDates: string[]; createdAt: string }
export type PlanInput = Omit<Plan, 'id' | 'createdAt' | 'excludedDates'> & { id?: string }
export interface PlanCompletion { planId: string; date: string; completedAt: string }
export interface Bookmark { id: string; title: string; url: string; note: string; tags: string[]; categoryId: string; pinned: boolean; createdAt: string }
export type BookmarkInput = Omit<Bookmark, 'id' | 'createdAt'> & { id?: string }
/** A lightweight checklist. Undated legacy todos belong to today and stay visible there. */
export interface PlanningTodo { id: string; title: string; done: boolean; createdAt: string; /** YYYY-MM-DD; the day this chore should be fitted into the itinerary. */ date?: string; /** Estimated minutes, 15–240. */ minutes?: number; priority?: PlanPriority }
/** A goal-like task. Unlike a plan it has one deadline and is drawn as a sticker on that day only. */
export type TaskIcon = 'flag' | 'star' | 'book' | 'coffee' | 'rocket' | 'bulb' | 'clock' | 'heart' | 'leaf' | 'check'
export type TaskTone = 'a' | 'b' | 'c'
export interface PlanningTask { id: string; title: string; note: string; dueDate: string; categoryId: string; icon: TaskIcon; tone: TaskTone; done: boolean; parentId: string | null; createdAt: string }
export type TaskInput = Omit<PlanningTask, 'id' | 'createdAt'> & { id?: string }
export const taskIcons: TaskIcon[] = ['flag','star','book','coffee','rocket','bulb','clock','heart','leaf','check']
export const taskIconLabels: Record<TaskIcon,string> = { flag:'小旗',star:'星星',book:'笔记本',coffee:'咖啡',rocket:'纸飞机',bulb:'灵感',clock:'倒计时',heart:'心愿',leaf:'成长',check:'完成' }
export const taskToneLabels: Record<TaskTone,string> = { a:'主色', b:'辅色', c:'点缀色' }
export const frameStyles = ['oak', 'walnut', 'gold', 'black', 'white', 'brass', 'ornate', 'oval'] as const
export type GalleryFrame = typeof frameStyles[number]
/** rotation 是挂画在墙上的倾斜角度（度），挂歪一点点才像真挂上去的。 */
export interface GalleryPlacement { artworkId: string; x: number; y: number; width: number; frame: GalleryFrame; rotation?: number }
/** Manual start-time overrides for auto-scheduled items: day -> "todo:<id>" / "task:<id>" / "plan:<id>" -> HH:MM. */
export type ScheduleOverrideMap = Record<string, Record<string, string>>
export interface PlanningSnapshot { categories: PlanningCategory[]; plans: Plan[]; tasks: PlanningTask[]; completions: PlanCompletion[]; bookmarks: Bookmark[]; earnedDays: string[]; gallery: GalleryPlacement[]; todos: PlanningTodo[]; scheduleOverrides?: ScheduleOverrideMap }
export interface PlanningApi {
  get(): Promise<PlanningSnapshot>
  savePlan(input: PlanInput): Promise<PlanningSnapshot>
  removePlan(id: string, date?: string): Promise<PlanningSnapshot>
  complete(id: string, date: string, done: boolean): Promise<PlanningSnapshot>
  saveCategory(input: Omit<PlanningCategory, 'id'> & { id?: string }): Promise<PlanningSnapshot>
  removeCategory(id: string): Promise<PlanningSnapshot>
  saveBookmark(input: BookmarkInput): Promise<PlanningSnapshot>
  removeBookmark(id: string): Promise<PlanningSnapshot>
  openBookmark(id: string): Promise<void>
  saveGallery(layout: GalleryPlacement[]): Promise<PlanningSnapshot>
  saveTodos(todos: PlanningTodo[]): Promise<PlanningSnapshot>
  /** Replace the manual start-time overrides for one day's auto-scheduled items. */
  saveScheduleOverrides(day: string, overrides: Record<string, string>): Promise<PlanningSnapshot>
  saveTask(input: TaskInput): Promise<PlanningSnapshot>
  removeTask(id: string): Promise<PlanningSnapshot>
  completeTask(id: string, done: boolean): Promise<PlanningSnapshot>
}
/** 色系表：每个大类一个色系，按色相顺序排列，下拉框直接按这个顺序显示。
    sat / light 决定这一族在米白纸上的「粉感」，中性色（米白、岩灰）不参与跟主题色避让。
    shade 数组保持「主色 → 浅 → 深 → 最浅 → 中」的顺序，子类只是同色系里换一档深浅。 */
interface PlanningHue { hue: number; sat: number; light: number; label: string; neutral?: boolean }
export const planningHues: Record<PlanningColor, PlanningHue> = {
  rose: { hue: 348, sat: 38, light: 68, label: '玫瑰红' },
  coral: { hue: 12, sat: 46, light: 69, label: '珊瑚橘' },
  orange: { hue: 29, sat: 45, light: 68, label: '蜜橘橙' },
  peach: { hue: 34, sat: 32, light: 77, label: '奶油杏' },
  sand: { hue: 44, sat: 14, light: 82, label: '米白', neutral: true },
  amber: { hue: 50, sat: 44, light: 64, label: '琥珀黄' },
  olive: { hue: 78, sat: 26, light: 62, label: '橄榄绿' },
  green: { hue: 132, sat: 22, light: 62, label: '鼠尾草绿' },
  mint: { hue: 158, sat: 24, light: 64, label: '薄荷绿' },
  teal: { hue: 186, sat: 27, light: 62, label: '青瓷' },
  sky: { hue: 205, sat: 30, light: 66, label: '天青' },
  blue: { hue: 220, sat: 32, light: 66, label: '雾蓝' },
  indigo: { hue: 248, sat: 26, light: 64, label: '靛紫' },
  violet: { hue: 270, sat: 24, light: 68, label: '丁香紫' },
  plum: { hue: 300, sat: 22, light: 66, label: '梅紫' },
  pink: { hue: 328, sat: 30, light: 73, label: '藕粉' },
  slate: { hue: 220, sat: 7, light: 66, label: '岩灰', neutral: true },
}
export const planningColorKeys = Object.keys(planningHues) as PlanningColor[]
/** 主题色的显示名。顺序与 planningHues 一致，新建/编辑分类的主题色下拉直接按 key 取用。 */
export const planningColorLabels = Object.fromEntries(planningColorKeys.map(key => [key, planningHues[key].label])) as Record<PlanningColor, string>

/** 五档深浅：主色 / 浅一档 / 深一档 / 最浅 / 中间。浅色系按剩余空间比例收窄，避免两档糊成一片。 */
const shadeRamp = [
  { light: 0, sat: 0 },
  { light: 9, sat: -5 },
  { light: -7, sat: 4 },
  { light: 17, sat: -9 },
  { light: 4, sat: -2 },
]

function hslToHex(hue: number, sat: number, light: number): string {
  const h = ((hue % 360) + 360) % 360
  const s = Math.min(60, Math.max(5, sat)) / 100
  const l = Math.min(90, Math.max(34, light)) / 100
  const a = s * Math.min(l, 1 - l)
  const channel = (n: number) => {
    const k = (n + h / 30) % 12
    const value = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))
    return Math.round(255 * value).toString(16).padStart(2, '0')
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}

/** 每套界面主题（浅黄 / 浅蓝 / 浅紫 / 浅绿 / 透明）主色的色相。透明主题不占色相。 */
const themeHues = Object.fromEntries(chatThemes.map(theme => [theme.id, theme.hue])) as Record<ChatTheme, number | null>
/** 与主题色相差多少度以内算「撞色」。留 15° 的口子：同族相邻色还能用，正撞的几族让位。 */
const THEME_HUE_GAP = 15

function hueGap(a: number, b: number): number {
  const diff = Math.abs(((a - b) % 360 + 360) % 360)
  return diff > 180 ? 360 - diff : diff
}

/** 当前主题下可选的色系。主题色所在的那几族会被让开，避免分类和界面主色混成一片。 */
export function planningColorChoices(theme: ChatTheme = 'transparent'): PlanningColor[] {
  const center = themeHues[theme]
  if (center == null) return planningColorKeys
  const free = planningColorKeys.filter(key => planningHues[key].neutral || hueGap(planningHues[key].hue, center) > THEME_HUE_GAP)
  return free.length >= 8 ? free : planningColorKeys
}

/** 已经存下来的分类如果正好落在被让开的色系上，就近挪到当前主题可用的一族，浅深不动。
    只换色相，饱和度和明度还留着自己的，所以两族挪到同一处也不会糊成一个颜色。 */
export function resolvePlanningColor(color: PlanningColor, theme: ChatTheme = 'transparent'): PlanningColor {
  const entry = planningHues[color]
  const center = themeHues[theme]
  if (!entry || center == null || entry.neutral || hueGap(entry.hue, center) > THEME_HUE_GAP) return color
  let nearest = color
  let shortest = Infinity
  for (const key of planningColorChoices(theme)) {
    if (planningHues[key].neutral) continue
    const gap = hueGap(planningHues[key].hue, entry.hue)
    if (gap < shortest) { nearest = key; shortest = gap }
  }
  return nearest
}

const paletteCache = new Map<ChatTheme, Record<PlanningColor, string[]>>()
/** 一整套色板（17 族 × 5 档）随界面主题重新配色：撞主题色的几族换成最近的可用户色相，明度饱和度保留。 */
export function planningPalette(theme: ChatTheme = 'transparent'): Record<PlanningColor, string[]> {
  const cached = paletteCache.get(theme)
  if (cached) return cached
  const palette = {} as Record<PlanningColor, string[]>
  for (const key of planningColorKeys) {
    const own = planningHues[key]
    const hue = planningHues[resolvePlanningColor(key, theme)].hue
    palette[key] = shadeRamp.map(step => {
      const room = step.light > 0 ? (100 - own.light) / 34 : own.light / 66
      return hslToHex(hue, own.sat + step.sat, own.light + step.light * Math.min(1, Math.max(0.45, room)))
    })
  }
  paletteCache.set(theme, palette)
  return palette
}
/** 不随主题走的完整色板，给不关心主题的场合（测试、导出）用。 */
export const planningColors: Record<PlanningColor, string[]> = planningPalette('transparent')

export const priorityLabels: Record<PlanPriority,string> = { 'urgent-important':'重要且紧急', important:'重要不紧急', urgent:'紧急不重要', ordinary:'不重要不紧急' }
export const repeatLabels: Record<PlanRepeat,string> = { none:'不重复', daily:'每天', weekdays:'工作日', weekends:'周末', weekly:'每周' }
/** Index matches Date.getDay(): 0 is Sunday. */
export const weekdayLabels = ['日','一','二','三','四','五','六']
/** Monday-first order for the weekly day picker. */
export const weekdayOrder = [1,2,3,4,5,6,0]
export const frameLabels: Record<GalleryFrame,string> = { oak:'浅橡木',walnut:'深胡桃木',gold:'经典鎏金',black:'极简黑',white:'留白装裱',brass:'细黄铜',ornate:'复古雕花',oval:'椭圆画框' }
/** 画廊馆藏：按 days（累计达标日）从易到难排列，前密后疏——
    第一周就能挂上五幅，一个月十三幅，三个月集齐。ratio 为宽/高。 */
export const artworks = [
  { id:'bedroom',title:'卧室',artist:'文森特·梵高',year:'1889',days:1,ratio:1.277, museumId:28560,image:'planning/art/bedroom.jpg' },
  { id:'girl-with-cherries',title:'樱桃少女',artist:'伊娃·戈扎莱斯',year:'约 1870',days:2,ratio:0.850,museumId:36678,image:'planning/art/girl-cherries.jpg' },
  { id:'water-lilies',title:'睡莲',artist:'克劳德·莫奈',year:'1906',days:3,ratio:1.042,museumId:16568,image:'planning/art/water-lilies.jpg' },
  { id:'basket-of-apples',title:'苹果篮',artist:'保罗·塞尚',year:'约 1893',days:4,ratio:1.250,museumId:111436,image:'planning/art/basket-apples.jpg' },
  { id:'childs-bath',title:'洗澡的孩子',artist:'玛丽·卡萨特',year:'1893',days:5,ratio:0.659,museumId:111442,image:'planning/art/childs-bath.jpg' },
  { id:'great-wave',title:'神奈川冲浪里',artist:'葛饰北斋',year:'约 1830–1833',days:7,ratio:1.458,museumId:24645,image:'planning/art/great-wave.jpg' },
  { id:'ohashi-shower',title:'大桥安宅骤雨',artist:'歌川广重',year:'1857',days:9,ratio:0.660,museumId:64447,image:'planning/art/ohashi-shower.jpg' },
  { id:'saint-lazare',title:'圣拉扎尔车站',artist:'克劳德·莫奈',year:'1877',days:12,ratio:1.333,museumId:16571,image:'planning/art/saint-lazare.jpg' },
  { id:'rainy-paris',title:'巴黎街道，雨天',artist:'古斯塔夫·卡耶博特',year:'1877',days:14,ratio:1.287,museumId:20684,image:'planning/art/rainy-paris.jpg' },
  { id:'compiegne',title:'贡比涅森林',artist:'贝尔特·莫里佐',year:'1885',days:18,ratio:1.203,museumId:53058,image:'planning/art/compiegne.jpg' },
  { id:'fournaise',title:'福尔奈斯餐厅的午餐',artist:'皮埃尔-奥古斯特·雷诺阿',year:'1875',days:21,ratio:1.206,museumId:81555,image:'planning/art/fournaise.jpg' },
  { id:'southampton',title:'蓝与金夜曲',artist:'詹姆斯·麦克尼尔·惠斯勒',year:'1872',days:25,ratio:1.512,museumId:56905,image:'planning/art/southampton.jpg' },
  { id:'grande-jatte',title:'大碗岛的星期天下午',artist:'乔治·修拉',year:'1884–1886',days:30,ratio:1.492,museumId:27992,image:'planning/art/grande-jatte.jpg' },
  { id:'cabasson',title:'卡巴松海滩',artist:'亨利-埃德蒙·克罗斯',year:'1891–1892',days:35,ratio:1.426,museumId:100476,image:'planning/art/cabasson.jpg' },
  { id:'woman-cezanne-still-life',title:'塞尚静物前的女子',artist:'保罗·高更',year:'1890',days:45,ratio:0.843,museumId:16648,image:'planning/art/woman-cezanne-still-life.jpg' },
  { id:'cliff-walk',title:'普尔维尔的悬崖漫步',artist:'克劳德·莫奈',year:'1882',days:60,ratio:1.249,museumId:14620,image:'planning/art/cliff-walk.jpg' },
  { id:'bewitched-mill',title:'被施魔法的磨坊',artist:'弗朗茨·马尔克',year:'1913',days:75,ratio:0.685,museumId:9021,image:'planning/art/bewitched-mill.jpg' },
  { id:'self-portrait',title:'自画像',artist:'文森特·梵高',year:'1887',days:90,ratio:0.788,museumId:80607,image:'planning/art/self-portrait.jpg' },
] as const
export function localDay(value = new Date()): string { return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}` }
export function dayDate(day: string): Date { return new Date(`${day}T12:00:00`) }
export function addDays(day: string, amount: number): string { const date=dayDate(day);date.setDate(date.getDate()+amount);return localDay(date) }
export function monthDays(month: string): string[] { const first=dayDate(`${month}-01`),count=new Date(first.getFullYear(),first.getMonth()+1,0).getDate();return Array.from({length:count},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`) }
export function calendarDays(month: string): string[] { const first=`${month}-01`,offset=(dayDate(first).getDay()+6)%7;return Array.from({length:42},(_,i)=>addDays(first,i-offset)) }
/** Days a repeating plan lands on. An older weekly plan without a saved selection keeps its start weekday. */
export function planWeekdays(plan: { repeat: PlanRepeat; date: string; weekdays?: number[] }): number[] {
  if(plan.repeat==='weekdays')return [1,2,3,4,5]
  if(plan.repeat==='weekends')return [6,0]
  if(plan.repeat!=='weekly')return []
  const picked=[...new Set(plan.weekdays??[])].filter(day=>Number.isInteger(day)&&day>=0&&day<=6)
  return picked.length?picked:[dayDate(plan.date).getDay()]
}
export function repeatDetail(plan: { repeat: PlanRepeat; date: string; weekdays?: number[] }): string {
  if(plan.repeat==='none')return ''
  if(plan.repeat==='daily')return '每天'
  if(plan.repeat==='weekdays')return '工作日'
  if(plan.repeat==='weekends')return '周末'
  return weekdayOrder.filter(day=>planWeekdays(plan).includes(day)).map(day=>'周'+weekdayLabels[day]).join('、')
}
export function occursOn(plan: Plan, day: string): boolean {
  if(day<plan.date || plan.until && day>plan.until || (plan.excludedDates??[]).includes(day))return false
  if(plan.repeat==='none')return day===plan.date
  if(plan.repeat==='daily')return true
  return planWeekdays(plan).includes(dayDate(day).getDay())
}
export function plansForDay(data: PlanningSnapshot, day: string): Array<Plan & {done:boolean}> {
  const done=new Set(data.completions.filter(item=>item.date===day).map(item=>item.planId))
  return data.plans.filter(plan=>occursOn(plan,day)).map(plan=>({...plan,done:done.has(plan.id)})).sort((a,b)=>(a.time||'99:99').localeCompare(b.time||'99:99') || Number(a.done)-Number(b.done))
}
export function planningStats(data: PlanningSnapshot, dates: string[], theme: ChatTheme = 'transparent') {
  const palette = planningPalette(theme)
  const items=dates.flatMap(date=>plansForDay(data,date).map(plan=>({...plan,day:date}))),done=items.filter(plan=>plan.done)
  return { total:items.length,done:done.length,rate:items.length?Math.round(done.length/items.length*100):0,
    priorities:Object.entries(priorityLabels).map(([id,label])=>({id,label,count:done.filter(plan=>plan.priority===id).length})),
    categories:data.categories.filter(cat=>cat.kind==='plan'&&!cat.parentId).map(cat=>({id:cat.id,label:cat.name,color:palette[cat.color][0],count:done.filter(plan=>plan.categoryId===cat.id||data.categories.some(child=>child.id===plan.categoryId&&child.parentId===cat.id)).length})) }
}
/** Tasks never span days: a deadline is the only day they appear in the main calendar. */
export function tasksForDay(data: PlanningSnapshot, day: string): PlanningTask[] {
  return (data.tasks||[]).filter(task=>task.dueDate===day).sort((a,b)=>Number(a.parentId!==null)-Number(b.parentId!==null)||Number(a.done)-Number(b.done)||a.title.localeCompare(b.title))
}
export function taskStats(data: PlanningSnapshot, dates: string[]) {
  const set=new Set(dates),items=(data.tasks||[]).filter(task=>set.has(task.dueDate)),done=items.filter(task=>task.done)
  return { total:items.length, done:done.length, rate:items.length?Math.round(done.length/items.length*100):0,
    roots:items.filter(task=>!task.parentId).length, children:items.filter(task=>task.parentId).length,
    byDate:dates.map(date=>{const day=items.filter(task=>task.dueDate===date);return {date,due:day.length,done:day.filter(task=>task.done).length}}) }
}
export function colorForCategory(category?: PlanningCategory, theme: ChatTheme = 'transparent'): string {
  const palette = planningPalette(theme)
  if (!category) return palette.slate[0]
  return palette[category.color]?.[category.shade] ?? palette.slate[0]
}
export function bookmarkUrl(input: string): string {
  const matched=input.match(/https?:\/\/[^\s<>"'\u3000]+/i)?.[0]?.replace(/[，。！？；、）)\]】]+$/g,'')
  if(!matched)throw new Error('请粘贴有效的网页链接或包含链接的分享文案。')
  const url=new URL(matched)
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('仅支持普通 HTTP(S) 收藏链接。')
  return url.toString()
}
export function bookmarkPlatform(url: string): string { try { const host=new URL(url).hostname;return /xiaohongshu|xhslink/.test(host)?'小红书':/douyin/.test(host)?'抖音':/weibo/.test(host)?'微博':/bilibili|b23.tv/.test(host)?'哔哩哔哩':/arxiv/.test(host)?'arXiv':host.replace(/^www\./,'') } catch { return '网页' } }
