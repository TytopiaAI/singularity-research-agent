/**
 * 卡片展开/收起的弹簧参数：刚度 200、阻尼 14（质量 1）。
 * 阻尼比 c / (2√(km)) ≈ 0.5，冲过目标后再弹回来一次，整段约 1.1s 落定。
 */
export const CARD_SPRING = { stiffness: 200, damping: 14, mass: 1 } as const

/**
 * 逐帧把若干条通道从 start 弹到 rest（半隐式欧拉，和 star-pop 的积分方式一致）。
 * tolerance 是每条通道的静止阈值：位移用像素、缩放用「比值」这种各自合适的量级，
 * 否则缩放通道会为了等位移收敛而多跑几百毫秒。
 * 返回打断函数；打断后不再回调 apply/done，调用方自己把样式收干净。
 */
export function springTo(start: number[], rest: number[], tolerance: number[], apply: (values: number[]) => void, done?: () => void): () => void {
  const values = start.slice()
  const velocity = start.map(() => 0)
  let running = true
  let frame = 0
  let last = performance.now()
  const step = (now: number) => {
    if (!running) return
    const delta = Math.min((now - last) / 1000, 1 / 30)
    last = now
    let moving = false
    for (let i = 0; i < values.length; i += 1) {
      const force = -CARD_SPRING.stiffness * (values[i] - rest[i]) - CARD_SPRING.damping * velocity[i]
      velocity[i] += (force / CARD_SPRING.mass) * delta
      values[i] += velocity[i] * delta
      if (Math.abs(values[i] - rest[i]) > tolerance[i] || Math.abs(velocity[i]) > tolerance[i] * 40) moving = true
    }
    apply(values)
    if (moving) { frame = requestAnimationFrame(step); return }
    running = false
    apply(rest)
    done?.()
  }
  frame = requestAnimationFrame(step)
  return () => { running = false; cancelAnimationFrame(frame) }
}
