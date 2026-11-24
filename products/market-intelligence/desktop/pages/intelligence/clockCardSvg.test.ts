import { describe, expect, it } from 'vitest'

import {
  clockSvgGeometry, clockSvgMarks, clockTickRadius, scaleClockPath, scaleClockPoint, scaleClockRadius
} from './clockCardSvg'
import { clockCardCenter, clockCardGeometry, clockCardSvgScale, prototypeOrbitRadius } from './clockPlaqueLayout'

/**
 * A 方案（用户 2026-11：整体小四分之一）是**等比缩**，不是重画：
 * 原型那几条弧、指针、刻度都照同一个系数搬。判据是「圆心不动、半径按系数」，
 * 逐字比对字符串没有意义（字符串本来就是算出来的）。
 */
describe('prototype svg is scaled onto the smaller card', () => {
  it('keeps the centre and the radius ratio', () => {
    // 原型圆心 (156,153) 就是这张卡的 SVG 圆心 (117,115)。
    expect(scaleClockPoint(156, 153)).toEqual({ x: clockCardCenter.svgX, y: clockCardCenter.svgY })
    expect(clockCardSvgScale).toBeCloseTo(clockCardGeometry.orbitRadius / prototypeOrbitRadius, 12)
    // 环最上一点：原型 (156,153−135) → 这张卡 (117, 115−101)。
    const top = scaleClockPoint(156, 153 - prototypeOrbitRadius)
    expect(top.x).toBe(clockCardCenter.svgX)
    expect(top.y).toBeCloseTo(clockCardCenter.svgY - clockCardGeometry.orbitRadius, 6)
    expect(clockCardGeometry.orbitRadius * 2).toBe(202)
  })

  it('scales arc radii by the same factor and keeps the arc flags', () => {
    const path = scaleClockPath('M156.00 49.00 A104 104 0 1 1 69.28 210.40')
    const radius = Number(scaleClockRadius(104).toFixed(2))
    expect(path).toContain(`A ${radius} ${radius} 0 1 1`)
    // 起点跟着搬，不留在原型坐标上。
    expect(path.startsWith(`M ${clockCardCenter.svgX} ${Number(scaleClockPoint(156, 49).y.toFixed(2))}`)).toBe(true)
  })

  it('moves relative pieces (the 12 o’clock pointer) by the factor only', () => {
    // 相对段只乘系数、不平移：三角形仍然贴在指针起点上。
    const path = scaleClockPath('M156.0 37.0 l-4.5 -10 h9 z')
    const start = scaleClockPoint(156, 37)
    expect(path.startsWith(`M ${Number(start.x.toFixed(2))} ${Number(start.y.toFixed(2))}`)).toBe(true)
    expect(path).toContain(`-${Number((4.5 * clockCardSvgScale).toFixed(2))}`)
  })

  it('keeps every scaled shape inside the new canvas', () => {
    for (const [key, path] of Object.entries(clockSvgGeometry)) {
      for (const match of path.matchAll(/([ML])\s*(-?[\d.]+)\s+(-?[\d.]+)/gu)) {
        const x = Number(match[2])
        const y = Number(match[3])
        expect(x, `${key} 的 x 在画布内`).toBeGreaterThanOrEqual(0)
        expect(x, `${key} 的 x 在画布内`).toBeLessThanOrEqual(clockCardGeometry.svgWidth)
        expect(y, `${key} 的 y 在画布内`).toBeGreaterThanOrEqual(0)
        expect(y, `${key} 的 y 在画布内`).toBeLessThanOrEqual(clockCardGeometry.svgHeight)
      }
    }
  })

  it('puts the tick marks on the scale ring and the marks above the ring', () => {
    expect(clockTickRadius.outer).toBe(clockCardGeometry.scaleRadius)
    expect(clockTickRadius.inner).toBeLessThan(clockTickRadius.outer)
    // 12 点那颗点与「现在」的字都在环内、卡内。
    expect(clockSvgMarks.nowMarkY).toBeGreaterThan(0)
    expect(clockSvgMarks.nowMarkY).toBeLessThan(clockCardCenter.svgY - clockCardGeometry.scaleRadius)
    expect(clockSvgMarks.nowLabelY).toBeGreaterThan(clockSvgMarks.nowMarkY)
  })
})
