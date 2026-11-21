import { useEffect, useState } from 'react'
import { Check, Layers, Pencil, Plus } from 'lucide-react'
import { addDays, planningStats, taskStats, type PlanningSnapshot, type PlanningTask } from '../shared/planning'
import type { ChatTheme } from '../shared/chat-theme'
import { buildStrataLayers, groupStrataMonths, type StrataSegment } from './planning-strata'
import { focusLabel, focusOfMonth, onFocusLog } from './focus-log'
import { TaskSticker } from './TaskSticker'

const shortDay = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(-2))}`

/** A goal board. Tasks are deliberately separate from the tiny to-do checklist:
 *  they carry a deadline, may have subtasks, and are drawn as stickers in the calendar. */
export function TaskPanel({ data, selected, busy, onEdit, onCreate, onComplete }: { data: PlanningSnapshot; selected: string; busy: boolean; onEdit: (task: PlanningTask) => void; onCreate: (day: string, parentId?: string | null) => void; onComplete: (task: PlanningTask) => void }) {
  const all = data.tasks || []
  const done = all.filter(task => task.done).length
  const roots = all.filter(task => !task.parentId).sort((a, b) => Number(a.done) - Number(b.done) || a.dueDate.localeCompare(b.dueDate))
  const row = (task: PlanningTask, child = false) => {
    const category = data.categories.find(cat => cat.id === task.categoryId)
    return <div className={`planning-task-row ${child ? 'child' : ''} ${task.done ? 'done' : ''}`} key={task.id}>
      <button className="planning-task-check" aria-label={`${task.done ? '取消完成' : '完成'}任务：${task.title}`} aria-pressed={task.done} disabled={busy} onClick={() => onComplete(task)}>{task.done && <Check size={12} />}</button>
      <button className="planning-task-open" onClick={() => onEdit(task)} aria-label={`编辑任务：${task.title}`}>
        <TaskSticker icon={task.icon} tone={task.tone} size={child ? 22 : 27} done={task.done} />
        <span><strong>{task.title}</strong><small>{shortDay(task.dueDate)}{category ? ` · ${category.name}` : ''}</small></span>
      </button>
      <button className="planning-task-edit" aria-label={`编辑任务：${task.title}`} onClick={() => onEdit(task)}><Pencil size={12} /></button>
    </div>
  }
  return <section className="planning-card planning-tasks" aria-label="任务">
    <header className="planning-card-head"><h2>任务</h2><span className="planning-muted">{done} / {all.length}</span><button className="planning-icon" aria-label="添加任务" title="添加任务" onClick={() => onCreate(selected)}><Plus size={16} /></button></header>
    <div className="planning-task-list">{roots.length ? roots.map(task => <div className="planning-task-group" key={task.id}>{row(task)}{all.filter(child => child.parentId === task.id).map(child => row(child, true))}<button className="planning-task-add-child" aria-label={`为任务「${task.title}」添加子任务`} onClick={() => onCreate(task.dueDate, task.id)}><Plus size={12} /></button></div>) : <div className="planning-task-empty"><p>还没有任务</p><button className="planning-quiet-add" onClick={() => onCreate(selected)}><Plus size={14} />新建任务</button></div>}</div>
  </section>
}

/** Flat, theme-coloured charts. No gradients anywhere: every bar is a solid rectangle. */
function DailyChart({ days, plans, tasks }: { days: string[]; plans: number[]; tasks: Array<{ due: number; done: number }> }) {
  const max = Math.max(1, ...plans, ...tasks.map(item => item.due))
  const width = 640, height = 92, gap = 2.5, bar = (width - gap * (days.length - 1)) / days.length
  return <div className="planning-review-chart"><svg viewBox={`0 0 ${width} ${height + 18}`} role="img" aria-label="本月每日计划完成柱与任务完成标记">
    {days.map((day, index) => {
      const x = index * (bar + gap), h = plans[index] / max * (height - 16), due = tasks[index]?.due || 0, taskDone = tasks[index]?.done || 0
      const taskHeight = Math.max(3, taskDone / max * (height - 16))
      return <g key={day}>
        {h > 0 && <rect x={x} y={height - h} width={bar} height={h} rx={Math.min(3, bar / 2)} fill="var(--pw-a-ink)" />}
        {taskDone > 0 && <rect x={x} y={height - taskHeight} width={bar} height={taskHeight} rx={Math.min(3, bar / 2)} fill="var(--pw-b-ink)" />}
        {due > 0 && <circle cx={x + bar / 2} cy={7} r="2.4" fill="var(--pw-c-ink)" />}
      </g>
    })}
    <path d={`M0 ${height}H${width}`} stroke="var(--pw-line)" strokeWidth="1" />
    {days.filter((_, i) => i % 5 === 0).map(day => <text key={day} x={days.indexOf(day) * (bar + gap) + bar / 2} y={height + 14} textAnchor="middle" fill="var(--pw-faint)" fontSize="9">{Number(day.slice(-2))}</text>)}
  </svg><div className="planning-review-legend"><span><i style={{ background: 'var(--pw-a-ink)' }} />完成计划</span><span><i style={{ background: 'var(--pw-b-ink)' }} />完成任务</span><span><i className="dot" style={{ background: 'var(--pw-c-ink)' }} />当日截止任务</span></div></div>
}

/** Width of the strata canvas in viewBox units. Every band shares one wave, so the dark
 *  seam between weeks stays an even thickness while category edges bend into veins. */
const STRATA_WIDTH = 720
const STRATA_GAP = 4.2

function strataWave(x: number): number {
  return Math.sin(x / STRATA_WIDTH * Math.PI * 2 * 0.92 + 0.55) * 4.6 + Math.sin(x / STRATA_WIDTH * Math.PI * 2 * 2.15 + 1.9) * 1.15
}

/** Cumulative category edges for one week. Null when that week has nothing to colour. */
function strataCuts(layer: { total: number; segments: StrataSegment[] }, order: string[]): number[] | null {
  if (!layer.total) return null
  const counts = new Map(layer.segments.map(segment => [segment.id, segment.count]))
  const cuts = [0]
  for (const id of order) cuts.push(cuts[cuts.length - 1] + (counts.get(id) ?? 0) / layer.total)
  return cuts
}

/** Category edges at a height inside one layer. The middle is that week's own share;
 *  the top and bottom meet the neighbouring week halfway, so a category tapers into a vein. */
function strataCutsAt(cuts: Array<number[] | null>, index: number, u: number): number[] | null {
  const here = cuts[index]
  if (!here) return null
  const blend = (toward: number[] | null) => toward ? here.map((value, edge) => (value + toward[edge]) / 2) : here
  const top = blend(index > 0 ? cuts[index - 1] : null)
  const bottom = blend(index + 1 < cuts.length ? cuts[index + 1] : null)
  const smooth = (t: number) => t * t * (3 - 2 * t)
  if (u <= 0.5) {
    const weight = smooth(u / 0.5)
    return top.map((value, edge) => value + (here[edge] - value) * weight)
  }
  const weight = smooth((u - 0.5) / 0.5)
  return here.map((value, edge) => value + (bottom[edge] - value) * weight)
}

function strataRibbon(cuts: Array<number[] | null>, index: number, edge: number, top: number, bottom: number): string | null {
  const samples = 8
  const points: string[] = []
  const put = (x: number, y: number) => points.push(`${x.toFixed(1)} ${(y + strataWave(x)).toFixed(2)}`)
  let wide = false
  const at = (u: number) => strataCutsAt(cuts, index, u)!
  const topCuts = at(0), bottomCuts = at(1)
  for (let step = 0; step <= samples; step += 1) {
    const share = step / samples
    const x = (topCuts[edge] + (topCuts[edge + 1] - topCuts[edge]) * share) * STRATA_WIDTH
    if (topCuts[edge + 1] - topCuts[edge] > 0.008) wide = true
    put(x, top)
  }
  for (let step = 1; step <= samples; step += 1) {
    const u = step / samples
    const row = at(u)
    if (row[edge + 1] - row[edge] > 0.008) wide = true
    put(row[edge + 1] * STRATA_WIDTH, top + (bottom - top) * u)
  }
  for (let step = 1; step <= samples; step += 1) {
    const share = step / samples
    put((bottomCuts[edge + 1] + (bottomCuts[edge] - bottomCuts[edge + 1]) * share) * STRATA_WIDTH, bottom)
  }
  for (let step = 1; step < samples; step += 1) {
    const u = 1 - step / samples
    put(at(u)[edge] * STRATA_WIDTH, top + (bottom - top) * u)
  }
  return wide ? `M${points.join('L')}Z` : null
}

/** 知识地层：最新的一周在最上面，层厚随当周完成数变化，层内按计划分类分色。
 *  分类顺序在所有层里固定，边界在相邻周之间收束，持续投入的分类会连成矿脉。 */
function KnowledgeStrata({ data, today, theme = 'transparent' }: { data: PlanningSnapshot; today: string; theme?: ChatTheme }) {
  const [focus, setFocus] = useState<number | null>(null)
  const layers = buildStrataLayers(data, today, 8, theme)
  const peak = Math.max(1, ...layers.map(layer => layer.total))
  const thickness = layers.map(layer => 7 + 16 * (layer.total / peak))
  const edges = [6]
  for (const value of thickness) edges.push(edges[edges.length - 1] + value + STRATA_GAP)
  const height = Math.round(edges[edges.length - 1] - STRATA_GAP + 6)
  const months = groupStrataMonths(layers)
  const seen = new Map<string, StrataSegment>()
  for (const layer of layers) for (const segment of layer.segments) if (!seen.has(segment.id)) seen.set(segment.id, segment)
  const legend = [...data.categories.filter(category => category.kind === 'plan' && !category.parentId).map(category => seen.get(category.id)), seen.get('__other')].filter((segment): segment is StrataSegment => Boolean(segment))
  const order = legend.map(segment => segment.id)
  const cuts = layers.map(layer => strataCuts(layer, order))
  const focused = focus === null ? null : layers[focus]
  const empty = !layers.some(layer => layer.total)
  const seam = (from: number, to: number, top: number, bottom: number) => {
    const steps = Math.max(2, Math.round((to - from) / 60))
    const upper: string[] = [], lower: string[] = []
    for (let step = 0; step <= steps; step += 1) {
      const x = from + (to - from) * (step / steps)
      upper.push(`${x.toFixed(1)} ${(top + strataWave(x)).toFixed(2)}`)
      lower.unshift(`${x.toFixed(1)} ${(bottom + strataWave(x)).toFixed(2)}`)
    }
    return `M${upper.join('L')}L${lower.join('L')}Z`
  }
  return <section className="planning-strata">
    <header className="planning-strata-head"><span className="planning-strata-icon"><Layers size={16} /></span><div><h3>知识地层</h3><p>每周一层，最新的一周在最上面。层的厚度随当周完成的计划数变化，层内按计划分类分色；持续投入的分类会连成一条贯穿多层的矿脉。</p></div></header>
    <div className="planning-strata-stage">
      <div className="planning-strata-months" style={{ paddingTop: 6 }}>{months.map(group => <span key={group.month} style={{ height: edges[group.to + 1] - STRATA_GAP - edges[group.from] }}>{Number(group.month.slice(5))}月</span>)}</div>
      <div className="planning-strata-canvas">
        <svg height={height} viewBox={`0 0 ${STRATA_WIDTH} ${height}`} preserveAspectRatio="none" role="img" aria-label={`最近 ${layers.length} 周的计划完成分布，按分类着色`} onPointerLeave={() => setFocus(null)}>
          {layers.map((layer, index) => {
            const top = edges[index], bottom = top + thickness[index]
            if (!layer.total) return <path key={layer.start} d={seam(0, STRATA_WIDTH, top, bottom)} fill="#E6DCCE" opacity={focus !== null && focus !== index ? .45 : 1} onPointerEnter={() => setFocus(index)} />
            return <g key={layer.start} opacity={focus === null || focus === index ? 1 : .28} onPointerEnter={() => setFocus(index)}>
              {order.map((id, edge) => {
                const segment = seen.get(id)
                const d = segment ? strataRibbon(cuts, index, edge, top, bottom) : null
                return d && segment ? <path key={id} d={d} fill={segment.color} /> : null
              })}
            </g>
          })}
        </svg>
      </div>
    </div>
    <p className="planning-strata-hint">{empty ? '完成计划后，这里会长出第一层。' : focused ? `${focused.label} · 完成 ${focused.total} 件${focused.segments.length ? ` · ${focused.segments.map(segment => `${segment.label} ${segment.count}`).join(' · ')}` : ''}` : '悬停在某一层查看当周的投入分布。'}</p>
    <div className="planning-strata-legend">{legend.map(segment => <span key={segment.id}><i style={{ background: segment.color }} />{segment.label}</span>)}</div>
  </section>
}

export function MonthReview({ data, monthList, today, theme = 'transparent' }: { data: PlanningSnapshot; monthList: string[]; today: string; theme?: ChatTheme }) {
  const tStats = taskStats(data, monthList)
  const planDoneByDay = monthList.map(day => planningStats(data, [day]).done)
  const activeDays = planDoneByDay.filter(count => count > 0).length
  const totalDone = planDoneByDay.reduce((sum, value) => sum + value, 0)
  const average = (totalDone / Math.max(1, monthList.length)).toFixed(1)
  const earned = monthList.filter(day => data.earnedDays.includes(day)).length
  let streak = 0, cursor = data.earnedDays.includes(today) ? today : addDays(today, -1)
  while (data.earnedDays.includes(cursor)) { streak++; cursor = addDays(cursor, -1) }
  /* 专注流水存在本机，跑满一轮番茄钟就记一条；这里只统计当前月份。 */
  const month = monthList[0]?.slice(0, 7) ?? today.slice(0, 7)
  const [focus, setFocus] = useState(() => focusOfMonth(month))
  useEffect(() => {
    setFocus(focusOfMonth(month))
    return onFocusLog(() => setFocus(focusOfMonth(month)))
  }, [month])
  const focusText = focusLabel(focus.minutes)
  return <section className="planning-card planning-month-summary" aria-label="月度回顾">
    <header className="planning-card-head"><div><span className="planning-kicker">MOMENTUM</span><h2>这个月的小成就</h2></div><span className="planning-muted">{monthList.length} 天</span></header>
    <div className="planning-rhythm">
      <div className="planning-rhythm-metrics">
        <div><small>活跃天数</small><strong>{activeDays}<em> / {monthList.length}</em></strong><span>有完成计划的日子</span></div>
        <div><small>当前连续</small><strong>{streak}<em> 天</em></strong><span>{earned ? `本月累计 ${earned} 个达标日` : '完成当天全部计划即达标'}</span></div>
        <div><small>专注时长</small><strong>{focusText.value}<em>{focusText.unit}</em></strong><span>{focus.rounds ? `本月跑完 ${focus.rounds} 轮番茄钟` : '番茄钟跑满一轮就记在这儿'}</span></div>
      </div>
      <div className="planning-rhythm-chart">
        <div className="planning-rhythm-head"><span>每天的完成节奏</span><b>日均 {average} 件 · 共 {totalDone} 件</b></div>
        <DailyChart days={monthList} plans={planDoneByDay} tasks={tStats.byDate} />
      </div>
    </div>
    <KnowledgeStrata data={data} today={today} theme={theme} />
  </section>
}
