import { describe, expect, it } from 'vitest'
import { STAR_PEAK, STAR_SPRING, STAR_SPARK_RADIUS, starPopKeyframes, starSparkAngles } from './star-pop'

const scaleOf = (frame: { transform: string }) => Number(frame.transform.slice('scale('.length, -1))
const scales = (options?: Parameters<typeof starPopKeyframes>[0]) => starPopKeyframes(options).keyframes.map(scaleOf)
/** 统计回弹方向反转了多少次：反转越多说明阻尼越小、越弹。 */
const turns = (values: number[]) => values.reduce((count, value, index) => {
  if (index < 2) return count
  const previous = values[index - 1] - values[index - 2]
  const current = value - values[index - 1]
  return count + (previous * current < 0 ? 1 : 0)
}, 0)

describe('starPopKeyframes', () => {
  it('先放大到 1.3，再回落到 1', () => {
    const frames = scales()
    expect(frames[0]).toBe(1)
    expect(Math.max(...frames)).toBe(STAR_PEAK)
    expect(frames.at(-1)).toBe(1)
  })

  it('关键帧偏移单调递增且首尾铺满整段动画', () => {
    const { keyframes } = starPopKeyframes()
    expect(keyframes[0].offset).toBe(0)
    expect(keyframes.at(-1)!.offset).toBe(1)
    for (let index = 1; index < keyframes.length; index += 1) expect(keyframes[index].offset).toBeGreaterThan(keyframes[index - 1].offset)
  })

  it('默认刚度 300、阻尼 10，阻尼越小回弹次数越多', () => {
    expect(STAR_SPRING).toEqual({ stiffness: 300, damping: 10 })
    expect(turns(scales({ damping: 10 }))).toBeGreaterThan(turns(scales({ damping: 40 })))
  })

  it('刚度越大振荡越快，同样时长里来回更多', () => {
    expect(turns(scales({ stiffness: 600 }))).toBeGreaterThanOrEqual(turns(scales({ stiffness: 300 })))
  })

  it('回弹收得住，不会拖成几百毫秒以上的晃动', () => {
    const { duration } = starPopKeyframes()
    expect(duration).toBeGreaterThan(200)
    expect(duration).toBeLessThanOrEqual(900)
  })
})

describe('starSparkAngles', () => {
  it('8 个散点均分一圈，从正上方开始', () => {
    const angles = starSparkAngles()
    expect(angles).toHaveLength(8)
    expect(angles[0]).toBe(-90)
    expect(angles.every((angle, index) => angle === -90 + index * 45)).toBe(true)
    expect(STAR_SPARK_RADIUS).toBeGreaterThan(0)
  })
})
