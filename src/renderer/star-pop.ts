/** 收藏星标的动效参数：放大到 1.3 后用刚度 300、阻尼 10 的弹簧弹回。 */
export const STAR_SPRING = { stiffness: 300, damping: 10 } as const
export const STAR_PEAK = 1.3
export const STAR_SPARKS = 8

export type StarPopFrame = { offset: number; transform: string }
export type StarPop = { duration: number; keyframes: StarPopFrame[] }

/** 推到峰值的时长，占整段动画的开头；越大起手越软，越小越像是「被戳了一下」。 */
const PUSH_MS = 80
/** 回弹段的积分步长，1/120s 足够贴合肉眼，也不会生成过多关键帧。 */
const SETTLE_STEP = 1 / 120
/** 回弹最长时长。阻尼 10 时衰减很慢，到 0.7s 振幅已不足 1%，再长没有意义。 */
const MAX_SETTLE = 0.7
/** 推峰时的关键帧个数（含首尾）。 */
const PUSH_FRAMES = 5

/**
 * 生成收藏星星的关键帧：先缓出放大到 1.3，再按 x'' = -(k/m)(x-1) - (c/m)x'
 * 做半隐式欧拉积分弹回 1。刚度越大回得越快，阻尼越小回弹次数越多。
 * 弹簧看的是位移相对终点的偏移，所以末帧强制落回 1，避免积分残差让星星停在 1.004。
 */
export function starPopKeyframes({ stiffness = STAR_SPRING.stiffness, damping = STAR_SPRING.damping, peak = STAR_PEAK }: { stiffness?: number; damping?: number; peak?: number } = {}): StarPop {
  const scales: number[] = []
  for (let index = 0; index < PUSH_FRAMES; index += 1) {
    const progress = index / (PUSH_FRAMES - 1)
    scales.push(1 + (peak - 1) * (1 - (1 - progress) ** 3))
  }
  let position = peak
  let velocity = 0
  let elapsed = 0
  while (elapsed < MAX_SETTLE) {
    velocity += (-stiffness * (position - 1) - damping * velocity) * SETTLE_STEP
    position += velocity * SETTLE_STEP
    elapsed += SETTLE_STEP
    scales.push(position)
    if (elapsed > 0.1 && Math.abs(position - 1) < 0.004 && Math.abs(velocity) < 0.04) break
  }
  const settleMs = Math.max(1, Math.round(elapsed * 1000))
  const duration = PUSH_MS + settleMs
  const last = scales.length - 1
  const keyframes = scales.map((scale, index) => ({
    offset: Number((index < PUSH_FRAMES ? (index / (PUSH_FRAMES - 1)) * (PUSH_MS / duration) : (PUSH_MS + ((index - PUSH_FRAMES + 1) / (last - PUSH_FRAMES + 1)) * settleMs) / duration).toFixed(5)),
    transform: `scale(${index === last ? 1 : Number(scale.toFixed(4))})`,
  }))
  return { duration, keyframes }
}

/** 散点从星星轮廓向外推开的距离（px）；图标本体 17px，推到 15px 正好落在按钮边缘内侧。 */
export const STAR_SPARK_RADIUS = 15
/** 每个散点的方向，8 个方向均分一圈，从正上方开始。 */
export function starSparkAngles(count = STAR_SPARKS): number[] {
  return Array.from({ length: count }, (_, index) => (index * 360) / count - 90)
}
