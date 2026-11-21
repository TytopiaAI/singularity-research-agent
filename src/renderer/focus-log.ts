/** 番茄钟的专注流水：每跑完一轮记一条，只留在本机。
 *  月成就卡片据此汇总「这个月专注了多久」，和计时器状态分开存，
 *  免得重置计时把统计一起清掉。 */
const STORE_KEY = 'singularity.planning.focus.log'
const CHANGE_EVENT = 'singularity:focus-log'
/** 只留最近半年，够月度回顾和热力对照，也不会让 localStorage 无限长。 */
const KEEP_DAYS = 183

export type FocusEntry = { day: string; minutes: number }

const localDay = (value = new Date()) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`

export function readFocusLog(): FocusEntry[] {
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    if (!raw) return []
    const value = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.filter((entry): entry is FocusEntry => Boolean(entry) && typeof entry.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.day) && typeof entry.minutes === 'number' && entry.minutes > 0)
  } catch { return [] }
}

/** 记一轮完成的专注（分钟），顺手清掉过期记录。 */
export function recordFocus(minutes: number): void {
  const safe = Math.round(minutes)
  if (!Number.isFinite(safe) || safe <= 0) return
  const cutoff = localDay(new Date(Date.now() - KEEP_DAYS * 86_400_000))
  const next = [...readFocusLog(), { day: localDay(), minutes: safe }].filter(entry => entry.day >= cutoff)
  try { window.localStorage.setItem(STORE_KEY, JSON.stringify(next)) } catch { /* 存储不可用时只是不统计，不影响计时 */ }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

/** 某个月（YYYY-MM）的专注总分钟数与完成轮数。 */
export function focusOfMonth(month: string): { minutes: number; rounds: number } {
  const entries = readFocusLog().filter(entry => entry.day.slice(0, 7) === month)
  return { minutes: entries.reduce((sum, entry) => sum + entry.minutes, 0), rounds: entries.length }
}

/** 今天的专注轮数与分钟数。 */
export function focusOfToday(): { minutes: number; rounds: number } {
  const day = localDay()
  const entries = readFocusLog().filter(entry => entry.day === day)
  return { minutes: entries.reduce((sum, entry) => sum + entry.minutes, 0), rounds: entries.length }
}

/** 关注专注流水变化，返回取消订阅函数。 */
export function onFocusLog(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener)
  return () => window.removeEventListener(CHANGE_EVENT, listener)
}

/** 把分钟数拆成「几个小时 + 几分钟」；不足一小时只报分钟。 */
export function focusLabel(minutes: number): { value: string; unit: string } {
  if (minutes < 60) return { value: String(minutes), unit: ' 分钟' }
  const hours = Math.floor(minutes / 60), rest = minutes % 60
  return rest ? { value: String(hours), unit: ` 小时 ${rest} 分` } : { value: String(hours), unit: ' 小时' }
}
