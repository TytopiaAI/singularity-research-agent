import { taskIconLabels, taskIcons, type TaskIcon, type TaskTone } from '../shared/planning'

/** Hand-drawn sticker vocabulary for goal-like tasks. Every shape is inline SVG
 *  so the deadline markers stay crisp at any size and follow the chat theme. */
const line = 'var(--pw-sticker-line, #4a4038)'
const toneVar = (tone: TaskTone) => tone === 'a' ? 'var(--pw-a)' : tone === 'b' ? 'var(--pw-b)' : 'var(--pw-c)'

function Shape({ icon, fill }: { icon: TaskIcon; fill: string }) {
  switch (icon) {
    case 'flag': return <>
      <path d="M11 6v28" />
      <path d="M12 7h18a2 2 0 0 1 1.5 3.3l-4.1 5.4 4.1 5.4A2 2 0 0 1 30 24H12z" fill={fill} />
      <path d="M7.5 34h8" />
      <circle cx="17.5" cy="15.5" r=".9" fill={line} stroke="none" /><circle cx="23.5" cy="15.5" r=".9" fill={line} stroke="none" />
      <path d="M18 19q2.5 2 5 0" />
    </>
    case 'star': return <>
      <path d="M20 5.5l4.5 9.2 10.1 1.4-7.3 7.1 1.8 10.1L20 28.5l-9.1 4.8 1.8-10.1-7.3-7.1 10.1-1.4z" fill={fill} />
      <circle cx="17" cy="18" r=".9" fill={line} stroke="none" /><circle cx="23" cy="18" r=".9" fill={line} stroke="none" />
      <path d="M17.5 22q2.5 2.2 5 0" />
    </>
    case 'book': return <>
      <rect x="11" y="5" width="21" height="30" rx="5" fill={fill} />
      <path d="M11 12H7M11 20H7M11 28H7" />
      <path d="M17 16h9M17 21h9M17 26h6" strokeWidth="1.5" />
    </>
    case 'coffee': return <>
      <path d="M9 14h20v8a10 10 0 0 1-20 0z" fill={fill} />
      <path d="M29 16h2.5a4 4 0 0 1 0 8H29" />
      <path d="M7 34c2.5 1.6 5.5 1.6 8 0 2.5 1.6 5.5 1.6 8 0 2.5 1.6 5.5 1.6 8 0" strokeWidth="1.6" />
      <path d="M16 5q-2 2.5 0 5M23 5q-2 2.5 0 5" strokeWidth="1.6" />
    </>
    case 'rocket': return <>
      <path d="M6 18.5L34 6 23.5 34l-5-11.5z" fill={fill} />
      <path d="M18.5 22.5L34 6" />
      <path d="M6 18.5l12.5 4" strokeWidth="1.6" />
      <path d="M8 31l3 3" strokeWidth="1.6" />
    </>
    case 'bulb': return <>
      <path d="M20 5a11 11 0 0 0-6.4 20c1.3 1 1.9 2.2 1.9 3.5h9c0-1.3.6-2.5 1.9-3.5A11 11 0 0 0 20 5z" fill={fill} />
      <path d="M15.5 32h9M17 35.5h6" />
      <path d="M20 2v-1.5M5.5 18H4M36 18h-1.5M8 8L7 7M32 8l1-1" strokeWidth="1.6" />
      <circle cx="17.5" cy="19" r=".9" fill={line} stroke="none" /><circle cx="22.5" cy="19" r=".9" fill={line} stroke="none" />
    </>
    case 'clock': return <>
      <path d="M11.5 6.5l3 3M28.5 6.5l-3 3" />
      <circle cx="20" cy="21" r="12.5" fill={fill} />
      <path d="M20 13.5v8l4.5 3" />
      <circle cx="20" cy="21" r="1.1" fill={line} stroke="none" />
    </>
    case 'heart': return <>
      <path d="M20 33S7 25.2 7 16.6A7.3 7.3 0 0 1 20 13a7.3 7.3 0 0 1 13 3.6C33 25.2 20 33 20 33z" fill={fill} />
      <circle cx="16.8" cy="18" r=".9" fill={line} stroke="none" /><circle cx="23.2" cy="18" r=".9" fill={line} stroke="none" />
      <path d="M17.2 21.5q2.8 2.4 5.6 0" />
    </>
    case 'leaf': return <>
      <path d="M32 6C16 6 8 14 8 24.5A8.5 8.5 0 0 0 16.5 33C27 33 33 22 32 6z" fill={fill} />
      <path d="M8.5 34C14 25 21 17.5 29 10" />
      <path d="M17 24l-4-1M22 19l-1-4" strokeWidth="1.5" />
    </>
    case 'check': return <>
      <rect x="6.5" y="6.5" width="27" height="27" rx="9" fill={fill} />
      <path d="M13 20.5l5 5 9-10" strokeWidth="2.6" />
    </>
  }
}

export function TaskSticker({ icon, tone = 'a', size = 28, done = false, className = '', label }: { icon: TaskIcon; tone?: TaskTone; size?: number; done?: boolean; className?: string; label?: string }) {
  return <svg className={`planning-task-sticker ${done ? 'done' : ''} ${className}`} width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={label || taskIconLabels[icon]}>
    <g stroke={line} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" fill="none"><Shape icon={icon} fill={toneVar(tone)} /></g>
  </svg>
}

export function TaskIconPicker({ value, tone, onChange }: { value: TaskIcon; tone: TaskTone; onChange: (icon: TaskIcon) => void }) {
  return <div className="planning-task-icon-picker" role="group" aria-label="任务图标">
    {taskIcons.map(icon => <button type="button" key={icon} className={icon === value ? 'selected' : ''} aria-label={`任务图标：${taskIconLabels[icon]}`} aria-pressed={icon === value} onClick={() => onChange(icon)}><TaskSticker icon={icon} tone={tone} size={30} /></button>)}
  </div>
}
